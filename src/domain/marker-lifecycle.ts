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
/** Terminal/capture compatibility only; compact receipts cannot revalidate records. */
export function markerListingCaptureComplete(i: Pick<MarkerInspection, "attempt" | "capture">): boolean {
    const { attempt: a, capture: c } = i;
    return !!c && a.state === "started" && a.terminal === "observed" && !a.aborted && !a.timedOut && c.complete && c.validUtf8 && !c.truncated && c.stdoutBytes === c.stdoutRetainedBytes && c.stdoutBytes <= 65536 && c.stderrBytes === 0 && c.stderrRetainedBytes === 0;
}
/** Observed Windows CM 11.0.16.10512 ASCII listing profile only. Printed paths
 * are external evidence, never physical file identity or mutation operands. */
export function classifyMarkerInspection(i: MarkerInspection): MarkerInspection["state"] {
    if (!markerListingCaptureComplete(i) || i.stderr !== "" || i.stdout === null || Buffer.byteLength(i.stdout, "utf8") !== i.capture!.stdoutBytes) return "unknown";
    if (i.attempt.exitCode === 0 && i.stdout === "") return "clear";
    if (process.platform !== "win32" || i.attempt.exitCode !== 1 || !i.stdout.endsWith("\r\n")) return "unknown";
    const records = i.stdout.slice(0, -2).split("\r\n"), seen = new Set<string>();
    if (records.length > 256) return "unknown";
    for (const record of records) {
        if (!record.startsWith("CONFLICT_MARKERS /")) return "unknown";
        const path = record.slice("CONFLICT_MARKERS ".length);
        if (path.length > 4096 || seen.has(path.toLowerCase())) return "unknown";
        const components = path.slice(1).split("/");
        if (components.some(p => p.length > 255 || !/^[A-Za-z0-9](?:[A-Za-z0-9._ -]*[A-Za-z0-9_-])?$/.test(p) || p.includes("  ") || /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]) *(?:\.|$)/i.test(p))) return "unknown";
        seen.add(path.toLowerCase());
    }
    return "pending";
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
    outcome: "clear" | "pending" | "preflight" | "command-completed" | "failed" | "uncertain";
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
    const pending = action === "merge-list-conflict-markers" && inspection.state === "pending";
    const ok = !invalid && (preview || (action === "merge-mark-resolved" ? completed : clear || pending));
    const mayHaveStarted = ["started", "unknown"].includes(inspection.attempt.state);
    return {
        schemaVersion: 1, action, provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok,
        outcome: invalid ? "failed" : preview ? "preflight" : ok ? clear ? "clear" : pending ? "pending" : "command-completed" : mayHaveStarted ? "uncertain" : "failed",
        data: { requested, command, inspection, commandCompleted: completed, effect: action === "merge-list-conflict-markers" || !mayHaveStarted ? "not-attempted" : completed ? "not-proven" : "uncertain", checkinReadiness: "unknown", verification: "unverified" },
        error: ok ? null : { code: invalid ? "invalid_request" : "unknown_evidence", message: invalid ? "Invalid marker lifecycle request or local file scope." : "Marker evidence is unknown. Do not infer rollback, retry automatically, or infer checkin readiness." },
    };
}
