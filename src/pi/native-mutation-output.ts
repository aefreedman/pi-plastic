import { Type, type TProperties } from "typebox";
import { nativeCommandCompleted, type NativeCommandData, type NativeHeader, type NativeOutcome } from "../domain/native-mutation";
export const nativeObject = <P extends TProperties>(properties: P) => Type.Object(properties, { additionalProperties: false });
export const nativeText = () => Type.String();
export const nativeNullable = <T extends ReturnType<typeof Type.Object> | ReturnType<typeof Type.Array> | ReturnType<typeof Type.String>>(s: T) => Type.Union([s, Type.Null()]);
export const nativeAttemptSchema = nativeObject({ state: Type.Union(["not-attempted", "not-started", "started", "unknown"].map(s => Type.Literal(s))), terminal: Type.Union([Type.Literal("not-observed"), Type.Literal("observed")]), exitCode: Type.Union([Type.Integer({ minimum: 0, maximum: 2147483647 }), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() });
export const nativeCaptureSchema = nativeObject({ stdoutBytes: Type.Integer({ minimum: 0 }), stderrBytes: Type.Integer({ minimum: 0 }), stdoutRetainedBytes: Type.Integer({ minimum: 0, maximum: 65536 }), stderrRetainedBytes: Type.Integer({ minimum: 0, maximum: 16384 }), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
export const nativeDataProperties = { command: Type.Union([Type.Array(Type.String()), Type.Null()]), workingDirectory: Type.Union([Type.String(), Type.Null()]), attempt: nativeAttemptSchema, capture: Type.Union([nativeCaptureSchema, Type.Null()]), commandCompleted: Type.Boolean(), commandOutput: Type.Union([nativeObject({ stdout: Type.Union([Type.String(), Type.Null()]), stderr: Type.Union([Type.String(), Type.Null()]) }), Type.Null()]), effect: Type.Union(["not-attempted", "command-completed", "uncertain"].map(s => Type.Literal(s))) };
export function nativeReceiptSchema(action: string, data: ReturnType<typeof Type.Object>) {
    return nativeObject({ schemaVersion: Type.Literal(2), action: Type.Literal(action), provenance: nativeObject({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: nativeObject({ capture: Type.Union(["complete", "incomplete", "unknown"].map(s => Type.Literal(s))), projection: Type.Boolean() }), ok: Type.Boolean(), outcome: Type.Union(["preflight", "command-completed", "failed", "uncertain"].map(s => Type.Literal(s))), error: Type.Optional(nativeObject({ code: Type.String(), message: Type.String() })), data });
}
export function validateNativeReceipt(dto: NativeHeader & NativeOutcome & { data: NativeCommandData }): boolean {
    const d = dto.data, a = d.attempt, c = d.capture;
    if (Buffer.byteLength(JSON.stringify(dto), "utf8") > 262144 || d.command && Buffer.byteLength(JSON.stringify(d.command), "utf8") > 32768) return false;
    if (a.exitCode !== null && a.terminal !== "observed" || ["not-attempted", "not-started"].includes(a.state) && (a.terminal !== "not-observed" || a.exitCode !== null)) return false;
    if (c && (c.stdoutRetainedBytes > c.stdoutBytes || c.stderrRetainedBytes > c.stderrBytes || c.truncated !== (c.stdoutBytes > c.stdoutRetainedBytes || c.stderrBytes > c.stderrRetainedBytes) || c.complete && (!c.validUtf8 || a.state !== "started" || a.terminal !== "observed" || a.exitCode === null || a.aborted || a.timedOut))) return false;
    if (d.commandCompleted !== nativeCommandCompleted(d) || dto.completeness.capture !== (c ? c.complete ? "complete" : "incomplete" : "unknown") || dto.completeness.projection !== !c?.truncated) return false;
    if ((d.commandOutput === null) !== (c === null)) return false;
    if (d.commandOutput && c && (Buffer.byteLength(d.commandOutput.stdout ?? "", "utf8") > c.stdoutRetainedBytes || Buffer.byteLength(d.commandOutput.stderr ?? "", "utf8") > c.stderrRetainedBytes)) return false;
    const effect = d.commandCompleted ? "command-completed" : ["started", "unknown"].includes(a.state) ? "uncertain" : "not-attempted";
    if (d.effect !== effect) return false;
    if (dto.ok) return !("error" in dto) && (dto.outcome === "preflight" ? a.state === "not-attempted" && c === null && d.command !== null : dto.outcome === "command-completed" && d.commandCompleted);
    return !!dto.error.code && !!dto.error.message && !d.commandCompleted && dto.outcome === (effect === "uncertain" ? "uncertain" : "failed");
}
