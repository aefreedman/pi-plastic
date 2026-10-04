import type { UndoAttempt, UndoCapture } from "../execution/undo-command";
export type { UndoAttempt, UndoCapture } from "../execution/undo-command";
export const UNDO_COMMAND = "undo" as const;
export const safeUndoText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export function validUndoOperands(paths: unknown): paths is string[] {
    if (!Array.isArray(paths) || !paths.length || paths.length > 256) return false;
    let bytes = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        if (!safeUndoText(path) || path.trimStart().startsWith("-")) return false;
        bytes += Buffer.byteLength(path, "utf8");
        if (bytes > 32768) return false;
    }
    return true;
}
export type UndoData = {
    intendedArgv: readonly string[]; requestedOperandCount: number | null; workingDirectory: string | null;
    attempt: UndoAttempt; capture: UndoCapture | null;
    observedWorkspaceIdentity: null; observedUndoneItems: null;
    verification: "unverified"; effect: "not-attempted" | "not-proven" | "uncertain";
};
type Header = { schemaVersion: 1; action: "undo"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true }; data: UndoData };
export type UndoError = { code: "invalid_request" | "launch_failed" | "aborted" | "uncertain" | "producer_failed"; message: string };
export type UndoReceipt = Header & ({ ok: true; outcome: "command-completed" } | { ok: false; outcome: "failed" | "uncertain"; error: UndoError });
