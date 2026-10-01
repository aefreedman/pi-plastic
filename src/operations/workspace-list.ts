import { runCm, normalizeFindOutputLines } from "../execution/cm";
import { spawnAndCollect, getCmExecutable } from "../execution/process";
import { commandExecutionStorage, getActiveAbortSignal } from "../execution/context";
import { runWorkspaceListFieldsCommand, WorkspaceListCommandError, WORKSPACE_LIST_CAPTURE_LIMITS } from "../execution/workspace-list-command";
import { toStructuredResult } from "../presentation/results";

export type WorkspaceListArgs = { source?: "native" | "fields"; format?: string; output?: "text" | "json"; maxItems?: number; workdir?: string };
export type WorkspaceRow = { name: string; path: string; guid: string };
export class WorkspaceListError extends Error {
    constructor(readonly code: "invalid_identity" | "malformed_output" | "unsupported_query" | "invalid_producer_data" | "output_overflow") { super(`Workspace list read failed (${code}); no reusable rows are available.`); }
}
export const WORKSPACE_LIST_MAX_BYTES = 131072;
export const WORKSPACE_FIELDS_FORMAT = "{wkname}{tab}{machine}{tab}{path}{tab}{wkid}";
export const validWorkspaceTemplate = (s: string) => s.length <= 4096 && !/[\u0000\uD800-\uDFFF]/u.test(s);
// ASCII output is not independent proof that original identities were ASCII:
// this source requires an independently known ASCII-name/path configuration.
export const validWorkspaceIdentity = (s: string) => s.length > 0 && s.length <= 4096 && /^[\x20-\x7e]+$/.test(s) && !s.includes("?");
export const validWorkspaceName = (s: string) => validWorkspaceIdentity(s) && !/[\\/@]/.test(s) && s.trim() === s;
export const validWorkspacePath = (s: string) => validWorkspaceIdentity(s) && (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\]+\\[^\\]+/.test(s));
export const validWorkspaceGuid = (s: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
export function workspaceListRequest(args: WorkspaceListArgs) {
    if ((args.source !== undefined && args.source !== "native" && args.source !== "fields") || (args.output !== undefined && args.output !== "text" && args.output !== "json")
        || (args.maxItems !== undefined && (!Number.isSafeInteger(args.maxItems) || args.maxItems < 1 || args.maxItems > 500))
        || (args.format !== undefined && (typeof args.format !== "string" || !validWorkspaceTemplate(args.format)))) throw new WorkspaceListError("invalid_producer_data");
    const source = args.source ?? "native";
    if (source === "fields" && args.format) throw new WorkspaceListError("unsupported_query");
    return { source, maxItems: args.maxItems ?? 100 };
}
export function workspaceListCommand(args: WorkspaceListArgs): string[] {
    const request = workspaceListRequest(args);
    return ["workspace", "list", ...(request.source === "fields" ? [`--format=${WORKSPACE_FIELDS_FORMAT}`] : args.format ? [`--format=${args.format}`] : [])];
}
export function parseWorkspaceListFields(bytes: Uint8Array): { rows: WorkspaceRow[]; duplicateRecords: number } {
    if (bytes.length > WORKSPACE_LIST_CAPTURE_LIMITS.stdoutBytes) throw new WorkspaceListCommandError("capture_incomplete");
    if (bytes.some(byte => byte > 127)) throw new WorkspaceListError("invalid_identity");
    if (!bytes.length) return { rows: [], duplicateRecords: 0 };
    const lines = Buffer.from(bytes).toString("ascii").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    if (lines.length > WORKSPACE_LIST_CAPTURE_LIMITS.records) throw new WorkspaceListCommandError("capture_incomplete");
    const rows: WorkspaceRow[] = [], guids = new Map<string, string>(), names = new Map<string, string>(), paths = new Map<string, string>();
    let duplicateRecords = 0;
    for (const line of lines) {
        const fields = line.split("\t");
        if (fields.length !== 4) throw new WorkspaceListError("malformed_output");
        const [name, machine, path, guid] = fields;
        if (!validWorkspaceName(name) || !validWorkspaceIdentity(machine) || !validWorkspacePath(path) || !validWorkspaceGuid(guid)) throw new WorkspaceListError("invalid_identity");
        // Exact repeated full records are observed again, not silently deduplicated.
        // Machine remains unpublished, but conflicts in it still fail the whole read.
        const prior = [guids.get(guid.toLowerCase()), names.get(name), paths.get(path)].filter(value => value !== undefined);
        if (prior.some(value => value !== line)) throw new WorkspaceListError("malformed_output");
        if (prior.length) duplicateRecords++;
        guids.set(guid.toLowerCase(), line); names.set(name, line); paths.set(path, line); rows.push({ name, path, guid });
    }
    return { rows, duplicateRecords };
}
export type WorkspaceListObservation = { maxItems: number } & ({ source: "native"; rawResult: string; command: string[] } | { source: "fields"; rows: WorkspaceRow[]; duplicateRecords: number });
export async function assembleWorkspaceListObservation(args: WorkspaceListArgs, typedNative = false): Promise<WorkspaceListObservation> {
    const request = workspaceListRequest(args), command = workspaceListCommand(args);
    if (request.source === "fields") {
        const bytes = await runWorkspaceListFieldsCommand(command, args.workdir);
        if (getActiveAbortSignal()?.aborted) throw new WorkspaceListCommandError("aborted");
        const parsed = parseWorkspaceListFields(bytes);
        if (getActiveAbortSignal()?.aborted) throw new WorkspaceListCommandError("aborted");
        return { ...request, source: "fields", ...parsed };
    }
    if (!typedNative) return { ...request, source: "native", command, rawResult: await runCm(command, args.workdir) };
    const signal = getActiveAbortSignal();
    if (signal?.aborted) throw new WorkspaceListCommandError("aborted");
    let result;
    try { result = await spawnAndCollect(getCmExecutable(), command, args.workdir ?? process.cwd(), undefined, signal, commandExecutionStorage.getStore()); }
    catch { throw new WorkspaceListCommandError(signal?.aborted ? "aborted" : "command_failed"); }
    if (result.aborted || signal?.aborted) throw new WorkspaceListCommandError("aborted");
    if (result.timedOut || result.stdoutTruncated || result.stderrTruncated) throw new WorkspaceListCommandError("capture_incomplete");
    if (result.exitCode !== 0) throw new WorkspaceListCommandError("command_failed");
    return { ...request, source: "native", command, rawResult: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)" };
}
export const workspaceCapability = { identities: "ascii_names_and_paths_only", prerequisite: "original_names_and_paths_are_ascii", originalVerification: "not_performed", formatterLoss: "non_ascii_may_be_replaced_or_best_fit_to_ascii" } as const;
export function workspaceListPayload(observation: WorkspaceListObservation) {
    const common = { schemaVersion: 1, action: "workspace-list", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: true } as const;
    const data = { scope: "local_client_inventory", limits: { maxItems: observation.maxItems, identityCodeUnits: 4096, compactUtf8Bytes: WORKSPACE_LIST_MAX_BYTES } } as const;
    const payload = observation.source === "native"
        ? { ...common, completeness: { read: "unknown", capture: "unknown", projection: false }, data: { ...data, mode: "native", basis: "workspace_list_native", capability: "noncanonical", pathBasis: "unavailable", rows: null, counts: null, countBasis: "unavailable" } }
        : { ...common, completeness: { read: "complete_under_ascii_prerequisite", capture: "complete", projection: observation.rows.length <= observation.maxItems }, data: { ...data, mode: "fields", basis: "workspace_list_tab_fields", capability: workspaceCapability, pathBasis: "producer_absolute", diagnostics: { duplicateRecords: observation.duplicateRecords }, rows: observation.rows.slice(0, observation.maxItems), countBasis: "observed_response_rows", counts: { observed: observation.rows.length, returned: Math.min(observation.rows.length, observation.maxItems), omitted: Math.max(0, observation.rows.length - observation.maxItems), excluded: 0 } } };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > WORKSPACE_LIST_MAX_BYTES) throw new WorkspaceListError("output_overflow");
    return payload;
}
export async function presentWorkspaceListObservation(observation: WorkspaceListObservation, args: WorkspaceListArgs): Promise<string> {
    if (observation.source === "native") return toStructuredResult("workspace-list", args.output ?? "text", observation.rawResult, { command: ["cm", ...observation.command], rawOutput: observation.rawResult, resultCount: normalizeFindOutputLines(observation.rawResult).length }, args.workdir);
    if (args.output === "json") return JSON.stringify(workspaceListPayload(observation));
    const rows = observation.rows.slice(0, observation.maxItems), omitted = observation.rows.length - rows.length;
    return ["ASCII-only workspace names/paths required; originals are not independently verified by this read.", ...(rows.length ? rows.map(row => `${row.name}\t${row.path}\t${row.guid}`) : ["(no observed inventory rows)"]), ...(omitted ? [`(${omitted} observed rows omitted from presentation.)`] : [])].join("\n");
}
