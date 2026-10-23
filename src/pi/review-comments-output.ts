import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleReviewCommentReceipt, reviewCommentReceipt, normalizeReviewCommentRequest, REVIEW_COMMENT_ACTIONS, type ReviewCommentAction, type ReviewCommentReceipt } from "../operations/review-comments";
const obj = (p: Record<string, any>) => Type.Object(p, { additionalProperties: false });
const enm = (v: readonly string[]) => Type.Union(v.map(x => Type.Literal(x)));
const nil = (s: any) => Type.Union([s, Type.Null()]);
const text = Type.String({ maxLength: 65536 }), uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const optional = (s: any) => Type.Optional(s);
const common = { workdir: text, preflight: Type.Boolean(), output: enm(["text", "json"]) };
const content = { comment: optional(text), commentsFile: optional(text), repository: optional(text) };
const requests = {
    find: obj({ ...common, review: text, maxItems: optional(uint(500)) }),
    add: obj({ ...common, ...content, review: text, path: optional(text), line: optional(uint()), changeset: optional(text), type: optional(enm(["Change", "Question", "Comment"])) }),
    reply: obj({ ...common, ...content, commentGuid: text, discard: optional(Type.Boolean()) }),
    edit: obj({ ...common, ...content, commentGuid: text }),
    delete: obj({ ...common, commentGuids: Type.Array(text, { minItems: 1, maxItems: 32 }), repository: optional(text) }),
};
const attempt = obj({ state: enm(["not-attempted", "not-started", "started", "unknown"]), terminal: enm(["not-observed", "observed"]), exitCode: nil(uint(2147483647)), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = obj({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
const observation = obj({ attempt, capture, stdout: nil(text), stderr: nil(text), failed: Type.Boolean() });
const row = obj({ guid: text, id: text, reviewId: text, type: text, text, line: nil(uint()), location: text, revisionId: text, changeset: text, parentId: text, serverPath: Type.Null() });
function schema(action: ReviewCommentAction) {
    return obj({ schemaVersion: Type.Literal(1), action: Type.Literal(action), provenance: obj({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), ok: Type.Boolean(), outcome: enm(["failed", "uncertain", "preflight", "command-completed"]), completeness: obj({ capture: enm(["unknown", "complete", "incomplete"]), projection: Type.Boolean() }),
        data: obj({ requested: nil(requests[action]), intendedArgv: Type.Array(text, { maxItems: 40 }), observation: nil(observation), localFailure: nil(enm(["invalid_request", "invalid_file", "aborted", "file_validation_timeout", "producer_failed"])), rows: nil(Type.Array(row, { maxItems: 500 })), observedCount: nil(uint(500)), observedGuid: nil(text), storedState: Type.Null(), repositoryIdentity: Type.Null(), scope: Type.Literal("requested-only"), atomicity: Type.Literal("not-proven"), rollback: Type.Literal("not-proven"), effect: enm(["not-attempted", "uncertain", "not-proven"]), disclaimer: text }), error: nil(obj({ code: enm(["invalid_request", "invalid_file", "producer_failed", "aborted", "file_validation_timeout", "capture_incomplete", "command_failed", "unsupported_profile"]), message: text })) });
}
export const codeReviewCommentFindOutputSchema = schema("find"), codeReviewCommentAddOutputSchema = schema("add"), codeReviewCommentReplyOutputSchema = schema("reply"), codeReviewCommentEditOutputSchema = schema("edit"), codeReviewCommentDeleteOutputSchema = schema("delete");
export const reviewCommentOutputSchemas = { find: codeReviewCommentFindOutputSchema, add: codeReviewCommentAddOutputSchema, reply: codeReviewCommentReplyOutputSchema, edit: codeReviewCommentEditOutputSchema, delete: codeReviewCommentDeleteOutputSchema };
const canonical = (v: any): string => JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map(x => JSON.parse(canonical(x))) : Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(canonical(v[k]))])) : v);
export function validateReviewCommentOutput(value: unknown): value is ReviewCommentReceipt {
    try {
        const dto = value as ReviewCommentReceipt;
        if (!dto || !REVIEW_COMMENT_ACTIONS.includes(dto.action) || !Check(reviewCommentOutputSchemas[dto.action], value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 524288) return false;
        const { requested: r, observation: o, localFailure: f } = dto.data;
        if (r && canonical(normalizeReviewCommentRequest(dto.action, r)) !== canonical(r)) return false;
        if (!r && (f !== "invalid_request" && f !== "producer_failed" || o) || r?.preflight && (o || f) || f && o || f === "invalid_request" && r || ["invalid_file", "aborted", "file_validation_timeout"].includes(f ?? "") && !r?.commentsFile) return false;
        if (o) {
            const a = o.attempt, c = o.capture;
            if (!r || c.stdoutRetainedBytes > c.stdoutBytes || c.stderrRetainedBytes > c.stderrBytes || c.truncated !== (c.stdoutBytes > 65536 || c.stderrBytes > 16384) || a.exitCode !== null && a.terminal !== "observed" || ["not-attempted", "not-started"].includes(a.state) && (a.exitCode !== null || a.terminal !== "not-observed")) return false;
            if (c.validUtf8 !== (o.stdout !== null && o.stderr !== null)) return false;
            if (c.validUtf8 && (Buffer.byteLength(o.stdout!, "utf8") !== c.stdoutRetainedBytes || Buffer.byteLength(o.stderr!, "utf8") !== c.stderrRetainedBytes || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(o.stdout! + o.stderr!))) return false;
            if (c.complete && (o.failed || !c.validUtf8 || c.truncated || a.aborted || a.timedOut || a.state !== "started" || a.terminal !== "observed" || a.exitCode === null || c.stdoutBytes !== c.stdoutRetainedBytes || c.stderrBytes !== c.stderrRetainedBytes)) return false;
        }
        return canonical(reviewCommentReceipt(dto.action, r, o, f)) === canonical(dto);
    } catch { return false; }
}
export async function executeReviewCommentOutput(action: ReviewCommentAction, args: unknown) {
    let dto = await assembleReviewCommentReceipt(action, args);
    if (!validateReviewCommentOutput(dto)) dto = reviewCommentReceipt(action, null, null, "producer_failed");
    if (!validateReviewCommentOutput(dto)) throw Error("Safe review-comment receipt unavailable; prior effects may remain. No retry.");
    return { content: [{ type: "text" as const, text: JSON.stringify(dto) }], structuredContent: dto, isError: !dto.ok, details: {} };
}
