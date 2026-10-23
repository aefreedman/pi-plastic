import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { tool } from "../tool-definition";
import { captureWorkspaceMergeCommand, type WorkspaceMergeCommandObservation } from "../execution/workspace-merge-command";
import { getActiveAbortSignal } from "../execution/context";
import { REVIEW_COMMENT_ACTIONS, normalizeReviewCommentRequest, reviewCommentArgv, emittedCommentGuid, commentText, type ReviewCommentAction, type ReviewCommentRequest } from "../domain/review-comments";
import { parseReviewCommentsXml } from "../domain/review-comments-xml";
export { REVIEW_COMMENT_ACTIONS, normalizeReviewCommentRequest, reviewCommentArgv, emittedCommentGuid };
export type { ReviewCommentAction, ReviewCommentRequest };
type CommentFileFailure = "invalid_file" | "aborted" | "file_validation_timeout";
/** Bounds the caller's wait, not kernel I/O cancellation. Late opens are closed
 * in the task's finally; stopped validation can never dispatch an SCM command. */
export async function validateReviewCommentFile(filePath: string, signal?: AbortSignal, filesystem: { stat: typeof stat; open: typeof open } = { stat, open }, timeoutMilliseconds = 5000): Promise<CommentFileFailure | null> {
    if (signal?.aborted) return "aborted";
    let stopped = false;
    let stop!: (reason: CommentFileFailure) => void;
    const deadline = new Promise<CommentFileFailure>(resolve => { stop = reason => { stopped = true; resolve(reason); }; });
    const onAbort = () => stop("aborted");
    const timer = setTimeout(() => stop("file_validation_timeout"), Number.isFinite(timeoutMilliseconds) ? Math.max(1, Math.min(5000, timeoutMilliseconds)) : 5000);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const check = () => { if (stopped || signal?.aborted) throw Error("Stopped comment-file validation"); };
    const validation = (async () => {
        check();
        // Reject devices/directories/FIFOs before open. Nonblocking POSIX open
        // also closes the race where a regular path is replaced by a FIFO.
        if (!(await filesystem.stat(filePath)).isFile()) throw Error("Not a regular file");
        check();
        const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NONBLOCK);
        const file = await filesystem.open(filePath, flags);
        try {
            check();
            const info = await file.stat();
            if (!info.isFile() || info.size > 16384) throw Error("Invalid comment file");
            check();
            const bytes = Buffer.alloc(16385);
            let length = 0;
            while (length < bytes.length) {
                check();
                const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
                check();
                if (!bytesRead) break;
                length += bytesRead;
            }
            if (length > 16384 || !commentText(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)), true)) throw Error("Invalid comment text");
        } finally { await file.close(); }
        check();
    })().then(() => null, (): CommentFileFailure => signal?.aborted ? "aborted" : "invalid_file");
    try { return await Promise.race([deadline, validation]); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}
export function reviewCommentReceipt(action: ReviewCommentAction, requested: ReviewCommentRequest | null, observation: WorkspaceMergeCommandObservation | null, localFailure: "invalid_request" | CommentFileFailure | "producer_failed" | null = null) {
    let code: string | null = localFailure, rows: ReturnType<typeof parseReviewCommentsXml> | null = null, observedGuid: string | null = null, observedCount: number | null = null;
    const o = observation;
    if (!code && !requested) code = "invalid_request";
    if (!code && !requested!.preflight) {
        if (!o) code = "producer_failed";
        else if (o.attempt.aborted) code = "aborted";
        else if (!o.capture.complete || o.failed || o.attempt.state !== "started") code = "capture_incomplete";
        else if (o.attempt.exitCode !== 0 || o.stderr !== "") code = "command_failed";
        else if (action === "find") {
            try { const all = parseReviewCommentsXml(o.stdout!, requested!.review!); observedCount = all.length; rows = all.slice(0, requested!.maxItems ?? 100); }
            catch { code = "unsupported_profile"; }
        } else if (action === "add" || action === "reply") observedGuid = emittedCommentGuid(o.stdout!);
    }
    // Unexpected producer failure cannot establish that dispatch never happened.
    const attempted = localFailure === "producer_failed" || !!o && ["started", "unknown"].includes(o.attempt.state);
    return { schemaVersion: 1 as const, action, provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: code === null,
        outcome: code ? attempted ? "uncertain" : "failed" : requested!.preflight ? "preflight" : "command-completed",
        completeness: { capture: o ? o.capture.complete ? "complete" : "incomplete" : "unknown", projection: rows !== null ? rows.length === observedCount : action !== "find" },
        data: { requested, intendedArgv: requested ? reviewCommentArgv(action, requested) : [], observation: o, localFailure, rows, observedCount, observedGuid, storedState: null, repositoryIdentity: null, scope: "requested-only", atomicity: "not-proven", rollback: "not-proven", effect: !attempted ? "not-attempted" : code ? "uncertain" : "not-proven", disclaimer: "Completion is not stored-state or repository/account verification. No automatic retry. Delete may partially succeed. Reply discard explicitly changes pending-change state; text edit does not change type/location. XML has no server path; numeric parent is not a GUID. File contents may change after local validation." },
        error: code ? { code, message: `Review comment ${action} failed (${code}); effects may remain. No automatic retry.` } : null };
}
export type ReviewCommentReceipt = ReturnType<typeof reviewCommentReceipt>;
export async function assembleReviewCommentReceipt(action: ReviewCommentAction, args: unknown): Promise<ReviewCommentReceipt> {
    let r: ReviewCommentRequest;
    try { r = normalizeReviewCommentRequest(action, args); } catch { return reviewCommentReceipt(action, null, null, "invalid_request"); }
    if (r.preflight) return reviewCommentReceipt(action, r, null);
    if (r.commentsFile !== undefined) {
        const failure = await validateReviewCommentFile(resolve(r.workdir, r.commentsFile), getActiveAbortSignal());
        if (failure) return reviewCommentReceipt(action, r, null, failure);
    }
    try {
        const o = await captureWorkspaceMergeCommand(reviewCommentArgv(action, r), r.workdir);
        if (getActiveAbortSignal()?.aborted) { o.attempt.aborted = true; o.capture.complete = false; }
        return reviewCommentReceipt(action, r, o);
    } catch { return reviewCommentReceipt(action, r, null, "producer_failed"); }
}
export const presentReviewCommentReceipt = (dto: ReviewCommentReceipt) => JSON.stringify(dto);
const common = () => ({ preflight: tool.schema.boolean().optional(), output: tool.schema.enum(["text", "json"]).optional(), workdir: tool.schema.string().optional() });
const content = () => ({ comment: tool.schema.string().min(1).max(4096).optional(), commentsFile: tool.schema.string().min(1).optional(), repository: tool.schema.string().optional() });
function execute(action: ReviewCommentAction) { return async (args: unknown) => { const dto = await assembleReviewCommentReceipt(action, args); if (!dto.ok) throw Error(presentReviewCommentReceipt(dto)); return presentReviewCommentReceipt(dto); }; }
export const codeReviewCommentFind = tool({ description: "Read bounded comments for one exact numeric review ID using CM 11.0.16.10512 XML; no server-path evidence available.", args: { review: tool.schema.string(), maxItems: tool.schema.number().int().min(1).max(500).optional(), ...common() }, execute: execute("find") });
export const codeReviewCommentAdd = tool({ description: "Add explicit review-wide or inline text/file comment; completion is unverified stored state.", args: { review: tool.schema.string(), path: tool.schema.string().optional(), line: tool.schema.number().int().min(1).optional(), changeset: tool.schema.string().optional(), type: tool.schema.enum(["Change", "Question", "Comment"]).optional(), ...content(), ...common() }, execute: execute("add") });
export const codeReviewCommentReply = tool({ description: "Reply to exact comment GUID. Explicit discard=true additionally discards pending requested change.", args: { commentGuid: tool.schema.string(), discard: tool.schema.boolean().optional(), ...content(), ...common() }, execute: execute("reply") });
export const codeReviewCommentEdit = tool({ description: "Replace text of exact comment GUID, never type/location. Empty clears unsupported.", args: { commentGuid: tool.schema.string(), ...content(), ...common() }, execute: execute("edit") });
export const codeReviewCommentDelete = tool({ description: "Delete once an explicit bounded comment GUID list. Partial success possible; no rollback/retry.", args: { commentGuids: tool.schema.array(tool.schema.string()).min(1).max(32), repository: tool.schema.string().optional(), ...common() }, execute: execute("delete") });
