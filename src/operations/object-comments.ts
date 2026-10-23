import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { outputFormatArg } from "../presentation/results";
import { captureWorkspaceMergeCommand, emptyWorkspaceMergeAttempt } from "../execution/workspace-merge-command";
import { OBJECT_COMMENT_ACTIONS, normalizeObjectCommentRequest, objectCommentArgv, objectCommentPrefix, validObjectCommentRequest, validObjectCommentText, type ObjectCommentAction, type ObjectCommentRequest } from "../domain/object-comments";
export { OBJECT_COMMENT_ACTIONS, objectCommentArgv, objectCommentPrefix, validObjectCommentRequest, validObjectCommentText };
export type { ObjectCommentAction, ObjectCommentRequest };
export type ObjectCommentData = {
    requested: ObjectCommentRequest | null; intendedArgv: string[];
    attempt: ReturnType<typeof emptyWorkspaceMergeAttempt>;
    capture: Awaited<ReturnType<typeof captureWorkspaceMergeCommand>>["capture"] | null;
    commandOutput: { kind: "opaque-command-output"; text: string } | null;
    observedUpdatedState: null; observedRepositoryIdentity: null;
    scope: "requested-only"; rollback: "not-proven";
    effect: "not-attempted" | "not-proven" | "uncertain";
};
export type ObjectCommentReceipt<A extends ObjectCommentAction = ObjectCommentAction> = {
    schemaVersion: 1; action: A;
    provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" };
    completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true };
    data: ObjectCommentData;
} & ({ ok: true; outcome: "preflight" | "command-completed" } | { ok: false; outcome: "failed" | "uncertain"; error: { code: "invalid_request" | "launch_failed" | "aborted" | "uncertain" | "producer_failed"; message: string } });
export function emptyObjectCommentData(a: ObjectCommentAction): ObjectCommentData {
    return { requested: null, intendedArgv: objectCommentPrefix(a), attempt: emptyWorkspaceMergeAttempt(), capture: null, commandOutput: null,
        observedUpdatedState: null, observedRepositoryIdentity: null, scope: "requested-only", rollback: "not-proven", effect: "not-attempted" };
}
function header(a: ObjectCommentAction, d: ObjectCommentData) {
    return { schemaVersion: 1 as const, action: a, provenance: { source: "plastic" as const, producer: "@aefree/pi-plastic" as const, contentTrust: "external" as const },
        completeness: { capture: d.capture ? d.capture.complete ? "complete" as const : "incomplete" as const : "unknown" as const, projection: true as const }, data: d };
}
export function objectCommentFailure(a: ObjectCommentAction, d: ObjectCommentData, code: Extract<ObjectCommentReceipt, { ok: false }>["error"]["code"], message: string): ObjectCommentReceipt {
    return { ...header(a, d), ok: false, outcome: ["started", "unknown"].includes(d.attempt.state) ? "uncertain" : "failed", error: { code, message } };
}
export async function assembleObjectCommentReceipt(a: ObjectCommentAction, args: unknown): Promise<ObjectCommentReceipt> {
    const d = emptyObjectCommentData(a); let entered = false;
    try {
        if (!OBJECT_COMMENT_ACTIONS.includes(a)) return objectCommentFailure(a, d, "invalid_request", "Unsupported object-comment action; no command was dispatched.");
        const r = normalizeObjectCommentRequest(a, args);
        if (!r) return objectCommentFailure(a, d, "invalid_request", "Use exact explicit branch/label selectors and exclusive bounded comment/commentsFile; empty text clears, stdin/options are unsupported.");
        d.requested = r; d.intendedArgv = objectCommentArgv(a, r);
        if (r.preflight) return { ...header(a, d), ok: true, outcome: "preflight" };
        entered = true;
        const o = await captureWorkspaceMergeCommand([...d.intendedArgv], r.workdir);
        d.attempt = o.attempt; d.capture = o.capture;
        const completed = o.capture.complete && !o.failed && o.attempt.state === "started" && o.attempt.exitCode === 0;
        if (completed) {
            d.commandOutput = { kind: "opaque-command-output", text: o.stdout! };
            d.effect = o.capture.stderrBytes === 0 ? "not-proven" : "uncertain";
            if (o.capture.stderrBytes === 0) return { ...header(a, d), ok: true, outcome: "command-completed" };
        } else d.effect = ["started", "unknown"].includes(d.attempt.state) ? "uncertain" : "not-attempted";
        return objectCommentFailure(a, d, o.attempt.aborted ? "aborted" : ["started", "unknown"].includes(o.attempt.state) ? "uncertain" : "launch_failed", "Comment command completion is not admitted. Effects may exist; no retry, stored-state verification or rollback.");
    } catch {
        if (entered && d.capture === null) { d.attempt.state = "unknown"; d.effect = "uncertain"; }
        return objectCommentFailure(a, d, "producer_failed", "Comment observation failed. Possible effects remain; no automatic recovery or retry.");
    }
}
export function presentObjectCommentReceipt(dto: ObjectCommentReceipt): string {
    if (dto.data.requested?.output === "json") return JSON.stringify(dto);
    if (!dto.ok) return `${dto.action} ${dto.outcome}: ${dto.error.message} Effect: ${dto.data.effect}.`;
    if (dto.outcome === "preflight") return `${dto.action} command-only preview (not executed): ${JSON.stringify(dto.data.intendedArgv)}. No existence/permission/state analysis.`;
    return `${dto.action} command completed. Stored comment, repository identity, atomicity and rollback remain unverified.${dto.data.commandOutput?.text ? `\n${dto.data.commandOutput.text}` : ""}`;
}
const contentArgs = {
    comment: tool.schema.string().max(4096).optional().describe("Exact replacement text; explicit empty string clears. Exclusive with commentsFile. Option-leading text requires a file."),
    commentsFile: tool.schema.string().min(1).max(4096).optional().describe("Explicit local file; exclusive with comment. Stdin '-' is rejected; no editor fallback."),
    preflight: tool.schema.boolean().optional().describe("Zero-command preview; does not contact SCM or verify state."),
    output: outputFormatArg, workdir: workdirArg,
};
export const branchEditComment = tool({
    description: "Replace or clear one exact branch description (cm branch editcomment, CM 11.0.16.10512+); completion is not stored-state verification.",
    args: { branch: tool.schema.string().min(1).max(4096).describe("Explicit br:/hierarchy selector, optionally @repository@server qualified."), ...contentArgs },
    async execute(args) { const dto = await assembleObjectCommentReceipt("branch-edit-comment", args); const text = presentObjectCommentReceipt(dto); if (!dto.ok) throw Error(text); return text; },
});
export const labelEditComment = tool({
    description: "Replace or clear one exact label description using only cm label editcomment (CM 11.0.16.10512+), never create/reapply/move the label. Completion is not stored-state verification.",
    args: { label: tool.schema.string().min(1).max(4096).describe("Explicit lb:name selector, optionally @repository@server qualified."), ...contentArgs },
    async execute(args) { const dto = await assembleObjectCommentReceipt("label-edit-comment", args); const text = presentObjectCommentReceipt(dto); if (!dto.ok) throw Error(text); return text; },
});
