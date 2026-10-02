import { cmWhereEquals, cmWhereLike } from "../domain/branches";
import { toStructuredResult } from "../presentation/results";
import { runCm, normalizeFindOutputLines } from "../execution/cm";
import { spawnAndCollect, getCmExecutable } from "../execution/process";
import { commandExecutionStorage, getActiveAbortSignal } from "../execution/context";
import { runCodeReviewFindIdsCommand, CodeReviewFindCommandError, CODE_REVIEW_FIND_CAPTURE_LIMITS } from "../execution/code-review-find-command";

export type CodeReviewFindArgs = { status?: string; assignee?: string; owner?: string; target?: string; targetType?: "branch" | "changeset"; titleLike?: string; orderBy?: "date" | "modifieddate" | "status"; descending?: boolean; limit?: number; format?: string; dateFormat?: string; source?: "native" | "ids"; output?: "text" | "json"; maxItems?: number; workdir?: string };
export type CodeReviewFindQuery = { status: string | null; assignee: string | null; owner: string | null; target: string | null; targetType: "branch" | "changeset" | null; titleLike: string | null; orderBy: "date" | "modifieddate" | "status" | null; descending: boolean | null; limit: number | null };
export class CodeReviewFindError extends Error {
    constructor(readonly code: "invalid_identity" | "malformed_output" | "unsupported_query" | "invalid_producer_data" | "output_overflow") { super(`Code review find read failed (${code}); no reusable rows are available.`); }
}
export const CODE_REVIEW_FIND_MAX_BYTES = 131072;
export const validCodeReviewQueryString = (s: string) => s.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(s);
export const validCodeReviewTemplate = (s: string) => s.length <= 4096 && !/[\u0000\uD800-\uDFFF]/u.test(s);
// Decimal strings retain exact integers beyond JavaScript's safe-number range.
export const validCodeReviewId = (s: string) => s.length <= 20 && /^(?:0|[1-9][0-9]*)$/.test(s);
export function codeReviewFindRequest(args: CodeReviewFindArgs) {
    for (const value of [args.status, args.assignee, args.owner, args.target, args.titleLike])
        if (value !== undefined && (typeof value !== "string" || !validCodeReviewQueryString(value))) throw new CodeReviewFindError("invalid_identity");
    for (const value of [args.format, args.dateFormat])
        if (value !== undefined && (typeof value !== "string" || !validCodeReviewTemplate(value))) throw new CodeReviewFindError("invalid_producer_data");
    if ((args.source !== undefined && args.source !== "native" && args.source !== "ids")
        || (args.targetType !== undefined && args.targetType !== "branch" && args.targetType !== "changeset")
        || (args.orderBy !== undefined && !["date", "modifieddate", "status"].includes(args.orderBy))
        || (args.descending !== undefined && typeof args.descending !== "boolean")
        || (args.output !== undefined && args.output !== "text" && args.output !== "json")
        || (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1))
        || (args.maxItems !== undefined && (!Number.isSafeInteger(args.maxItems) || args.maxItems < 1 || args.maxItems > 500))) throw new CodeReviewFindError("invalid_producer_data");
    const source = args.source ?? "native";
    if (source === "ids" && (args.format || args.dateFormat)) throw new CodeReviewFindError("unsupported_query");
    return { source, maxItems: args.maxItems ?? 100, query: { status: args.status ?? null, assignee: args.assignee ?? null, owner: args.owner ?? null, target: args.target ?? null, targetType: args.targetType ?? null, titleLike: args.titleLike ?? null, orderBy: args.orderBy ?? null, descending: args.descending ?? null, limit: args.limit ?? null } };
}
export function codeReviewFindCommand(args: CodeReviewFindArgs): string[] {
    const { source, query } = codeReviewFindRequest(args);
    const where: string[] = [];
    for (const field of ["status", "assignee", "owner", "target", "targetType"] as const)
        if (query[field]) where.push(cmWhereEquals(field === "targetType" ? "targettype" : field, query[field]));
    if (query.titleLike) where.push(cmWhereLike("title", query.titleLike));
    return ["find", "review", ...(where.length ? [`where ${where.join(" and ")}`] : []),
        ...(query.orderBy ? [`order by ${query.orderBy}${query.descending ? " desc" : " asc"}`] : []),
        ...(query.limit ? [`limit ${query.limit}`] : []),
        ...(source === "native" && args.format ? [`--format=${args.format}`] : []),
        ...(source === "native" && args.dateFormat ? [`--dateformat=${args.dateFormat}`] : []),
        "--nototal", ...(source === "ids" ? ["--format={id}", "--encoding=utf-8"] : [])];
}
export function parseCodeReviewFindIds(bytes: Uint8Array): { ids: string[]; duplicateRecords: number } {
    if (bytes.byteLength > CODE_REVIEW_FIND_CAPTURE_LIMITS.stdoutBytes) throw new CodeReviewFindCommandError("capture_incomplete");
    if (bytes.some(byte => byte > 127)) throw new CodeReviewFindError("invalid_identity");
    if (!bytes.length) return { ids: [], duplicateRecords: 0 };
    const ids = Buffer.from(bytes).toString("ascii").split(/\r?\n/);
    if (ids.at(-1) === "") ids.pop();
    if (ids.length > CODE_REVIEW_FIND_CAPTURE_LIMITS.records) throw new CodeReviewFindCommandError("capture_incomplete");
    if (ids.some(id => !validCodeReviewId(id))) throw new CodeReviewFindError("invalid_identity");
    return { ids, duplicateRecords: ids.length - new Set(ids).size };
}
export type CodeReviewFindObservation = ReturnType<typeof codeReviewFindRequest> & ({ source: "native"; command: string[]; rawResult: string } | { source: "ids"; ids: string[]; duplicateRecords: number });
export async function assembleCodeReviewFindObservation(args: CodeReviewFindArgs, typedNative = false): Promise<CodeReviewFindObservation> {
    const request = codeReviewFindRequest(args), command = codeReviewFindCommand(args);
    if (request.source === "ids") {
        const bytes = await runCodeReviewFindIdsCommand(command, args.workdir);
        if (getActiveAbortSignal()?.aborted) throw new CodeReviewFindCommandError("aborted");
        const parsed = parseCodeReviewFindIds(bytes);
        if (request.query.limit !== null && parsed.ids.length > request.query.limit) throw new CodeReviewFindError("invalid_producer_data");
        if (getActiveAbortSignal()?.aborted) throw new CodeReviewFindCommandError("aborted");
        return { ...request, source: "ids", ...parsed };
    }
    if (!typedNative) return { ...request, source: "native", command, rawResult: await runCm(command, args.workdir) };
    const signal = getActiveAbortSignal();
    if (signal?.aborted) throw new CodeReviewFindCommandError("aborted");
    let result;
    try { result = await spawnAndCollect(getCmExecutable(), command, args.workdir ?? process.cwd(), undefined, signal, commandExecutionStorage.getStore()); }
    catch { throw new CodeReviewFindCommandError(signal?.aborted ? "aborted" : "command_failed"); }
    if (result.aborted || signal?.aborted) throw new CodeReviewFindCommandError("aborted");
    if (result.timedOut || result.stdoutTruncated || result.stderrTruncated) throw new CodeReviewFindCommandError("capture_incomplete");
    if (result.exitCode !== 0) throw new CodeReviewFindCommandError("command_failed");
    return { ...request, source: "native", command, rawResult: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)" };
}
export function codeReviewFindPayload(observation: CodeReviewFindObservation) {
    const common = { schemaVersion: 1, action: "code-review-find", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: true } as const;
    const data = { scope: "workspace_repository", qualifierVerified: false, query: observation.query, limits: { maxItems: observation.maxItems, idDigits: 20, queryCodeUnits: 4096, compactUtf8Bytes: CODE_REVIEW_FIND_MAX_BYTES } } as const;
    const payload = observation.source === "native"
        ? { ...common, completeness: { read: "unknown", capture: "unknown", projection: false }, data: { ...data, mode: "native", basis: "find_review_native", rows: null, counts: null, countBasis: "unavailable" } }
        : { ...common, completeness: { read: "complete", capture: "complete", projection: observation.ids.length <= observation.maxItems }, data: { ...data, mode: "ids", basis: "find_review_id_utf8", diagnostics: { duplicateRecords: observation.duplicateRecords }, rows: observation.ids.slice(0, observation.maxItems).map(id => ({ id })), countBasis: "observed_query_rows", counts: { observed: observation.ids.length, returned: Math.min(observation.ids.length, observation.maxItems), omitted: Math.max(0, observation.ids.length - observation.maxItems), excluded: 0 } } };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > CODE_REVIEW_FIND_MAX_BYTES) throw new CodeReviewFindError("output_overflow");
    return payload;
}
export async function presentCodeReviewFindObservation(observation: CodeReviewFindObservation, args: CodeReviewFindArgs): Promise<string> {
    if (observation.source === "native") return toStructuredResult("code-review-find", args.output ?? "text", observation.rawResult,
        { command: ["cm", ...observation.command], rawOutput: observation.rawResult, resultCount: normalizeFindOutputLines(observation.rawResult).length }, args.workdir);
    if (args.output === "json") return JSON.stringify(codeReviewFindPayload(observation));
    const ids = observation.ids.slice(0, observation.maxItems), omitted = observation.ids.length - ids.length;
    return [...(ids.length ? ids : ["(no observed query rows)"]), ...(omitted ? [`(${omitted} observed query rows omitted from presentation.)`] : [])].join("\n");
}
export async function executeCodeReviewFind(args: CodeReviewFindArgs): Promise<string> {
    return presentCodeReviewFindObservation(await assembleCodeReviewFindObservation(args), args);
}
