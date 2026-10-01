import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleWorkspaceListObservation, presentWorkspaceListObservation, workspaceListPayload, WorkspaceListError, validWorkspaceName, validWorkspacePath, validWorkspaceGuid, workspaceCapability, WORKSPACE_LIST_MAX_BYTES, type WorkspaceListArgs } from "../operations/workspace-list";
import { WorkspaceListCommandError } from "../execution/workspace-list-command";
import { getActiveAbortSignal } from "../execution/context";
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const integer = (maximum: number) => Type.Integer({ minimum: 0, maximum });
const identity = Type.String({ minLength: 1, maxLength: 4096, pattern: "^[\\x20-\\x3e\\x40-\\x7e]+$" });
const common = { schemaVersion: Type.Literal(1), action: Type.Literal("workspace-list"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }) };
const dataCommon = { scope: Type.Literal("local_client_inventory"), limits: object({ maxItems: Type.Integer({ minimum: 1, maximum: 500 }), identityCodeUnits: Type.Literal(4096), compactUtf8Bytes: Type.Literal(131072) }) };
const capability = object({ identities: Type.Literal(workspaceCapability.identities), prerequisite: Type.Literal(workspaceCapability.prerequisite), originalVerification: Type.Literal(workspaceCapability.originalVerification), formatterLoss: Type.Literal(workspaceCapability.formatterLoss) });
const errorCode = Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("malformed_output"), Type.Literal("invalid_identity"), Type.Literal("unsupported_query"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow")]);
export const workspaceListOutputSchema = Type.Union([
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("complete_under_ascii_prerequisite"), capture: Type.Literal("complete"), projection: Type.Boolean() }), data: object({ ...dataCommon, mode: Type.Literal("fields"), basis: Type.Literal("workspace_list_tab_fields"), capability, pathBasis: Type.Literal("producer_absolute"), diagnostics: object({ duplicateRecords: integer(19999) }), rows: Type.Array(object({ name: identity, path: identity, guid: Type.String({ pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }) }), { maxItems: 500 }), countBasis: Type.Literal("observed_response_rows"), counts: object({ observed: integer(20000), returned: integer(500), omitted: integer(20000), excluded: Type.Literal(0) }) }) }),
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("unknown"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), data: object({ ...dataCommon, mode: Type.Literal("native"), basis: Type.Literal("workspace_list_native"), capability: Type.Literal("noncanonical"), pathBasis: Type.Literal("unavailable"), rows: Type.Null(), counts: Type.Null(), countBasis: Type.Literal("unavailable") }) }),
    object({ ...common, ok: Type.Literal(false), completeness: object({ read: Type.Literal("incomplete"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), error: object({ code: errorCode, message: Type.String({ minLength: 1, maxLength: 256 }) }) }),
]);
export type WorkspaceListOutput = Static<typeof workspaceListOutputSchema>;
export type WorkspaceListErrorCode = Extract<WorkspaceListOutput, { ok: false }>["error"]["code"];
const failure = (code: WorkspaceListErrorCode): WorkspaceListOutput => ({ schemaVersion: 1, action: "workspace-list", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message: `Workspace list read failed (${code}); no reusable rows are available.` } });
export function validateWorkspaceListOutput(value: unknown): WorkspaceListOutput {
    if (!Check(workspaceListOutputSchema, value)) return failure("invalid_producer_data");
    const dto = value as WorkspaceListOutput;
    if (dto.ok && dto.data.mode === "fields") {
        const { rows, counts, limits, diagnostics } = dto.data;
        const guids = new Map<string, string>(), names = new Map<string, string>(), paths = new Map<string, string>();
        let returnedDuplicates = 0, conflict = false;
        for (const row of rows) {
            const value = JSON.stringify(row);
            const prior = [guids.get(row.guid.toLowerCase()), names.get(row.name), paths.get(row.path)].filter(value => value !== undefined);
            if (prior.some(previous => previous !== value)) conflict = true;
            if (prior.length) returnedDuplicates++;
            guids.set(row.guid.toLowerCase(), value); names.set(row.name, value); paths.set(row.path, value);
        }
        if (rows.some(row => !validWorkspaceName(row.name) || !validWorkspacePath(row.path) || !validWorkspaceGuid(row.guid))
            || conflict || diagnostics.duplicateRecords < returnedDuplicates || diagnostics.duplicateRecords > returnedDuplicates + counts.omitted || diagnostics.duplicateRecords > Math.max(0, counts.observed - 1)
            || counts.returned !== rows.length || counts.observed !== counts.returned + counts.omitted || counts.returned !== Math.min(counts.observed, limits.maxItems) || dto.completeness.projection !== (counts.omitted === 0)) return failure("invalid_producer_data");
    }
    if (Buffer.byteLength(JSON.stringify(dto), "utf8") > WORKSPACE_LIST_MAX_BYTES) return failure("output_overflow");
    return dto;
}
export async function executeWorkspaceListOutput(args: WorkspaceListArgs) {
    let dto: WorkspaceListOutput, rawResult: string | undefined;
    try {
        const observation = await assembleWorkspaceListObservation(args, true);
        if (getActiveAbortSignal()?.aborted) throw new WorkspaceListCommandError("aborted");
        dto = validateWorkspaceListOutput(workspaceListPayload(observation));
        if (dto.ok) rawResult = await presentWorkspaceListObservation(observation, args);
        if (getActiveAbortSignal()?.aborted) throw new WorkspaceListCommandError("aborted");
    } catch (error) { dto = failure(error instanceof WorkspaceListError || error instanceof WorkspaceListCommandError ? error.code : "invalid_producer_data"); }
    dto = validateWorkspaceListOutput(dto);
    return { content: [{ type: "text" as const, text: dto.ok ? rawResult! : dto.error.message }], structuredContent: dto, isError: !dto.ok, details: { exportName: "workspaceList", rawResult: dto.ok ? rawResult : undefined, ...(args.workdir ? { workdir: args.workdir } : {}) } };
}
