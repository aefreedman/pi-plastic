import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleAddReceipt, emptyAddData, addFailure, presentAddReceipt, safeAddText, ADD_COMMAND, validAddOperands, type AddReceipt } from "../operations/add-receipt";
const object = (p: Record<string, any>) => Type.Object(p, { additionalProperties: false });
const enumeration = (values: readonly string[]) => Type.Union(values.map(value => Type.Literal(value)));
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const attempt = object({ state: enumeration(["not-attempted", "not-started", "started", "unknown"]), terminal: enumeration(["not-observed", "observed"]), exitCode: Type.Union([uint(2147483647), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = object({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
const data = { intendedArgv: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 257 }), requestedOperandCount: Type.Union([uint(256), Type.Null()]), workingDirectory: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]), attempt, capture: Type.Union([capture, Type.Null()]), observedWorkspaceIdentity: Type.Null(), observedAddedItems: Type.Null(), verification: Type.Literal("unverified") };
const header = { schemaVersion: Type.Literal(1), action: Type.Literal("add"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: object({ capture: enumeration(["complete", "incomplete", "unknown"]), projection: Type.Literal(true) }) };
const error = object({ code: enumeration(["invalid_request", "launch_failed", "aborted", "uncertain", "producer_failed"]), message: Type.String({ minLength: 1, maxLength: 256 }) });
export const addOutputSchema = Type.Unsafe<AddReceipt>(Type.Union([
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("command-completed"), data: object({ ...data, effect: Type.Literal("not-proven") }) }),
    object({ ...header, ok: Type.Literal(false), outcome: Type.Literal("failed"), data: object({ ...data, effect: Type.Literal("not-attempted") }), error }),
    object({ ...header, ok: Type.Literal(false), outcome: Type.Literal("uncertain"), data: object({ ...data, effect: Type.Literal("uncertain") }), error }),
]));
export function validateAddOutput(value: unknown): value is AddReceipt {
    if (!Check(addOutputSchema, value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 131072) return false;
    const dto = value as AddReceipt, d = dto.data, a = d.attempt, c = d.capture;
    if (d.intendedArgv[0] !== ADD_COMMAND) return false;
    if (d.requestedOperandCount === null) {
        if (d.intendedArgv.length !== 1 || d.workingDirectory !== null || c || !["not-attempted", "unknown"].includes(a.state)) return false;
    } else if (!validAddOperands(d.intendedArgv.slice(1)) || d.requestedOperandCount !== d.intendedArgv.length - 1 || !d.workingDirectory) return false;
    if (d.workingDirectory !== null && !safeAddText(d.workingDirectory)) return false;
    if (!dto.ok && !safeAddText(dto.error.message)) return false;
    if (a.exitCode !== null && a.terminal !== "observed" || a.state === "not-attempted" && (a.terminal !== "not-observed" || a.exitCode !== null || a.timedOut) || a.state === "not-started" && (a.terminal !== "not-observed" || a.exitCode !== null)) return false;
    if (c) {
        if (!d.workingDirectory || c.stdoutRetainedBytes > c.stdoutBytes || c.stderrRetainedBytes > c.stderrBytes) return false;
        if (c.complete && (!c.validUtf8 || c.truncated || c.stdoutBytes !== c.stdoutRetainedBytes || c.stderrBytes !== c.stderrRetainedBytes || a.state !== "started" || a.terminal !== "observed" || a.exitCode === null || a.aborted || a.timedOut)) return false;
        if (a.state === "not-attempted" && (!a.aborted || c.stdoutBytes || c.stderrBytes || c.validUtf8 || c.complete)) return false;
    }
    if (dto.completeness.capture !== (c ? c.complete ? "complete" : "incomplete" : "unknown")) return false;
    if (dto.ok && (d.requestedOperandCount === null || !d.workingDirectory || !c?.complete || a.state !== "started" || a.terminal !== "observed" || a.exitCode !== 0 || a.aborted || a.timedOut)) return false;
    if (!dto.ok && dto.outcome === "uncertain" && !["started", "unknown"].includes(a.state)) return false;
    if (!dto.ok && dto.outcome === "failed" && !["not-attempted", "not-started"].includes(a.state)) return false;
    if (!dto.ok && dto.error.code === "invalid_request" && (d.workingDirectory !== null || c || a.state !== "not-attempted" || a.aborted)) return false;
    if (!dto.ok && dto.error.code === "aborted" && !a.aborted) return false;
    if (!dto.ok && dto.error.code === "launch_failed" && !["not-attempted", "not-started"].includes(a.state)) return false;
    return true;
}
export async function executeAddOutput(args: unknown) {
    let dto = await assembleAddReceipt(args);
    const valid: boolean = validateAddOutput(dto);
    if (!valid) {
        const possibleStart = !["not-attempted", "not-started"].includes(dto.data.attempt.state);
        const data = emptyAddData();
        if (possibleStart) { data.attempt.state = "unknown"; data.effect = "uncertain"; }
        dto = addFailure(data, "producer_failed", "Add receipt validation failed; do not retry automatically.");
        if (!validateAddOutput(dto)) throw new Error("Safe add receipt could not be constructed.");
    }
    return { content: [{ type: "text" as const, text: presentAddReceipt(dto) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
