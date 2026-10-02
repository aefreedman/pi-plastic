import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleCodeReviewFindObservation, presentCodeReviewFindObservation, codeReviewFindPayload, CodeReviewFindError, validCodeReviewId, validCodeReviewQueryString, CODE_REVIEW_FIND_MAX_BYTES, type CodeReviewFindArgs } from "../operations/code-review-find";
import { CodeReviewFindCommandError } from "../execution/code-review-find-command";
import { getActiveAbortSignal } from "../execution/context";
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const integer = (maximum: number) => Type.Integer({ minimum: 0, maximum });
const queryString = nullable(Type.String({ maxLength: 4096, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]*$" }));
const query = object({ status: queryString, assignee: queryString, owner: queryString, target: queryString, titleLike: queryString, targetType: nullable(Type.Union([Type.Literal("branch"), Type.Literal("changeset")])), orderBy: nullable(Type.Union([Type.Literal("date"), Type.Literal("modifieddate"), Type.Literal("status")])), descending: nullable(Type.Boolean()), limit: nullable(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })) });
const common = { schemaVersion: Type.Literal(1), action: Type.Literal("code-review-find"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }) };
const dataCommon = { scope: Type.Literal("workspace_repository"), qualifierVerified: Type.Literal(false), query, limits: object({ maxItems: Type.Integer({ minimum: 1, maximum: 500 }), idDigits: Type.Literal(20), queryCodeUnits: Type.Literal(4096), compactUtf8Bytes: Type.Literal(131072) }) };
const errorCode = Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("malformed_output"), Type.Literal("invalid_identity"), Type.Literal("unsupported_query"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow")]);
export const codeReviewFindOutputSchema = Type.Union([
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("complete"), capture: Type.Literal("complete"), projection: Type.Boolean() }), data: object({ ...dataCommon, mode: Type.Literal("ids"), basis: Type.Literal("find_review_id_utf8"), diagnostics: object({ duplicateRecords: integer(19999) }), rows: Type.Array(object({ id: Type.String({ minLength: 1, maxLength: 20, pattern: "^(?:0|[1-9][0-9]*)$" }) }), { maxItems: 500 }), countBasis: Type.Literal("observed_query_rows"), counts: object({ observed: integer(20000), returned: integer(500), omitted: integer(20000), excluded: Type.Literal(0) }) }) }),
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("unknown"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), data: object({ ...dataCommon, mode: Type.Literal("native"), basis: Type.Literal("find_review_native"), rows: Type.Null(), counts: Type.Null(), countBasis: Type.Literal("unavailable") }) }),
    object({ ...common, ok: Type.Literal(false), completeness: object({ read: Type.Literal("incomplete"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), error: object({ code: errorCode, message: Type.String({ minLength: 1, maxLength: 256 }) }) }),
]);
export type CodeReviewFindOutput = Static<typeof codeReviewFindOutputSchema>;
export type CodeReviewFindErrorCode = Extract<CodeReviewFindOutput, { ok: false }>["error"]["code"];
const failure = (code: CodeReviewFindErrorCode): CodeReviewFindOutput => ({ schemaVersion: 1, action: "code-review-find", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message: `Code review find read failed (${code}); no reusable rows are available.` } });
export function validateCodeReviewFindOutput(value: unknown): CodeReviewFindOutput {
    if (!Check(codeReviewFindOutputSchema, value)) return failure("invalid_producer_data");
    const dto = value as CodeReviewFindOutput;
    if (dto.ok) {
        if ([dto.data.query.status, dto.data.query.assignee, dto.data.query.owner, dto.data.query.target, dto.data.query.titleLike].some(value => value !== null && !validCodeReviewQueryString(value))) return failure("invalid_producer_data");
        if (dto.data.mode === "ids") {
            const { rows, counts, diagnostics, limits, query } = dto.data;
            const repeats = rows.length - new Set(rows.map(row => row.id)).size;
            if (rows.some(row => !validCodeReviewId(row.id))
                || counts.returned !== rows.length || counts.observed !== counts.returned + counts.omitted || counts.returned !== Math.min(counts.observed, limits.maxItems)
                || (query.limit !== null && counts.observed > query.limit) || dto.completeness.projection !== (counts.omitted === 0)
                || diagnostics.duplicateRecords < repeats || diagnostics.duplicateRecords > repeats + counts.omitted || diagnostics.duplicateRecords > Math.max(0, counts.observed - 1)) return failure("invalid_producer_data");
        }
    }
    if (Buffer.byteLength(JSON.stringify(dto), "utf8") > CODE_REVIEW_FIND_MAX_BYTES) return failure("output_overflow");
    return dto;
}
export async function executeCodeReviewFindOutput(args: CodeReviewFindArgs) {
    let dto: CodeReviewFindOutput, rawResult: string | undefined;
    try {
        const observation = await assembleCodeReviewFindObservation(args, true);
        if (getActiveAbortSignal()?.aborted) throw new CodeReviewFindCommandError("aborted");
        dto = validateCodeReviewFindOutput(codeReviewFindPayload(observation));
        if (dto.ok) rawResult = await presentCodeReviewFindObservation(observation, args);
        if (getActiveAbortSignal()?.aborted) throw new CodeReviewFindCommandError("aborted");
    } catch (error) { dto = failure(error instanceof CodeReviewFindError || error instanceof CodeReviewFindCommandError ? error.code : "invalid_producer_data"); }
    dto = validateCodeReviewFindOutput(dto);
    return { content: [{ type: "text" as const, text: dto.ok ? rawResult! : dto.error.message }], structuredContent: dto, isError: !dto.ok, details: { exportName: "codeReviewFind", rawResult: dto.ok ? rawResult : undefined, ...(args.workdir ? { workdir: args.workdir } : {}) } };
}
