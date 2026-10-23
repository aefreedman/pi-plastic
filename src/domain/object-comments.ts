export const OBJECT_COMMENT_ACTIONS = ["branch-edit-comment", "label-edit-comment"] as const;
export type ObjectCommentAction = typeof OBJECT_COMMENT_ACTIONS[number];
export type ObjectCommentRequest = {
    workdir: string; preflight: boolean; output: "text" | "json";
    branch?: string; label?: string; comment: string | null; commentsFile: string | null;
};
export function validObjectCommentText(v: unknown, multiline = false, empty = false): v is string {
    return typeof v === "string" && v.length <= 4096 && (empty || v.trim().length > 0)
        && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(v)
        && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
}
export function objectCommentSelectorKey(a: ObjectCommentAction): "branch" | "label" { return a === "branch-edit-comment" ? "branch" : "label"; }
export function objectCommentPrefix(a: ObjectCommentAction): string[] { return [a === "branch-edit-comment" ? "branch" : "label", "editcomment"]; }
/** Conservative explicit selector grammar. Qualifications are requested scope, never verified identity. */
export function validObjectCommentRequest(a: ObjectCommentAction, r: ObjectCommentRequest): boolean {
    const key = objectCommentSelectorKey(a), selector = r[key];
    if (Object.keys(r).some(k => ![key, "comment", "commentsFile", "workdir", "preflight", "output"].includes(k))) return false;
    if (!validObjectCommentText(r.workdir) || typeof r.preflight !== "boolean" || !["text", "json"].includes(r.output)
        || Buffer.byteLength(JSON.stringify(r), "utf8") > 32768 || !validObjectCommentText(selector)) return false;
    // Preserve embedded name spaces as one argv operand, but reject option-like components,
    // wildcards, ambiguous delimiters, empty hierarchy segments and implicit current objects.
    const parts = selector.split("@"), base = parts.shift()!;
    const safePart = (s: string) => s.length > 0 && s === s.trim() && !s.startsWith("-")
        && !/[*?\"'`|<>;]|\s-/.test(s);
    if (parts.length > 3 || parts.some(p => !safePart(p)) || parts.length === 3 && !/^(cloud|unity)$/i.test(parts[2])) return false;
    if (a === "branch-edit-comment") {
        if (!base.startsWith("br:/") || !base.slice(4).split("/").every(p => safePart(p) && p !== "." && p !== "..")) return false;
    } else if (!base.startsWith("lb:") || !safePart(base.slice(3)) || [".", ".."].includes(base.slice(3))) return false;
    if ((r.comment !== null) === (r.commentsFile !== null)) return false;
    if (r.comment !== null && (!validObjectCommentText(r.comment, true, true) || r.comment.trimStart().startsWith("-"))) return false;
    // No stdin and no option-looking file; filenames are passed as one -commentsfile= operand.
    if (r.commentsFile !== null && (!validObjectCommentText(r.commentsFile) || r.commentsFile.trimStart().startsWith("-"))) return false;
    return true;
}
export function objectCommentArgv(a: ObjectCommentAction, r: ObjectCommentRequest): string[] {
    return [...objectCommentPrefix(a), r[objectCommentSelectorKey(a)]!, r.comment !== null ? r.comment : `-commentsfile=${r.commentsFile}`];
}
export function normalizeObjectCommentRequest(a: ObjectCommentAction, args: unknown): ObjectCommentRequest | null {
    if (!args || typeof args !== "object" || Array.isArray(args)) return null;
    const i = { ...args } as Record<string, unknown>, key = objectCommentSelectorKey(a);
    if (Object.keys(i).some(k => ![key, "comment", "commentsFile", "workdir", "preflight", "output"].includes(k))
        || Object.values(i).some(v => v === null)) return null;
    const r = { [key]: i[key], comment: i.comment === undefined ? null : i.comment, commentsFile: i.commentsFile === undefined ? null : i.commentsFile,
        workdir: i.workdir === undefined ? process.cwd() : i.workdir, preflight: i.preflight === undefined ? false : i.preflight,
        output: i.output === undefined ? "text" : i.output } as ObjectCommentRequest;
    return validObjectCommentRequest(a, r) ? r : null;
}
