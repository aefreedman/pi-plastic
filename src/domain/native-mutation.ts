import type { WorkspaceMergeAttempt, WorkspaceMergeCapture } from "../execution/native-mutation-command";
export type NativeCommandData = {
    command: string[] | null; workingDirectory: string | null;
    attempt: WorkspaceMergeAttempt; capture: WorkspaceMergeCapture | null;
    commandCompleted: boolean; commandOutput: { stdout: string | null; stderr: string | null } | null;
    effect: "not-attempted" | "command-completed" | "uncertain";
};
export type NativeHeader = { schemaVersion: 2; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: boolean } };
export type NativeOutcome = { ok: true; outcome: "preflight" | "command-completed" } | { ok: false; outcome: "failed" | "uncertain"; error: { code: string; message: string } };
export const safeNativeText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export function nativeCommandCompleted(data: NativeCommandData): boolean {
    return data.attempt.state === "started" && data.attempt.terminal === "observed" && data.attempt.exitCode === 0 && !data.attempt.aborted && !data.attempt.timedOut && data.capture?.complete === true;
}
export function nativeHeader(data: NativeCommandData): NativeHeader {
    return { schemaVersion: 2, provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, completeness: { capture: data.capture ? data.capture.complete ? "complete" : "incomplete" : "unknown", projection: !data.capture?.truncated } };
}
export function nativeOutcome(data: NativeCommandData, preview: boolean, invalid = false): NativeOutcome {
    if (invalid) return { ok: false, outcome: "failed", error: { code: "invalid_request", message: "Use declared arguments and bounded operands, not CLI options or stdin." } };
    if (preview) return { ok: true, outcome: "preflight" };
    if (data.commandCompleted) return { ok: true, outcome: "command-completed" };
    const started = ["started", "unknown"].includes(data.attempt.state);
    return { ok: false, outcome: started ? "uncertain" : "failed", error: { code: data.attempt.aborted ? "aborted" : data.attempt.timedOut ? "timed_out" : started ? "native_failure" : "launch_failed", message: "Native command did not establish successful completion. Inspect diagnostics and state; no automatic retry." } };
}
