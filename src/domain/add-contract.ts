import type { AddAttempt, AddCapture } from "../execution/add-command";
export type { AddAttempt, AddCapture } from "../execution/add-command";
export const ADD_COMMAND = "add" as const;
export const safeAddText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export function validAddOperands(paths: unknown): paths is string[] {
    if (!Array.isArray(paths) || !paths.length || paths.length > 256) return false;
    let bytes = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        if (!safeAddText(path) || path.trimStart().startsWith("-")) return false;
        bytes += Buffer.byteLength(path, "utf8");
        if (bytes > 32768) return false;
    }
    return true;
}
export type AddData = {
    intendedArgv: readonly string[]; requestedOperandCount: number | null; workingDirectory: string | null;
    attempt: AddAttempt; capture: AddCapture | null;
    observedWorkspaceIdentity: null; observedAddedItems: null;
    verification: "unverified"; effect: "not-attempted" | "not-proven" | "uncertain";
};
type Header = { schemaVersion: 1; action: "add"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true }; data: AddData };
export type AddError = { code: "invalid_request" | "launch_failed" | "aborted" | "uncertain" | "producer_failed"; message: string };
export type AddReceipt = Header & ({ ok: true; outcome: "command-completed" } | { ok: false; outcome: "failed" | "uncertain"; error: AddError });
