import type { UpdateAttempt, UpdateCapture } from "../execution/update-command";
export type { UpdateAttempt, UpdateCapture } from "../execution/update-command";
export const UPDATE_ARGV = Object.freeze(["update", "--dontmerge", "--noinput"] as const);
export const safeUpdateText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export type UpdateData = {
    intendedArgv: typeof UPDATE_ARGV; workingDirectory: string | null;
    attempt: UpdateAttempt; capture: UpdateCapture | null;
    observedWorkspaceIdentity: null; observedChanges: null;
    verification: "unverified"; effect: "not-attempted" | "not-proven" | "uncertain";
};
type Header = { schemaVersion: 1; action: "update"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true }; data: UpdateData };
export type UpdateError = { code: "invalid_request" | "launch_failed" | "aborted" | "uncertain" | "producer_failed"; message: string };
export type UpdateReceipt = Header & (
    { ok: true; outcome: "command-completed" } |
    { ok: false; outcome: "failed" | "uncertain"; error: UpdateError }
);
