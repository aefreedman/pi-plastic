import { emptyWorkspaceMergeAttempt, type WorkspaceMergeAttempt, type WorkspaceMergeCapture, type WorkspaceMergeCommandObservation } from "../execution/workspace-merge-command";
export type MarkerAction = "merge-list-conflict-markers" | "merge-mark-resolved";
export type MarkerInspection = {
    state: "clear" | "pending" | "unknown";
    attempt: WorkspaceMergeAttempt;
    capture: WorkspaceMergeCapture | null;
    stdout: string | null;
    stderr: string | null;
};
export const safeMarkerText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && v.trim() === v && !/[\u0000-\u001f\u007f-\u009f\uFFFD]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
export function emptyMarkerInspection(): MarkerInspection {
    return { state: "unknown", attempt: emptyWorkspaceMergeAttempt(), capture: null, stdout: null, stderr: null };
}
export function markerCommandCompleted(i: MarkerInspection): boolean {
    return i.attempt.state === "started" && i.attempt.terminal === "observed" && i.attempt.exitCode === 0 && !i.attempt.aborted && !i.attempt.timedOut && i.capture?.complete === true && i.capture.validUtf8 && !i.capture.truncated && i.capture.stderrBytes === 0 && i.stderr === "";
}
/** Installed CM help promises exit 1 for remaining files, but does not specify an
 * unambiguous list-command record grammar. Nonempty output (including plausible
 * paths or CONFLICT_MARKERS records) stays unknown, not generic-error-as-pending.
 * No real workspace protocol is claimed by this conservative admission rule.
 */
export function classifyMarkerInspection(i: MarkerInspection): MarkerInspection["state"] {
    return markerCommandCompleted(i) && i.capture?.stdoutBytes === 0 && i.stdout === "" ? "clear" : "unknown";
}
export function markerInspectionFromObservation(o: WorkspaceMergeCommandObservation): MarkerInspection {
    const result: MarkerInspection = { state: "unknown", attempt: o.attempt, capture: o.capture, stdout: o.stdout, stderr: o.stderr };
    if (!o.failed) result.state = classifyMarkerInspection(result);
    return result;
}
export type MarkerRequest = { workdir: string; format: "text" | "json"; paths: string[]; acknowledgeIntentionalMarkers: boolean; preflight: boolean };
export type MarkerReceipt = {
    schemaVersion: 1;
    action: MarkerAction;
    provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" };
    ok: boolean;
    outcome: "clear" | "preflight" | "command-completed" | "failed" | "uncertain";
    data: {
        requested: MarkerRequest | null;
        command: string[] | null;
        inspection: MarkerInspection;
        commandCompleted: boolean;
        effect: "not-attempted" | "not-proven" | "uncertain";
        checkinReadiness: "unknown";
        verification: "unverified";
    };
    error: { code: "invalid_request" | "unknown_evidence" | "producer_failed"; message: string } | null;
};
export function markerReceipt(action: MarkerAction, requested: MarkerRequest | null, command: string[] | null, inspection = emptyMarkerInspection(), invalid = false): MarkerReceipt {
    const completed = markerCommandCompleted(inspection);
    const preview = !!requested?.preflight && !!command && inspection.attempt.state === "not-attempted" && inspection.capture === null;
    const clear = action === "merge-list-conflict-markers" && inspection.state === "clear";
    const ok = !invalid && (preview || (action === "merge-mark-resolved" ? completed : clear));
    const mayHaveStarted = ["started", "unknown"].includes(inspection.attempt.state);
    return {
        schemaVersion: 1, action, provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok,
        outcome: invalid ? "failed" : preview ? "preflight" : ok ? clear ? "clear" : "command-completed" : mayHaveStarted ? "uncertain" : "failed",
        data: { requested, command, inspection, commandCompleted: completed, effect: action === "merge-list-conflict-markers" || !mayHaveStarted ? "not-attempted" : completed ? "not-proven" : "uncertain", checkinReadiness: "unknown", verification: "unverified" },
        error: ok ? null : { code: invalid ? "invalid_request" : "unknown_evidence", message: invalid ? "Invalid marker lifecycle request or local file scope." : "Marker evidence is unknown. Do not infer rollback, retry automatically, or infer checkin readiness." },
    };
}
