import { Type } from "typebox";
import { Check } from "typebox/value";
import { OBJECT_COMMENT_ACTIONS, assembleObjectCommentReceipt, emptyObjectCommentData, objectCommentFailure, objectCommentArgv, objectCommentPrefix, validObjectCommentRequest, validObjectCommentText, presentObjectCommentReceipt, type ObjectCommentAction, type ObjectCommentReceipt } from "../operations/object-comments";
const obj = (p: Record<string, any>) => Type.Object(p, { additionalProperties: false });
const enm = (v: readonly string[]) => Type.Union(v.map(x => Type.Literal(x)));
const nil = (s: any) => Type.Union([s, Type.Null()]);
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const text = Type.String({ minLength: 1, maxLength: 4096 });
const attempt = obj({ state: enm(["not-attempted", "not-started", "started", "unknown"]), terminal: enm(["not-observed", "observed"]), exitCode: nil(uint(2147483647)), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = obj({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
function schema<A extends ObjectCommentAction>(action: A) {
    const request = obj({ [action === "branch-edit-comment" ? "branch" : "label"]: text, comment: nil(Type.String({ maxLength: 4096 })), commentsFile: nil(text), workdir: text, preflight: Type.Boolean(), output: enm(["text", "json"]) });
    const data = obj({ requested: nil(request), intendedArgv: Type.Array(Type.String({ maxLength: 8192 }), { minItems: 2, maxItems: 4 }), attempt, capture: nil(capture),
        commandOutput: nil(obj({ kind: Type.Literal("opaque-command-output"), text: Type.String({ maxLength: 65536 }) })), observedUpdatedState: Type.Null(), observedRepositoryIdentity: Type.Null(), scope: Type.Literal("requested-only"), rollback: Type.Literal("not-proven"), effect: enm(["not-attempted", "not-proven", "uncertain"]) });
    const header = { schemaVersion: Type.Literal(1), action: Type.Literal(action), provenance: obj({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: obj({ capture: enm(["complete", "incomplete", "unknown"]), projection: Type.Literal(true) }), data };
    return Type.Unsafe<ObjectCommentReceipt<A>>(Type.Union([obj({ ...header, ok: Type.Literal(true), outcome: enm(["preflight", "command-completed"]) }), obj({ ...header, ok: Type.Literal(false), outcome: enm(["failed", "uncertain"]), error: obj({ code: enm(["invalid_request", "launch_failed", "aborted", "uncertain", "producer_failed"]), message: Type.String({ minLength: 1, maxLength: 256 }) }) })]));
}
export const branchEditCommentOutputSchema = schema("branch-edit-comment");
export const labelEditCommentOutputSchema = schema("label-edit-comment");
export const objectCommentSchemas = { "branch-edit-comment": branchEditCommentOutputSchema, "label-edit-comment": labelEditCommentOutputSchema };
export function validateObjectCommentOutput(v: unknown): v is ObjectCommentReceipt {
    try { return validate(v); } catch { return false; }
}
function validate(v: unknown): v is ObjectCommentReceipt {
    if (!v || typeof v !== "object") return false;
    const dto = v as ObjectCommentReceipt;
    if (!OBJECT_COMMENT_ACTIONS.includes(dto.action) || !Check(objectCommentSchemas[dto.action], v) || Buffer.byteLength(JSON.stringify(v), "utf8") > 524288) return false;
    const d = dto.data, r = d.requested, a = d.attempt, c = d.capture, o = d.commandOutput;
    if (dto.completeness.capture !== (c ? c.complete ? "complete" : "incomplete" : "unknown")) return false;
    if (r === null) {
        if (JSON.stringify(d.intendedArgv) !== JSON.stringify(objectCommentPrefix(dto.action)) || c || o || a.terminal !== "not-observed" || a.exitCode !== null || a.aborted || a.timedOut || !["not-attempted", "unknown"].includes(a.state) || dto.ok) return false;
    } else if (!validObjectCommentRequest(dto.action, r) || JSON.stringify(d.intendedArgv) !== JSON.stringify(objectCommentArgv(dto.action, r))) return false;
    if (a.exitCode !== null && a.terminal !== "observed" || ["not-attempted", "not-started"].includes(a.state) && (a.terminal !== "not-observed" || a.exitCode !== null) || a.state === "not-attempted" && a.timedOut) return false;
    if (c) {
        if (!r || c.stdoutRetainedBytes !== Math.min(c.stdoutBytes, 65536) || c.stderrRetainedBytes !== Math.min(c.stderrBytes, 16384)) return false;
        if (c.truncated !== (c.stdoutBytes > 65536 || c.stderrBytes > 16384)) return false;
        if (c.complete && (!c.validUtf8 || c.truncated || a.state !== "started" || a.terminal !== "observed" || a.exitCode === null || a.aborted || a.timedOut)) return false;
        if (a.state === "not-attempted" && (!a.aborted || c.stdoutBytes || c.stderrBytes || c.validUtf8 || c.complete)) return false;
        if (!c.validUtf8 && !c.stdoutBytes && !c.stderrBytes && !["not-attempted", "not-started"].includes(a.state)) return false;
    } else if (o || a.state === "started" || a.state === "not-started") return false;
    const completed = !!c?.complete && a.state === "started" && a.exitCode === 0;
    if (o !== null) {
        if (!completed || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(o.text) || Buffer.byteLength(o.text, "utf8") !== c!.stdoutBytes) return false;
    } else if (completed) return false;
    if (d.effect !== (dto.ok && dto.outcome === "command-completed" ? "not-proven" : ["started", "unknown"].includes(a.state) ? "uncertain" : "not-attempted")) return false;
    if (r?.preflight) return dto.ok && dto.outcome === "preflight" && a.state === "not-attempted" && a.terminal === "not-observed" && a.exitCode === null && !a.aborted && !a.timedOut && !c && !o;
    if (dto.ok) return dto.outcome === "command-completed" && r !== null && completed && c!.stderrBytes === 0;
    if (dto.outcome !== (["started", "unknown"].includes(a.state) ? "uncertain" : "failed") || !validObjectCommentText(dto.error.message)) return false;
    if (completed && c!.stderrBytes === 0) return false;
    switch (dto.error.code) {
        case "invalid_request": return r === null && a.state === "not-attempted" && !c;
        case "producer_failed": return !c && a.terminal === "not-observed" && !a.aborted && !a.timedOut && (r === null ? ["not-attempted", "unknown"].includes(a.state) : a.state === "unknown");
        case "aborted": return r !== null && c !== null && a.aborted;
        case "launch_failed": return r !== null && c !== null && !a.aborted && a.state === "not-started";
        case "uncertain": return r !== null && c !== null && !a.aborted && ["started", "unknown"].includes(a.state);
    }
}
export async function executeObjectCommentOutput(a: ObjectCommentAction, args: unknown) {
    let dto = await assembleObjectCommentReceipt(a, args);
    if (!validateObjectCommentOutput(dto) || dto.action !== a) {
        const d = emptyObjectCommentData(a); d.attempt.state = "unknown"; d.effect = "uncertain";
        dto = objectCommentFailure(a, d, "producer_failed", "Object-comment receipt invalid; earlier effects may exist. No automatic retry or verification.");
        if (!validateObjectCommentOutput(dto)) throw Error("Safe object-comment receipt unavailable; earlier effects may exist.");
    }
    return { content: [{ type: "text" as const, text: presentObjectCommentReceipt(dto) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
