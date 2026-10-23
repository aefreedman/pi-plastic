export const REVIEW_COMMENT_ACTIONS = ["find", "add", "reply", "edit", "delete"] as const;
export type ReviewCommentAction = typeof REVIEW_COMMENT_ACTIONS[number];
export const commentGuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export const reviewId = (v: unknown): v is string => commentGuid(v) || typeof v === "string" && /^[1-9][0-9]{0,19}$/.test(v);
export function commentText(v: unknown, multiline = false): v is string {
    return typeof v === "string" && v.length <= 4096 && v.trim().length > 0 && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(v) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
}
export type ReviewCommentRequest = { workdir: string; preflight: boolean; output: "text" | "json"; review?: string; commentGuid?: string; commentGuids?: string[]; comment?: string; commentsFile?: string; repository?: string; path?: string; line?: number; changeset?: string; type?: "Change" | "Question" | "Comment"; discard?: boolean; maxItems?: number };
const keys = { find: ["review", "maxItems"], add: ["review", "comment", "commentsFile", "repository", "path", "line", "changeset", "type"], reply: ["commentGuid", "comment", "commentsFile", "repository", "discard"], edit: ["commentGuid", "comment", "commentsFile", "repository"], delete: ["commentGuids", "repository"] };
export function normalizeReviewCommentRequest(action: ReviewCommentAction, input: unknown): ReviewCommentRequest {
    if (!REVIEW_COMMENT_ACTIONS.includes(action) || !input || typeof input !== "object" || Array.isArray(input)) throw Error("invalid_request");
    const i = input as Record<string, unknown>;
    if (Object.keys(i).some(k => ![...keys[action], "workdir", "preflight", "output"].includes(k) || i[k] === null)) throw Error("invalid_request");
    const r = { workdir: process.cwd(), preflight: false, output: "text", ...i } as ReviewCommentRequest;
    if (!commentText(r.workdir) || typeof r.preflight !== "boolean" || !["text", "json"].includes(r.output)) throw Error("invalid_request");
    if ((action === "find" || action === "add") && !reviewId(r.review)) throw Error("invalid_request");
    // Only numeric REVIEWID association is established by the native XML profile.
    if (action === "find" && (typeof r.review !== "string" || !/^[1-9][0-9]{0,19}$/.test(r.review))) throw Error("invalid_request");
    if (["reply", "edit"].includes(action) && !commentGuid(r.commentGuid)) throw Error("invalid_request");
    if (action === "delete" && (!Array.isArray(r.commentGuids) || r.commentGuids.length < 1 || r.commentGuids.length > 32 || !Array.from(r.commentGuids).every(commentGuid) || new Set(r.commentGuids.map(x => x.toLowerCase())).size !== r.commentGuids.length)) throw Error("invalid_request");
    if (r.repository !== undefined && (!commentText(r.repository) || r.repository.startsWith("-"))) throw Error("invalid_request");
    if (["add", "reply", "edit"].includes(action) && ((r.comment !== undefined) === (r.commentsFile !== undefined) || r.comment !== undefined && !commentText(r.comment, true) || r.commentsFile !== undefined && (!commentText(r.commentsFile) || r.commentsFile.trim() === "-"))) throw Error("invalid_request");
    if (action === "add") {
        if ((r.path !== undefined) !== (r.line !== undefined) || r.path !== undefined && (!commentText(r.path) || !r.path.startsWith("/") || r.path.includes("\\") || r.path.slice(1).split("/").some(p => !p || p === "." || p === "..")) || r.line !== undefined && (!Number.isSafeInteger(r.line) || r.line < 1) || (r.type !== undefined || r.changeset !== undefined) && r.path === undefined || r.type !== undefined && !["Change", "Question", "Comment"].includes(r.type) || r.changeset !== undefined && (typeof r.changeset !== "string" || !/^cs:(?:[1-9][0-9]{0,19}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(r.changeset))) throw Error("invalid_request");
    }
    if (r.discard !== undefined && typeof r.discard !== "boolean" || r.maxItems !== undefined && (!Number.isSafeInteger(r.maxItems) || r.maxItems < 1 || r.maxItems > 500)) throw Error("invalid_request");
    return structuredClone(r);
}
export function reviewCommentArgv(action: ReviewCommentAction, r: ReviewCommentRequest): string[] {
    if (action === "find") return ["find", "changereviewcomment", `where reviewid=${commentGuid(r.review) ? `'${r.review}'` : r.review}`, "--xml", "--encoding=utf-8"];
    const argv = ["codereview", "comment", action, ...(action === "add" ? [r.review!] : action === "delete" ? r.commentGuids! : [r.commentGuid!])];
    if (r.comment !== undefined) argv.push(`-c=${r.comment}`);
    if (r.commentsFile !== undefined) argv.push(`-commentsfile=${r.commentsFile}`);
    for (const k of ["path", "line", "changeset", "type", "repository"] as const) if (r[k] !== undefined) argv.push(`--${k}=${r[k]}`);
    if (r.discard === true) argv.push("--discard");
    return argv;
}
export function emittedCommentGuid(stdout: string): string | null {
    const m = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\r?\n)?$/i.exec(stdout);
    return m?.[1] ?? null;
}
