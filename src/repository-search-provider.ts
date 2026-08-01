import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Structural copies of the narrow public v1 contract keep the policy module loadable
// when the optional registry package is absent. The installed registry validates the
// record when registration is available.
type RepoSearchOwnerV1 = Readonly<{ packageName: string; packageVersion: string; packageRoot: string; registeredBy: string }>;
type RepoSearchExecutionContextV1 = Readonly<{ cwd: string; requestId?: string; signal: AbortSignal }>;
type RepositoryPolicyRequestV1 = Readonly<{ workspaceRoot: string; roots: readonly string[]; includeHidden: boolean; options?: Readonly<Record<string, unknown>>; signal: AbortSignal }>;
type RepositoryPolicyResultV1 =
  | Readonly<{ outcome: "not_applicable" }>
  | Readonly<{ outcome: "applied"; roots: readonly Readonly<{ root: string; policyOwnedRoot?: string; excludeGlobs?: readonly string[]; ignoreFiles?: readonly string[]; disclosures: readonly string[] }>[] }>
  | Readonly<{ outcome: "unavailable" | "error"; code: string; retryable: boolean }>;
type RepositoryPolicyV1 = Readonly<{ contractVersion: 1; id: string; kind: "repository-search-policy"; owner: RepoSearchOwnerV1; evaluate(context: RepoSearchExecutionContextV1, request: RepositoryPolicyRequestV1): Promise<RepositoryPolicyResultV1> }>;
import { discoverPlasticWorkspace } from "./plastic-workspace.ts";

export const PLASTIC_REPOSITORY_SEARCH_POLICY_ID = "plastic.ignore-files" as const;

/** Resolve this physical package copy's identity for repository-search registration. */
export async function loadPlasticOwnerV1(moduleUrl: string = import.meta.url): Promise<RepoSearchOwnerV1> {
  const registeredBy = fileURLToPath(moduleUrl);
  const packageRoot = await realpath(fileURLToPath(new URL("../", moduleUrl)));
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
  if (manifest.name !== "@aefree/pi-plastic" || typeof manifest.version !== "string" || manifest.version.trim() === "") throw new Error(`Invalid @aefree/pi-plastic package identity at ${packageRoot}.`);
  return Object.freeze({ packageName: "@aefree/pi-plastic", packageVersion: manifest.version, packageRoot, registeredBy });
}

/** Independent executable policy for bounded Plastic ignore/cloaking discovery. */
export function createPlasticRepositorySearchPolicyV1(owner: RepoSearchOwnerV1): RepositoryPolicyV1 {
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
