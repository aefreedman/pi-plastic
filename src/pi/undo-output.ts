import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleUndoReceipt, emptyUndoData, undoFailure, presentUndoReceipt, safeUndoText, UNDO_COMMAND, validUndoOperands, type UndoReceipt } from "../operations/undo-receipt";
const object = (p: Record<string, any>) => Type.Object(p, { additionalProperties: false });
const enumeration = (values: readonly string[]) => Type.Union(values.map(value => Type.Literal(value)));
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const attempt = object({ state: enumeration(["not-attempted", "not-started", "started", "unknown"]), terminal: enumeration(["not-observed", "observed"]), exitCode: Type.Union([uint(2147483647), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = object({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
const data = { intendedArgv: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 257 }), requestedOperandCount: Type.Union([uint(256), Type.Null()]), workingDirectory: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]), attempt, capture: Type.Union([capture, Type.Null()]), observedWorkspaceIdentity: Type.Null(), observedUndoneItems: Type.Null(), verification: Type.Literal("unverified") };
const header = { schemaVersion: Type.Literal(1), action: Type.Literal("undo"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: object({ capture: enumeration(["complete", "incomplete", "unknown"]), projection: Type.Literal(true) }) };
const error = object({ code: enumeration(["invalid_request", "launch_failed", "aborted", "uncertain", "producer_failed"]), message: Type.String({ minLength: 1, maxLength: 256 }) });
export const undoOutputSchema = Type.Unsafe<UndoReceipt>(Type.Union([
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("command-completed"), data: object({ ...data, effect: Type.Literal("not-proven") }) }),
    object({ ...header, ok: Type.Literal(false), outcome: Type.Literal("failed"), data: object({ ...data, effect: Type.Literal("not-attempted") }), error }),
    object({ ...header, ok: Type.Literal(false), outcome: Type.Literal("uncertain"), data: object({ ...data, effect: Type.Literal("uncertain") }), error }),
]));
export function validateUndoOutput(value: unknown): value is UndoReceipt {
    if (!Check(undoOutputSchema, value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 131072) return false;
    const dto = value as UndoReceipt, d = dto.data, a = d.attempt, c = d.capture;
    if (d.intendedArgv[0] !== UNDO_COMMAND) return false;
    if (d.requestedOperandCount === null) {
        if (d.intendedArgv.length !== 1 || d.workingDirectory !== null || c || !["not-attempted", "unknown"].includes(a.state)) return false;
    } else if (!validUndoOperands(d.intendedArgv.slice(1)) || d.requestedOperandCount !== d.intendedArgv.length - 1 || !d.workingDirectory) return false;
    if (d.workingDirectory !== null && !safeUndoText(d.workingDirectory)) return false;
    if (!dto.ok && !safeUndoText(dto.error.message)) return false;
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
export async function executeUndoOutput(args: unknown) {
    let dto = await assembleUndoReceipt(args);
    const valid: boolean = validateUndoOutput(dto);
    if (!valid) {
        const possibleStart = !["not-attempted", "not-started"].includes(dto.data.attempt.state);
        const data = emptyUndoData();
        if (possibleStart) { data.attempt.state = "unknown"; data.effect = "uncertain"; }
        dto = undoFailure(data, "producer_failed", "Undo receipt validation failed; do not retry automatically.");
        if (!validateUndoOutput(dto)) throw new Error("Safe undo receipt could not be constructed.");
    }
    return { content: [{ type: "text" as const, text: presentUndoReceipt(dto) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
