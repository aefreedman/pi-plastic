import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Structural copies of the narrow public v1 contract keep the filter module loadable
// when the optional registry package is absent. The installed registry validates the
// record when registration is available; unavailable or malformed filter data
// degrades to generic discovery rather than interrupting file discovery.
type FileDiscoveryOwnerV1 = Readonly<{ packageName: string; packageVersion: string; packageRoot: string; registeredBy: string }>;
type FileDiscoveryExecutionContextV1 = Readonly<{ cwd: string; requestId?: string; signal: AbortSignal }>;
type FileDiscoveryFilterRequestV1 = Readonly<{ workspaceRoot: string; roots: readonly string[]; includeHidden: boolean; signal: AbortSignal }>;
type FileDiscoveryAppliedRootV1 = Readonly<{ root: string; filterDecision: "applied" | "bypassed"; decisionCode: string; filterBoundary?: string; excludeGlobs?: readonly string[]; ignoreFiles?: readonly string[]; disclosures: readonly string[] }>;
type FileDiscoveryFilterResultV1 =
  | Readonly<{ outcome: "not_applicable" }>
  | Readonly<{ outcome: "applied"; roots: readonly FileDiscoveryAppliedRootV1[] }>
  | Readonly<{ outcome: "unavailable" | "error"; code: string; retryable: boolean }>;
type FileDiscoveryFilterV1 = Readonly<{ contractVersion: 1; id: string; kind: "file-discovery-filter"; owner: FileDiscoveryOwnerV1; evaluate(context: FileDiscoveryExecutionContextV1, request: FileDiscoveryFilterRequestV1): Promise<FileDiscoveryFilterResultV1> }>;
import { discoverPlasticWorkspace } from "./plastic-workspace.ts";

export const PLASTIC_FILE_DISCOVERY_FILTER_ID = "plastic.ignore-files" as const;
export const PLASTIC_IGNORE_FILES_APPLIED_CODE = "plastic_ignore_files_applied" as const;

/** Resolve this physical package copy's identity for file-discovery registration. */
export async function loadPlasticOwnerV1(moduleUrl: string = import.meta.url): Promise<FileDiscoveryOwnerV1> {
  const registeredBy = fileURLToPath(moduleUrl);
  const packageRoot = await realpath(fileURLToPath(new URL("../", moduleUrl)));
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
  if (manifest.name !== "@aefree/pi-plastic" || typeof manifest.version !== "string" || manifest.version.trim() === "") throw new Error(`Invalid @aefree/pi-plastic package identity at ${packageRoot}.`);
  return Object.freeze({ packageName: "@aefree/pi-plastic", packageVersion: manifest.version, packageRoot, registeredBy });
}

/** Advisory filter that supplies bounded Plastic ignore/cloaking data to file discovery. */
export function createPlasticFileDiscoveryFilterV1(owner: FileDiscoveryOwnerV1): FileDiscoveryFilterV1 {
  return Object.freeze({
    contractVersion: 1, id: PLASTIC_FILE_DISCOVERY_FILTER_ID, kind: "file-discovery-filter", owner,
    async evaluate(context: FileDiscoveryExecutionContextV1, request: FileDiscoveryFilterRequestV1): Promise<FileDiscoveryFilterResultV1> {
      throwIfAborted(context.signal);
      const roots: FileDiscoveryAppliedRootV1[] = [];
      for (const root of request.roots) {
        throwIfAborted(context.signal);
        const workspace = await discoverPlasticWorkspace(root);
        if (workspace.kind === "unavailable") return { outcome: "unavailable", code: "plastic_workspace_unavailable", retryable: true };
        if (workspace.kind !== "found") continue;
        const canonicalRoot = await realpath(root).catch(() => undefined);
        const canonicalWorkspace = await realpath(workspace.value.root).catch(() => undefined);
        if (!canonicalRoot || !canonicalWorkspace || !isWithin(canonicalWorkspace, canonicalRoot)) return { outcome: "error", code: "plastic_workspace_boundary_invalid", retryable: false };
        const ignoreFiles = await discoverIgnoreFiles(canonicalWorkspace, canonicalRoot, context.signal);
        if (ignoreFiles.length === 0) continue;
        roots.push({ root: canonicalRoot, filterDecision: "applied", decisionCode: PLASTIC_IGNORE_FILES_APPLIED_CODE, filterBoundary: canonicalWorkspace, ignoreFiles, disclosures: [`Plastic ignore filter applied (${ignoreFiles.length} readable file${ignoreFiles.length === 1 ? "" : "s"}).`] });
      }
      return roots.length ? { outcome: "applied", roots } : { outcome: "not_applicable" };
    },
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
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) { const error = new Error("Operation cancelled."); error.name = "AbortError"; throw error; } }
