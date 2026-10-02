import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleShelvesetListObservation, presentShelvesetListObservation, shelvesetListPayload, ShelvesetListError, validShelvesetId, validShelvesetQueryString, SHELVESET_LIST_MAX_BYTES, type ShelvesetListArgs } from "../operations/shelveset-list";
import { ShelvesetListCommandError } from "../execution/shelveset-list-command";
import { getActiveAbortSignal } from "../execution/context";
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const integer = (maximum: number) => Type.Integer({ minimum: 0, maximum });
const queryString = nullable(Type.String({ maxLength: 4096, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]*$" }));
const query = object({ owner: queryString, commentLike: queryString, dateFrom: queryString, limit: nullable(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })) });
const common = { schemaVersion: Type.Literal(1), action: Type.Literal("shelveset-list"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }) };
const dataCommon = { scope: Type.Literal("workspace_repository"), qualifierVerified: Type.Literal(false), query, limits: object({ maxItems: Type.Integer({ minimum: 1, maximum: 500 }), idDigits: Type.Literal(20), queryCodeUnits: Type.Literal(4096), compactUtf8Bytes: Type.Literal(131072) }) };
const errorCode = Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("malformed_output"), Type.Literal("invalid_identity"), Type.Literal("unsupported_query"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow")]);
export const shelvesetListOutputSchema = Type.Union([
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("complete"), capture: Type.Literal("complete"), projection: Type.Boolean() }), data: object({ ...dataCommon, mode: Type.Literal("ids"), basis: Type.Literal("find_shelve_id_utf8"), diagnostics: object({ duplicateRecords: integer(19999) }), rows: Type.Array(object({ id: Type.String({ minLength: 1, maxLength: 20, pattern: "^(?:0|[1-9][0-9]*)$" }), shelveset: Type.String({ minLength: 4, maxLength: 23, pattern: "^sh:(?:0|[1-9][0-9]*)$" }) }), { maxItems: 500 }), countBasis: Type.Literal("observed_query_rows"), counts: object({ observed: integer(20000), returned: integer(500), omitted: integer(20000), excluded: Type.Literal(0) }) }) }),
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("unknown"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), data: object({ ...dataCommon, mode: Type.Literal("native"), basis: Type.Literal("find_shelve_native"), rows: Type.Null(), counts: Type.Null(), countBasis: Type.Literal("unavailable") }) }),
    object({ ...common, ok: Type.Literal(false), completeness: object({ read: Type.Literal("incomplete"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), error: object({ code: errorCode, message: Type.String({ minLength: 1, maxLength: 256 }) }) }),
]);
export type ShelvesetListOutput = Static<typeof shelvesetListOutputSchema>;
export type ShelvesetListErrorCode = Extract<ShelvesetListOutput, { ok: false }>["error"]["code"];
const failure = (code: ShelvesetListErrorCode): ShelvesetListOutput => ({ schemaVersion: 1, action: "shelveset-list", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message: `Shelveset list read failed (${code}); no reusable rows are available.` } });
export function validateShelvesetListOutput(value: unknown): ShelvesetListOutput {
    if (!Check(shelvesetListOutputSchema, value)) return failure("invalid_producer_data");
    const dto = value as ShelvesetListOutput;
    if (dto.ok) {
        if ([dto.data.query.owner, dto.data.query.commentLike, dto.data.query.dateFrom].some(value => value !== null && !validShelvesetQueryString(value))) return failure("invalid_producer_data");
        if (dto.data.mode === "ids") {
            const { rows, counts, diagnostics, limits, query } = dto.data;
            const repeats = rows.length - new Set(rows.map(row => row.id)).size;
            if (rows.some(row => !validShelvesetId(row.id) || row.shelveset !== `sh:${row.id}`)
                || counts.returned !== rows.length || counts.observed !== counts.returned + counts.omitted || counts.returned !== Math.min(counts.observed, limits.maxItems)
                || (query.limit !== null && counts.observed > query.limit) || dto.completeness.projection !== (counts.omitted === 0)
                || diagnostics.duplicateRecords < repeats || diagnostics.duplicateRecords > repeats + counts.omitted || diagnostics.duplicateRecords > Math.max(0, counts.observed - 1)) return failure("invalid_producer_data");
        }
    }
    if (Buffer.byteLength(JSON.stringify(dto), "utf8") > SHELVESET_LIST_MAX_BYTES) return failure("output_overflow");
    return dto;
}
export async function executeShelvesetListOutput(args: ShelvesetListArgs) {
    let dto: ShelvesetListOutput, rawResult: string | undefined;
    try {
        const observation = await assembleShelvesetListObservation(args, true);
        if (getActiveAbortSignal()?.aborted) throw new ShelvesetListCommandError("aborted");
        dto = validateShelvesetListOutput(shelvesetListPayload(observation));
        if (dto.ok) rawResult = args.output === "json" ? JSON.stringify(dto) : presentShelvesetListObservation(observation);
        if (getActiveAbortSignal()?.aborted) throw new ShelvesetListCommandError("aborted");
    } catch (error) { dto = failure(error instanceof ShelvesetListError || error instanceof ShelvesetListCommandError ? error.code : "invalid_producer_data"); }
    dto = validateShelvesetListOutput(dto);
    return { content: [{ type: "text" as const, text: dto.ok ? rawResult! : dto.error.message }], structuredContent: dto, isError: !dto.ok, details: { exportName: "shelvesetList", rawResult: dto.ok ? rawResult : undefined, ...(args.workdir ? { workdir: args.workdir } : {}) } };
}
