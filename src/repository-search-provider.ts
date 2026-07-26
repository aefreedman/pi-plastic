import { spawn } from "node:child_process";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type RepoSearchExecutionContextV1,
  type RepositoryPolicyRequestV1,
  type RepositoryPolicyResultV1,
  type RepositoryPolicyV1,
} from "@aefree/pi-repo-search/contracts/v1";
import type {
  DetectionRequestV1,
  DetectionResultV1,
  ProviderGuidanceRequestV1,
  ProviderGuidanceResultV1,
  ProviderPreflightRequestV1,
  ProviderPreflightResultV1,
  WorkflowExecutionContextV1,
  WorkflowOwnerV1,
  WorkflowProviderV1,
} from "@aefree/pi-workflow/contracts/v1";
import { discoverPlasticWorkspace, type WorkspaceDiscoveryOutcome } from "./plastic-workspace.ts";

export const PLASTIC_REPOSITORY_SEARCH_POLICY_ID = "plastic.ignore-files" as const;
export const PLASTIC_WORKFLOW_PROVIDER_ID = "vcs.plastic" as const;
export const PLASTIC_GUIDANCE_RESOURCE_IDS = ["repository-search-ignore-policy", "vcs-workflow"] as const;
const CM_TIMEOUT_MS = 5_000;
const MAX_CM_OUTPUT_CHARS = 32_000;

export async function loadPlasticOwnerV1(moduleUrl: string = import.meta.url): Promise<WorkflowOwnerV1> {
  const registeredBy = fileURLToPath(moduleUrl);
  const packageRoot = await realpath(fileURLToPath(new URL("../", moduleUrl)));
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
  if (manifest.name !== "@aefree/pi-plastic" || typeof manifest.version !== "string" || manifest.version.trim() === "") throw new Error(`Invalid @aefree/pi-plastic package identity at ${packageRoot}.`);
  return Object.freeze({ packageName: "@aefree/pi-plastic", packageVersion: manifest.version, packageRoot, registeredBy });
}

export function createPlasticRepositorySearchPolicyV1(owner: WorkflowOwnerV1): RepositoryPolicyV1 {
  return Object.freeze({
    contractVersion: 1, id: PLASTIC_REPOSITORY_SEARCH_POLICY_ID, kind: "repository-search-policy", owner,
    async evaluate(context: RepoSearchExecutionContextV1, request: RepositoryPolicyRequestV1): Promise<RepositoryPolicyResultV1> {
      throwIfAborted(context.signal);
      const roots = [] as { root: string; policyOwnedRoot: string; ignoreFiles: string[]; disclosures: string[] }[];
      for (const root of request.roots) {
        throwIfAborted(context.signal);
        const workspace = await discoverPlasticWorkspace(root);
        if (workspace.kind === "unavailable") return { outcome: "unavailable", code: "plastic_workspace_unavailable", retryable: true };
        if (workspace.kind !== "found") continue;
        const canonicalRoot = await realpath(root).catch(() => undefined);
        const canonicalWorkspace = await realpath(workspace.value.root).catch(() => undefined);
        if (!canonicalRoot || !canonicalWorkspace || !isWithin(canonicalWorkspace, canonicalRoot)) return { outcome: "error", code: "plastic_workspace_boundary_invalid", retryable: false };
        const ignoreFiles = await discoverIgnoreFiles(canonicalWorkspace, canonicalRoot, context.signal);
        roots.push({ root: canonicalRoot, policyOwnedRoot: canonicalWorkspace, ignoreFiles, disclosures: [ignoreFiles.length ? `Plastic ignore policy applied (${ignoreFiles.length} file${ignoreFiles.length === 1 ? "" : "s"}).` : "Plastic workspace detected; no readable ignore.conf or cloaked.conf found."] });
      }
      return roots.length ? { outcome: "applied", roots } : { outcome: "not_applicable" };
    },
  });
}

type WorkflowProviderDependencies = {
  discoverWorkspace(path: string): Promise<WorkspaceDiscoveryOutcome>;
  checkCmReadiness(root: string, signal: AbortSignal): Promise<{ outcome: "ready" } | { outcome: "blocked"; code: string; retryable: boolean }>;
};
const defaultDependencies: WorkflowProviderDependencies = { discoverWorkspace: discoverPlasticWorkspace, checkCmReadiness: runCmReadiness };

/** Marker detection establishes applicability; preflight re-detects ownership and proves cm readiness. */
export function createPlasticWorkflowProviderV1(owner: WorkflowOwnerV1, overrides: Partial<WorkflowProviderDependencies> = {}): WorkflowProviderV1 {
  const dependencies = { ...defaultDependencies, ...overrides };
  return Object.freeze({
    contractVersion: 1, id: PLASTIC_WORKFLOW_PROVIDER_ID, kind: "vcs", owner,
    resources: Object.freeze(PLASTIC_GUIDANCE_RESOURCE_IDS.map((resourceId) => Object.freeze({ packageName: owner.packageName, packageVersion: owner.packageVersion, resourceId }))),
    async detect(context: WorkflowExecutionContextV1, request: DetectionRequestV1): Promise<DetectionResultV1> {
      throwIfAborted(context.signal);
      const result = await dependencies.discoverWorkspace(request.targetPath);
      if (result.kind === "not_found") return { outcome: "no_match" };
      if (result.kind === "unavailable") return { outcome: "unavailable", code: "plastic_workspace_unavailable", retryable: true };
      return { outcome: "match", workspaceRoot: result.value.root, evidence: [{ kind: "workspace_marker" }] };
    },
    async preflight(context: WorkflowExecutionContextV1, request: ProviderPreflightRequestV1): Promise<ProviderPreflightResultV1> {
      throwIfAborted(context.signal);
      const result = await dependencies.discoverWorkspace(request.targetPath);
      if (result.kind === "not_found") return { outcome: "blocked", code: "plastic_workspace_not_found", retryable: false };
      if (result.kind === "unavailable") return { outcome: "unavailable", code: "plastic_workspace_unavailable", retryable: true };
      if (request.workspaceRoot === undefined) return { outcome: "blocked", code: "plastic_selected_root_missing", retryable: false };
      const selectedRoot = await realpath(request.workspaceRoot).catch(() => undefined);
      const detectedRoot = await realpath(result.value.root).catch(() => undefined);
      if (selectedRoot === undefined || detectedRoot === undefined) return { outcome: "blocked", code: "plastic_workspace_unverifiable", retryable: true };
      if (!samePath(selectedRoot, detectedRoot)) return { outcome: "blocked", code: "plastic_workspace_changed", retryable: true };
      try {
        return await dependencies.checkCmReadiness(detectedRoot, context.signal);
      } catch (error) {
        if (isAbort(error)) throw error;
        return { outcome: "blocked", code: "plastic_cm_not_ready", retryable: true };
      }
    },
    async loadGuidance(context: WorkflowExecutionContextV1, request: ProviderGuidanceRequestV1): Promise<ProviderGuidanceResultV1> {
      throwIfAborted(context.signal);
      if (!PLASTIC_GUIDANCE_RESOURCE_IDS.includes(request.resourceId as typeof PLASTIC_GUIDANCE_RESOURCE_IDS[number])) return { outcome: "missing", code: "guidance_not_found", retryable: false };
      const full = request.resourceId === "repository-search-ignore-policy"
        ? "Plastic repository search policy discovers readable ignore.conf and cloaked.conf only inside the canonical marker-owned workspace. Policy failure blocks search rather than running unfiltered."
        : "Plastic applicability is marker-based. Preflight re-detects the selected canonical workspace and requires a bounded, cancellable cm status readiness check. A selected Plastic workspace never falls back to Git when cm is missing, unauthenticated, or not ready.";
      const maxChars = Math.max(1, Math.min(request.maxChars, 4000));
      return { outcome: "available", ref: { packageName: owner.packageName, packageVersion: owner.packageVersion, resourceId: request.resourceId }, content: full.slice(0, maxChars), truncated: full.length > maxChars };
    },
  });
}

async function runCmReadiness(root: string, signal: AbortSignal): Promise<{ outcome: "ready" } | { outcome: "blocked"; code: string; retryable: boolean }> {
  const executable = process.env.PI_PLASTIC_CM_EXECUTABLE?.trim() || "cm";
  return await new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    let child;
    try { child = spawn(executable, ["status", "--machinereadable"], { cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { resolve({ outcome: "blocked", code: "plastic_cm_missing", retryable: false }); return; }
    let outputChars = 0; let settled = false; let timedOut = false;
    const terminate = () => { if (!child.killed) child.kill(); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, CM_TIMEOUT_MS);
    const onAbort = () => terminate();
    signal.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); };
    const count = (chunk: Buffer | string) => { outputChars += Buffer.byteLength(chunk); if (outputChars > MAX_CM_OUTPUT_CHARS) terminate(); };
    child.stdout.on("data", count); child.stderr.on("data", count);
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return; settled = true; cleanup();
      if (signal.aborted) reject(abortError()); else resolve({ outcome: "blocked", code: error.code === "ENOENT" ? "plastic_cm_missing" : "plastic_cm_not_ready", retryable: error.code !== "ENOENT" });
    });
    child.on("close", (code) => {
      if (settled) return; settled = true; cleanup();
      if (signal.aborted) reject(abortError());
      else if (timedOut) resolve({ outcome: "blocked", code: "plastic_cm_timeout", retryable: true });
      else if (outputChars > MAX_CM_OUTPUT_CHARS) resolve({ outcome: "blocked", code: "plastic_cm_output_too_large", retryable: false });
      else resolve(code === 0 ? { outcome: "ready" } : { outcome: "blocked", code: "plastic_cm_not_ready", retryable: true });
    });
  });
}

async function discoverIgnoreFiles(workspaceRoot: string, root: string, signal: AbortSignal): Promise<string[]> {
  const stats = await stat(root); let current = stats.isDirectory() ? root : dirname(root); const directories: string[] = [];
  while (true) { directories.push(current); if (samePath(current, workspaceRoot)) break; const parent = dirname(current); if (parent === current || !isWithin(workspaceRoot, parent)) break; current = parent; }
  directories.reverse(); const files: string[] = [];
  for (const directory of directories) for (const name of ["ignore.conf", "cloaked.conf"]) {
    throwIfAborted(signal); const candidate = join(directory, name);
    try { if ((await stat(candidate)).isFile()) { await access(candidate, fsConstants.R_OK); files.push(candidate); } } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code !== "ENOENT" && code !== "ENOTDIR") throw error; }
  }
  return files;
}
function isWithin(root: string, target: string): boolean { const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, ""); const normalizedTarget = target.replaceAll("\\", "/"); return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`); }
function samePath(a: string, b: string): boolean { return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b; }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }
function isAbort(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function abortError(): Error { const error = new Error("Operation cancelled."); error.name = "AbortError"; return error; }
