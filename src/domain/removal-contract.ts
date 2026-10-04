import type { RemovalAttempt, RemovalCapture } from "../execution/removal-command";
export type { RemovalAttempt, RemovalCapture } from "../execution/removal-command";
export const REMOVAL_COMMAND = "remove" as const;
export const safeRemovalText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export function validRemovalOperands(paths: unknown): paths is string[] {
    if (!Array.isArray(paths) || !paths.length || paths.length > 256) return false;
    let bytes = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        if (!safeRemovalText(path) || path.trimStart().startsWith("-") || /^(private|controlled)$/i.test(path.trim())) return false;
        bytes += Buffer.byteLength(path, "utf8");
        if (bytes > 32768) return false;
    }
    return true;
}
export type RemovalData = {
    intendedArgv: readonly string[]; requestedOperandCount: number | null; workingDirectory: string | null;
    keepOnDiskRequested: boolean | null; previewRequested: boolean | null; outputFormatRequested: "text" | "json" | null;
    resolutionIntent: "accept-source-deletion"; attempt: RemovalAttempt; capture: RemovalCapture | null;
    observedWorkspaceIdentity: null; observedResolvedItems: null; observedResolution: null; observedPreservation: null; observedPendingState: null;
    verification: "unverified"; effect: "not-attempted" | "not-proven" | "uncertain";
};
type Header = { schemaVersion: 1; action: "resolve-delete-change-conflict"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true }; data: RemovalData };
export type RemovalError = { code: "invalid_request" | "launch_failed" | "aborted" | "uncertain" | "producer_failed"; message: string };
export type RemovalReceipt = Header & ({ ok: true; outcome: "command-completed" | "preflight" } | { ok: false; outcome: "failed" | "uncertain"; error: RemovalError });
