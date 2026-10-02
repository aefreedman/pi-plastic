import { cmWhereEquals, cmWhereLike, escapeCmWhereValue } from "../domain/branches";
import { runCm } from "../execution/cm";
import { spawnAndCollect, getCmExecutable } from "../execution/process";
import { commandExecutionStorage, getActiveAbortSignal } from "../execution/context";
import { runShelvesetListIdsCommand, ShelvesetListCommandError, SHELVESET_LIST_CAPTURE_LIMITS } from "../execution/shelveset-list-command";

export type ShelvesetListArgs = { owner?: string; commentLike?: string; dateFrom?: string; limit?: number; format?: string; dateFormat?: string; source?: "native" | "ids"; output?: "text" | "json"; maxItems?: number; workdir?: string };
export type ShelvesetListQuery = { owner: string | null; commentLike: string | null; dateFrom: string | null; limit: number | null };
export class ShelvesetListError extends Error {
    constructor(readonly code: "invalid_identity" | "malformed_output" | "unsupported_query" | "invalid_producer_data" | "output_overflow") { super(`Shelveset list read failed (${code}); no reusable rows are available.`); }
}
export const SHELVESET_LIST_MAX_BYTES = 131072;
export const validShelvesetQueryString = (s: string) => s.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(s);
export const validShelvesetTemplate = (s: string) => s.length <= 4096 && !/[\u0000\uD800-\uDFFF]/u.test(s);
// Decimal strings retain exact integers beyond JavaScript's safe-number range.
export const validShelvesetId = (s: string) => s.length <= 20 && /^(?:0|[1-9][0-9]*)$/.test(s);
export function shelvesetListRequest(args: ShelvesetListArgs) {
    for (const value of [args.owner, args.commentLike, args.dateFrom])
        if (value !== undefined && (typeof value !== "string" || !validShelvesetQueryString(value))) throw new ShelvesetListError("invalid_identity");
    for (const value of [args.format, args.dateFormat])
        if (value !== undefined && (typeof value !== "string" || !validShelvesetTemplate(value))) throw new ShelvesetListError("invalid_producer_data");
    if ((args.source !== undefined && args.source !== "native" && args.source !== "ids")
        || (args.output !== undefined && args.output !== "text" && args.output !== "json")
        || (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1))
        || (args.maxItems !== undefined && (!Number.isSafeInteger(args.maxItems) || args.maxItems < 1 || args.maxItems > 500))) throw new ShelvesetListError("invalid_producer_data");
    const source = args.source ?? "native";
    if (source === "ids" && (args.format || args.dateFormat)) throw new ShelvesetListError("unsupported_query");
    return { source, maxItems: args.maxItems ?? 100, query: { owner: args.owner ?? null, commentLike: args.commentLike ?? null, dateFrom: args.dateFrom ?? null, limit: args.limit ?? null } };
}
export function shelvesetListCommand(args: ShelvesetListArgs): string[] {
    const { source, query } = shelvesetListRequest(args);
    const where: string[] = [];
    if (query.owner) where.push(cmWhereEquals("owner", query.owner));
    if (query.commentLike) where.push(cmWhereLike("comment", query.commentLike));
    if (query.dateFrom) where.push(`date >= '${escapeCmWhereValue(query.dateFrom)}'`);
    return ["find", "shelve", ...(where.length ? [`where ${where.join(" and ")}`] : []),
        ...(query.limit ? [`limit ${query.limit}`] : []),
        ...(source === "native" && args.format ? [`--format=${args.format}`] : []),
        ...(source === "native" && args.dateFormat ? [`--dateformat=${args.dateFormat}`] : []),
        "--nototal", ...(source === "ids" ? ["--format={shelveid}", "--encoding=utf-8"] : [])];
}
export function parseShelvesetListIds(bytes: Uint8Array): { ids: string[]; duplicateRecords: number } {
    if (bytes.byteLength > SHELVESET_LIST_CAPTURE_LIMITS.stdoutBytes) throw new ShelvesetListCommandError("capture_incomplete");
    if (bytes.some(byte => byte > 127)) throw new ShelvesetListError("invalid_identity");
    if (!bytes.length) return { ids: [], duplicateRecords: 0 };
    const ids = Buffer.from(bytes).toString("ascii").split(/\r?\n/);
    if (ids.at(-1) === "") ids.pop();
    if (ids.length > SHELVESET_LIST_CAPTURE_LIMITS.records) throw new ShelvesetListCommandError("capture_incomplete");
    if (ids.some(id => !validShelvesetId(id))) throw new ShelvesetListError("invalid_identity");
    return { ids, duplicateRecords: ids.length - new Set(ids).size };
}
export type ShelvesetListObservation = ReturnType<typeof shelvesetListRequest> & ({ source: "native"; rawResult: string } | { source: "ids"; ids: string[]; duplicateRecords: number });
export async function assembleShelvesetListObservation(args: ShelvesetListArgs, typedNative = false): Promise<ShelvesetListObservation> {
    const request = shelvesetListRequest(args), command = shelvesetListCommand(args);
    if (request.source === "ids") {
        const bytes = await runShelvesetListIdsCommand(command, args.workdir);
        if (getActiveAbortSignal()?.aborted) throw new ShelvesetListCommandError("aborted");
        const parsed = parseShelvesetListIds(bytes);
        if (getActiveAbortSignal()?.aborted) throw new ShelvesetListCommandError("aborted");
        return { ...request, source: "ids", ...parsed };
    }
    if (!typedNative) return { ...request, source: "native", rawResult: await runCm(command, args.workdir) };
    const signal = getActiveAbortSignal();
    if (signal?.aborted) throw new ShelvesetListCommandError("aborted");
    let result;
    try { result = await spawnAndCollect(getCmExecutable(), command, args.workdir ?? process.cwd(), undefined, signal, commandExecutionStorage.getStore()); }
    catch { throw new ShelvesetListCommandError(signal?.aborted ? "aborted" : "command_failed"); }
    if (result.aborted || signal?.aborted) throw new ShelvesetListCommandError("aborted");
    if (result.timedOut || result.stdoutTruncated || result.stderrTruncated) throw new ShelvesetListCommandError("capture_incomplete");
    if (result.exitCode !== 0) throw new ShelvesetListCommandError("command_failed");
    return { ...request, source: "native", rawResult: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)" };
}
export function shelvesetListPayload(observation: ShelvesetListObservation) {
    const common = { schemaVersion: 1, action: "shelveset-list", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: true } as const;
    const data = { scope: "workspace_repository", qualifierVerified: false, query: observation.query, limits: { maxItems: observation.maxItems, idDigits: 20, queryCodeUnits: 4096, compactUtf8Bytes: SHELVESET_LIST_MAX_BYTES } } as const;
    const payload = observation.source === "native"
        ? { ...common, completeness: { read: "unknown", capture: "unknown", projection: false }, data: { ...data, mode: "native", basis: "find_shelve_native", rows: null, counts: null, countBasis: "unavailable" } }
        : { ...common, completeness: { read: "complete", capture: "complete", projection: observation.ids.length <= observation.maxItems }, data: { ...data, mode: "ids", basis: "find_shelve_id_utf8", diagnostics: { duplicateRecords: observation.duplicateRecords }, rows: observation.ids.slice(0, observation.maxItems).map(id => ({ id, shelveset: `sh:${id}` })), countBasis: "observed_query_rows", counts: { observed: observation.ids.length, returned: Math.min(observation.ids.length, observation.maxItems), omitted: Math.max(0, observation.ids.length - observation.maxItems), excluded: 0 } } };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > SHELVESET_LIST_MAX_BYTES) throw new ShelvesetListError("output_overflow");
    return payload;
}
export function presentShelvesetListObservation(observation: ShelvesetListObservation): string {
    if (observation.source === "native") return observation.rawResult;
    const ids = observation.ids.slice(0, observation.maxItems), omitted = observation.ids.length - ids.length;
    return [...(ids.length ? ids.map(id => `sh:${id}`) : ["(no observed query rows)"]), ...(omitted ? [`(${omitted} observed query rows omitted from presentation.)`] : [])].join("\n");
}
export async function executeShelvesetList(args: ShelvesetListArgs): Promise<string> {
    const observation = await assembleShelvesetListObservation(args);
    return args.output === "json" ? JSON.stringify(shelvesetListPayload(observation)) : presentShelvesetListObservation(observation);
}
