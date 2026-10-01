import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleCurrentBranchObservation, assembleBranchExistsObservation, presentCurrentBranchObservation, presentBranchExistsObservation, BranchReadError, validBranchIdentity, type BranchReadObservation } from "../operations/branch-reads";

export const BRANCH_OUTPUT_MAX_BYTES = 16384;
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const identity = Type.String({ minLength: 1, maxLength: 4096, pattern: process.platform === "win32" ? "^[^\\u0000-\\u001f\\u007f-\\u009f\\uFFFD?]+$" : "^[^\\u0000-\\u001f\\u007f-\\u009f\\uFFFD]+$" });
const observedPath = Type.Intersect([identity, Type.String({ pattern: "^/[^/@\\\\]+(?:/[^/@\\\\]+)*$" })]);
const provenance = { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" } as const;
const provenanceSchema = object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") });
const errorSchema = object({ code: Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("invalid_identity"), Type.Literal("malformed_output"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow")]), message: Type.String({ minLength: 1, maxLength: 256 }) });
const completeness = (success: boolean) => object({ read: Type.Literal(success ? "complete" : "incomplete"), capture: Type.Literal(success ? "complete" : "unknown"), projection: Type.Literal(success) });
const common = <A extends string>(action: A) => ({ schemaVersion: Type.Literal(1), action: Type.Literal(action), provenance: provenanceSchema });
export const currentBranchOutputSchema = Type.Union([
    object({ ...common("current-branch"), ok: Type.Literal(true), completeness: completeness(true), data: object({ branch: observedPath, basis: Type.Union([Type.Literal("status"), Type.Literal("compact_status"), Type.Literal("changeset_lookup")]), scope: Type.Literal("workspace") }) }),
    object({ ...common("current-branch"), ok: Type.Literal(false), completeness: completeness(false), error: errorSchema }),
]);
export const branchExistsOutputSchema = Type.Union([
    object({ ...common("branch-exists"), ok: Type.Literal(true), completeness: completeness(true), data: object({ requestedBranch: identity, comparisonBranch: identity, scope: Type.Literal("workspace_repository"), qualifierVerified: Type.Optional(Type.Literal(false)), exists: Type.Boolean() }) }),
    object({ ...common("branch-exists"), ok: Type.Literal(false), completeness: completeness(false), error: errorSchema }),
]);
export type CurrentBranchOutput = Static<typeof currentBranchOutputSchema>;
export type BranchExistsOutput = Static<typeof branchExistsOutputSchema>;
export type BranchOutput = CurrentBranchOutput | BranchExistsOutput;
type Action = BranchOutput["action"];
const failure = (action: Action, code: Extract<BranchOutput, { ok: false }>["error"]["code"], message: string): BranchOutput => ({ schemaVersion: 1, action, provenance, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message } });
export function validateBranchOutput(action: Action, value: unknown): BranchOutput {
    if (!Check(action === "current-branch" ? currentBranchOutputSchema : branchExistsOutputSchema, value)) return failure(action, "invalid_producer_data", "Branch producer data did not match the output contract.");
    const dto = value as BranchOutput;
    if (dto.ok) {
        const identities = dto.action === "current-branch" ? [dto.data.branch] : [dto.data.requestedBranch, dto.data.comparisonBranch];
        if (identities.some(identity => !validBranchIdentity(identity))) return failure(action, "invalid_producer_data", "Branch producer identity was invalid or lossy.");
    }
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > BRANCH_OUTPUT_MAX_BYTES) return failure(action, "output_overflow", "Branch output exceeded the compact UTF-8 byte limit.");
    return value as BranchOutput;
}
export function projectBranchOutput(observation: BranchReadObservation): BranchOutput {
    const { action, ...data } = observation;
    return validateBranchOutput(action, { schemaVersion: 1, action, provenance, ok: true, completeness: { read: "complete", capture: "complete", projection: true }, data });
}
export async function executeBranchOutput(exportName: "currentBranch" | "branchExists", args: { branch?: string; format?: "text" | "json"; workdir?: string }) {
    const action = exportName === "currentBranch" ? "current-branch" : "branch-exists";
    let dto: BranchOutput;
    let rawResult: string | undefined;
    try {
        if (exportName === "currentBranch") {
            const observation = await assembleCurrentBranchObservation(args);
            dto = projectBranchOutput(observation);
            if (dto.ok) rawResult = await presentCurrentBranchObservation(observation, args);
        } else {
            if (typeof args.branch !== "string") throw new BranchReadError("invalid_identity");
            const observation = await assembleBranchExistsObservation({ ...args, branch: args.branch });
            dto = projectBranchOutput(observation);
            if (dto.ok) rawResult = presentBranchExistsObservation(observation);
        }
    } catch (error) {
        dto = failure(action, error instanceof BranchReadError ? error.code : "invalid_producer_data", error instanceof BranchReadError ? error.message : "Branch producer failed to produce valid data.");
    }
    // Validate even failures immediately before return.
    dto = validateBranchOutput(action, dto);
    return { content: [{ type: "text" as const, text: !dto.ok ? dto.error.message : dto.action === "current-branch" ? dto.data.branch : `${dto.data.exists} (workspace repository path comparison${dto.data.qualifierVerified === false ? "; requested repository qualifier NOT verified" : ""}).` }], structuredContent: dto, isError: !dto.ok,
        details: { exportName, rawResult, ...(args.workdir ? { workdir: args.workdir } : {}) } };
}
