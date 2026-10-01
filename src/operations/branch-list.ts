import { cmWhereEquals, cmWhereLike } from "../domain/branches";
import { runCm } from "../execution/cm";
import { spawnAndCollect, getCmExecutable } from "../execution/process";
import { commandExecutionStorage, getActiveAbortSignal } from "../execution/context";
import { runBranchListNamesCommand, BranchListCommandError, BRANCH_LIST_CAPTURE_LIMITS } from "../execution/branch-list-command";

export type BranchListArgs = { nameLike?: string; parent?: string; owner?: string; includeHidden?: boolean; limit?: number; orderBy?: "date" | "branchname"; descending?: boolean; workdir?: string; source?: "native" | "names"; format?: "text" | "json"; maxItems?: number };
export type BranchListQuery = { nameLike: string | null; parent: string | null; owner: string | null; includeHidden: boolean; limit: number | null; orderBy: "date" | "branchname" | null; descending: boolean };
export class BranchListError extends Error {
    constructor(readonly code: "invalid_identity" | "malformed_output" | "unsupported_query" | "invalid_producer_data" | "output_overflow") { super(`Branch list observation failed (${code}); no reusable rows are available.`); }
}
export const validBranchQueryString = (value: string): boolean => value.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value);
export const validBranchListIdentity = (value: string): boolean => value.length > 0 && value.length <= 4096
    && /^\/[^/@\\]+(?:\/[^/@\\]+)*$/u.test(value)
    && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF\uFFFD]/u.test(value)
    && !(process.platform === "win32" && value.includes("?"));
export function branchListRequest(args: BranchListArgs): { source: "native" | "names"; maxItems: number; query: BranchListQuery } {
    for (const value of [args.nameLike, args.parent, args.owner]) if (value !== undefined && (typeof value !== "string" || !validBranchQueryString(value))) throw new BranchListError("invalid_identity");
    if ((args.source !== undefined && args.source !== "native" && args.source !== "names")
        || (args.format !== undefined && args.format !== "text" && args.format !== "json")
        || (args.orderBy !== undefined && args.orderBy !== "date" && args.orderBy !== "branchname")
        || [args.includeHidden, args.descending].some(value => value !== undefined && typeof value !== "boolean")
        || (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1))
        || (args.maxItems !== undefined && (!Number.isSafeInteger(args.maxItems) || args.maxItems < 1 || args.maxItems > 500))) throw new BranchListError("invalid_producer_data");
    const source = args.source ?? "native";
    if (source === "names" && args.includeHidden === true) throw new BranchListError("unsupported_query");
    return { source, maxItems: args.maxItems ?? 100, query: { nameLike: args.nameLike ?? null, parent: args.parent ?? null, owner: args.owner ?? null, includeHidden: args.includeHidden ?? false, limit: args.limit ?? null, orderBy: args.orderBy ?? null, descending: args.descending ?? false } };
}
export function branchListCommand(query: BranchListQuery, source: "native" | "names"): string[] {
    const where: string[] = [];
    if (query.nameLike) where.push(cmWhereLike("name", query.nameLike));
    if (query.parent) where.push(cmWhereEquals("parent", query.parent));
    if (query.owner) where.push(cmWhereEquals("owner", query.owner));
    where.push(query.includeHidden ? "(hidden = 'true' or hidden = 'false')" : "hidden = 'false'");
    return ["find", "branch", `where ${where.join(" and ")}`, ...(query.orderBy ? [`order by ${query.orderBy}${query.descending ? " desc" : " asc"}`] : []), ...(query.limit ? [`limit ${query.limit}`] : []), "--nototal", ...(source === "names" ? ["--format={name}", "--encoding=utf-8"] : [])];
}
export function parseBranchListNames(bytes: Uint8Array): string[] {
    if (bytes.byteLength > BRANCH_LIST_CAPTURE_LIMITS.stdoutBytes) throw new BranchListCommandError("capture_incomplete");
    let output: string;
    // Preserve BOM as data: a foreign prefix must not silently disappear.
    try { output = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new BranchListError("invalid_identity"); }
    if (!output) return [];
    const rows = output.split(/\r?\n/u);
    if (rows.at(-1) === "") rows.pop();
    if (rows.length > BRANCH_LIST_CAPTURE_LIMITS.records) throw new BranchListCommandError("capture_incomplete");
    const seen = new Set<string>();
    for (const row of rows) {
        if (!validBranchListIdentity(row)) throw new BranchListError("invalid_identity");
        if (seen.has(row)) throw new BranchListError("malformed_output");
        seen.add(row);
    }
    return rows;
}
export type BranchListObservation = ReturnType<typeof branchListRequest> & ({ source: "native"; rawResult: string } | { source: "names"; branches: string[] });
export async function assembleBranchListObservation(args: BranchListArgs, typedNative = false): Promise<BranchListObservation> {
    const request = branchListRequest(args);
    const command = branchListCommand(request.query, request.source);
    if (request.source === "names") {
        const bytes = await runBranchListNamesCommand(command, args.workdir);
        if (getActiveAbortSignal()?.aborted) throw new BranchListCommandError("aborted");
        const branches = parseBranchListNames(bytes);
        if (getActiveAbortSignal()?.aborted) throw new BranchListCommandError("aborted");
        return { ...request, source: "names", branches };
    }
    // Core default keeps runCm's legacy string/error presentation. The registered
    // native adapter classifies observed process flags, never formatted errors.
    if (!typedNative) return { ...request, source: "native", rawResult: await runCm(command, args.workdir) };
    const signal = getActiveAbortSignal();
    if (signal?.aborted) throw new BranchListCommandError("aborted");
    let result;
    try { result = await spawnAndCollect(getCmExecutable(), command, args.workdir ?? process.cwd(), undefined, signal, commandExecutionStorage.getStore()); }
    catch { throw new BranchListCommandError(signal?.aborted ? "aborted" : "command_failed"); }
    if (result.aborted || signal?.aborted) throw new BranchListCommandError("aborted");
    if (result.timedOut || result.stdoutTruncated || result.stderrTruncated) throw new BranchListCommandError("capture_incomplete");
    if (result.exitCode !== 0) throw new BranchListCommandError("command_failed");
    return { ...request, source: "native", rawResult: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)" };
}
export function presentBranchListObservation(observation: BranchListObservation): string {
    if (observation.source === "native") return observation.rawResult;
    const returned = observation.branches.slice(0, observation.maxItems);
    const omitted = observation.branches.length - returned.length;
    return [...(returned.length ? returned : ["(no observed query rows)"]), ...(omitted ? [`(${omitted} observed query rows omitted from presentation.)`] : [])].join("\n");
}

export const BRANCH_LIST_MAX_BYTES = 131072;
export function branchListPayload(observation: BranchListObservation) {
    const common = { schemaVersion: 1, action: "branch-list", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: true } as const;
    const data = { scope: "workspace_repository", qualifierVerified: false, query: observation.query, limits: { maxItems: observation.maxItems, identityCodeUnits: 4096, compactUtf8Bytes: BRANCH_LIST_MAX_BYTES } } as const;
    const payload = observation.source === "native"
        ? { ...common, completeness: { read: "unknown", capture: "unknown", projection: false }, data: { ...data, mode: "native", basis: "find_branch_native", rows: null, countBasis: "unavailable", counts: null } }
        : { ...common, completeness: { read: "complete", capture: "complete", projection: observation.branches.length <= observation.maxItems }, data: { ...data, mode: "names", basis: "find_branch_name_utf8", rows: observation.branches.slice(0, observation.maxItems).map(branch => ({ branch })), countBasis: "observed_query_rows", counts: { observed: observation.branches.length, returned: Math.min(observation.branches.length, observation.maxItems), omitted: Math.max(0, observation.branches.length - observation.maxItems), excluded: 0 } } };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > BRANCH_LIST_MAX_BYTES) throw new BranchListError("output_overflow");
    return payload;
}
