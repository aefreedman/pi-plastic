/** Current native selectors only. Names are exact comma-list members, not option syntax. */
export function validReviewId(v: unknown): v is string {
    return typeof v === "string" && /^(?:[1-9][0-9]*|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(v) && v.length <= 128;
}
export function validReviewMembers(v: unknown): v is string[] {
    return Array.isArray(v) && v.length > 0 && v.length <= 100 && new Set(v).size === v.length &&
        Array.from(v).every(x => typeof x === "string" && x.length <= 256 && x === x.trim() && x.length > 0 && !/^[\-]/.test(x) && !/[,\u0000-\u001f\u007f-\u009f]/.test(x) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x)) && Buffer.byteLength(v.join(","), "utf8") <= 4096;
}
export const REVIEW_WORKFLOW_ACTIONS = ["reviewer-add", "reviewer-remove", "reviewer-list", "set-status", "request-review"] as const;
export type ReviewWorkflowAction = typeof REVIEW_WORKFLOW_ACTIONS[number];
export const OWN_REVIEW_STATUSES = ["reviewed", "rework-required", "under-review"] as const;
