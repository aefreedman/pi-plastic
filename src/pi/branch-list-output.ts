import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleBranchListObservation, presentBranchListObservation, branchListPayload, BranchListError, validBranchListIdentity, validBranchQueryString, type BranchListArgs, BRANCH_LIST_MAX_BYTES } from "../operations/branch-list";
import { getActiveAbortSignal } from "../execution/context";
import { BranchListCommandError } from "../execution/branch-list-command";

const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const integer = (maximum = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum });
const queryString = nullable(Type.String({ maxLength: 4096, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]*$" }));
const identity = Type.Intersect([
    Type.String({ minLength: 1, maxLength: 4096, pattern: process.platform === "win32" ? "^[^\\u0000-\\u001f\\u007f-\\u009f\\uFFFD?]+$" : "^[^\\u0000-\\u001f\\u007f-\\u009f\\uFFFD]+$" }),
    Type.String({ pattern: "^/[^/@\\\\]+(?:/[^/@\\\\]+)*$" }),
]);
const query = object({ nameLike: queryString, parent: queryString, owner: queryString, includeHidden: Type.Boolean(), orderBy: nullable(Type.Union([Type.Literal("date"), Type.Literal("branchname")])), descending: Type.Boolean(), limit: nullable(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })) });
const limits = object({ maxItems: Type.Integer({ minimum: 1, maximum: 500 }), identityCodeUnits: Type.Literal(4096), compactUtf8Bytes: Type.Literal(131072) });
const provenance = { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" } as const;
const common = { schemaVersion: Type.Literal(1), action: Type.Literal("branch-list"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }) };
const dataCommon = { scope: Type.Literal("workspace_repository"), qualifierVerified: Type.Literal(false), query, limits };
const errorCode = Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("malformed_output"), Type.Literal("invalid_identity"), Type.Literal("unsupported_query"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow")]);
export const branchListOutputSchema = Type.Union([
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("complete"), capture: Type.Literal("complete"), projection: Type.Boolean() }), data: object({ ...dataCommon, mode: Type.Literal("names"), basis: Type.Literal("find_branch_name_utf8"), rows: Type.Array(object({ branch: identity }), { maxItems: 500 }), countBasis: Type.Literal("observed_query_rows"), counts: object({ observed: integer(20000), returned: integer(500), omitted: integer(20000), excluded: Type.Literal(0) }) }) }),
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("unknown"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), data: object({ ...dataCommon, mode: Type.Literal("native"), basis: Type.Literal("find_branch_native"), rows: Type.Null(), countBasis: Type.Literal("unavailable"), counts: Type.Null() }) }),
    object({ ...common, ok: Type.Literal(false), completeness: object({ read: Type.Literal("incomplete"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), error: object({ code: errorCode, message: Type.String({ minLength: 1, maxLength: 256 }) }) }),
]);
export type BranchListOutput = Static<typeof branchListOutputSchema>;
export type BranchListErrorCode = Extract<BranchListOutput, { ok: false }>["error"]["code"];
const failure = (code: BranchListErrorCode): BranchListOutput => ({ schemaVersion: 1, action: "branch-list", provenance, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message: `Branch list read failed (${code}); no reusable rows are available.` } });
export function validateBranchListOutput(value: unknown): BranchListOutput {
    if (!Check(branchListOutputSchema, value)) return failure("invalid_producer_data");
    const dto = value as BranchListOutput;
    if (dto.ok) {
        if ([dto.data.query.nameLike, dto.data.query.parent, dto.data.query.owner].some(value => value !== null && !validBranchQueryString(value))) return failure("invalid_producer_data");
        if (dto.data.mode === "names") {
            const { counts, rows, limits, query } = dto.data;
            if (query.includeHidden || rows.some(row => !validBranchListIdentity(row.branch)) || new Set(rows.map(row => row.branch)).size !== rows.length
                || counts.returned !== rows.length || counts.observed !== counts.returned + counts.omitted
                || counts.returned !== Math.min(counts.observed, limits.maxItems)
                || (query.limit !== null && counts.observed > query.limit)
                || dto.completeness.projection !== (counts.omitted === 0)) return failure("invalid_producer_data");
        }
    }
    if (Buffer.byteLength(JSON.stringify(dto), "utf8") > BRANCH_LIST_MAX_BYTES) return failure("output_overflow");
    return dto;
}
export async function executeBranchListOutput(args: BranchListArgs) {
    let dto: BranchListOutput;
    let rawResult: string | undefined;
    try {
        const observation = await assembleBranchListObservation(args, true);
        if (getActiveAbortSignal()?.aborted) throw new BranchListCommandError("aborted");
        dto = validateBranchListOutput(branchListPayload(observation));
        if (dto.ok) rawResult = args.format === "json" ? JSON.stringify(dto) : presentBranchListObservation(observation);
    } catch (error) {
        dto = failure(error instanceof BranchListError || error instanceof BranchListCommandError ? error.code : "invalid_producer_data");
    }
    dto = validateBranchListOutput(dto);
    return { content: [{ type: "text" as const, text: dto.ok ? rawResult! : dto.error.message }], structuredContent: dto, isError: !dto.ok, details: { exportName: "branchList", rawResult: dto.ok ? rawResult : undefined, ...(args.workdir ? { workdir: args.workdir } : {}) } };
}
