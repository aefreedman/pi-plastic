import { captureRemovalCommand, emptyRemovalAttempt } from "../execution/removal-command";
import { REMOVAL_COMMAND, safeRemovalText, validRemovalOperands, type RemovalData, type RemovalError, type RemovalReceipt } from "../domain/removal-contract";
export { REMOVAL_COMMAND, safeRemovalText, validRemovalOperands } from "../domain/removal-contract";
export type { RemovalData, RemovalError, RemovalReceipt, RemovalAttempt, RemovalCapture } from "../domain/removal-contract";
export { presentRemovalReceipt } from "../presentation/removal-results";
export function emptyRemovalData(): RemovalData {
    return { intendedArgv: [REMOVAL_COMMAND], requestedOperandCount: null, workingDirectory: null, keepOnDiskRequested: null, previewRequested: null, outputFormatRequested: null, resolutionIntent: "accept-source-deletion", attempt: emptyRemovalAttempt(), capture: null, observedWorkspaceIdentity: null, observedResolvedItems: null, observedResolution: null, observedPreservation: null, observedPendingState: null, verification: "unverified", effect: "not-attempted" };
}
function removalHeader(data: RemovalData) {
    return { schemaVersion: 1 as const, action: "resolve-delete-change-conflict" as const, provenance: { source: "plastic" as const, producer: "@aefree/pi-plastic" as const, contentTrust: "external" as const }, completeness: { capture: data.capture ? data.capture.complete ? "complete" as const : "incomplete" as const : "unknown" as const, projection: true as const }, data };
}
export function removalFailure(data: RemovalData, code: RemovalError["code"], message: string): RemovalReceipt {
    return { ...removalHeader(data), ok: false, outcome: data.effect === "uncertain" ? "uncertain" : "failed", error: { code, message } };
}
export async function assembleRemovalReceipt(args: unknown): Promise<RemovalReceipt> {
    const data = emptyRemovalData(); let dispatched = false;
    try {
        if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => !["paths", "workdir", "keepOnDisk", "preflight", "format"].includes(key))) return removalFailure(data, "invalid_request", "Removal accepts paths, workdir, keepOnDisk, preflight and text/json format only.");
        const input = args as Record<string, unknown>;
        const cwd = input.workdir === undefined ? process.cwd() : input.workdir;
        const keep = input.keepOnDisk === undefined ? true : input.keepOnDisk;
        const preview = input.preflight === undefined ? false : input.preflight;
        const format = input.format === undefined ? "text" : input.format;
        const paths = Array.isArray(input.paths) && input.paths.length <= 256 ? Array.from(input.paths) : input.paths;
        if (!safeRemovalText(cwd) || !validRemovalOperands(paths) || typeof keep !== "boolean" || typeof preview !== "boolean" || !["text", "json"].includes(format as string)) return removalFailure(data, "invalid_request", "Use bounded path operands, strict booleans and text/json format; flags, stdin and bare private/controlled modes are rejected.");
        data.workingDirectory = cwd; data.intendedArgv = [REMOVAL_COMMAND, ...(keep ? ["--nodisk"] : []), ...paths]; data.requestedOperandCount = paths.length;
        data.keepOnDiskRequested = keep; data.previewRequested = preview; data.outputFormatRequested = format as "text" | "json";
        if (preview) return { ...removalHeader(data), ok: true, outcome: "preflight" };
        dispatched = true;
        const observation = await captureRemovalCommand([...data.intendedArgv], cwd);
        data.attempt = observation.attempt; data.capture = observation.capture;
        if (observation.capture.complete && !observation.failed && observation.attempt.state === "started" && observation.attempt.exitCode === 0) {
            data.effect = "not-proven";
            return { ...removalHeader(data), ok: true, outcome: "command-completed" };
        }
        data.effect = ["started", "unknown"].includes(data.attempt.state) ? "uncertain" : "not-attempted";
        return removalFailure(data, data.attempt.aborted ? "aborted" : data.effect === "uncertain" ? "uncertain" : "launch_failed", data.effect === "uncertain" ? "Removal completion is not proven; partial removal or workspace/disk effects may exist." : "Removal did not establish a process start.");
    } catch {
        if (dispatched) { data.attempt = { ...emptyRemovalAttempt(), state: "unknown" }; data.capture = null; data.effect = "uncertain"; }
        return removalFailure(data, "producer_failed", "Removal observation failed; no rollback or safe retry is proven.");
    }
}
