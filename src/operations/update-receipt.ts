import { captureUpdateCommand, emptyUpdateAttempt } from "../execution/update-command";
import { UPDATE_ARGV, safeUpdateText, type UpdateData, type UpdateError, type UpdateReceipt } from "../domain/update-contract";
export { UPDATE_ARGV, safeUpdateText } from "../domain/update-contract";
export type { UpdateData, UpdateError, UpdateReceipt, UpdateAttempt, UpdateCapture } from "../domain/update-contract";
export { presentUpdateReceipt } from "../presentation/update-results";
export function emptyUpdateData(): UpdateData {
    return { intendedArgv: [...UPDATE_ARGV], workingDirectory: null, attempt: emptyUpdateAttempt(), capture: null, observedWorkspaceIdentity: null, observedChanges: null, verification: "unverified", effect: "not-attempted" };
}
function updateHeader(data: UpdateData) {
    return { schemaVersion: 1 as const, action: "update" as const, provenance: { source: "plastic" as const, producer: "@aefree/pi-plastic" as const, contentTrust: "external" as const }, completeness: { capture: data.capture ? data.capture.complete ? "complete" as const : "incomplete" as const : "unknown" as const, projection: true as const }, data };
}
export function updateFailure(data: UpdateData, code: UpdateError["code"], message: string): UpdateReceipt {
    return { ...updateHeader(data), ok: false, outcome: data.effect === "uncertain" ? "uncertain" : "failed", error: { code, message } };
}
export async function assembleUpdateReceipt(args: unknown): Promise<UpdateReceipt> {
    const data = emptyUpdateData(); let dispatched = false;
    try {
        if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => key !== "workdir")) return updateFailure(data, "invalid_request", "Update accepts workdir only; preview and extra options are unsupported.");
        const input = args as Record<string, unknown>;
        const cwd = input.workdir === undefined ? process.cwd() : input.workdir;
        if (!safeUpdateText(cwd)) return updateFailure(data, "invalid_request", "Working directory must be nonblank bounded text without controls or invalid Unicode.");
        data.workingDirectory = cwd; dispatched = true;
        const observation = await captureUpdateCommand([...UPDATE_ARGV], cwd);
        data.attempt = observation.attempt; data.capture = observation.capture;
        if (observation.capture.complete && !observation.failed && observation.attempt.state === "started" && observation.attempt.exitCode === 0) {
            data.effect = "not-proven";
            return { ...updateHeader(data), ok: true, outcome: "command-completed" };
        }
        data.effect = ["started", "unknown"].includes(data.attempt.state) ? "uncertain" : "not-attempted";
        return updateFailure(data, data.attempt.aborted ? "aborted" : data.effect === "uncertain" ? "uncertain" : "launch_failed", data.effect === "uncertain" ? "Update completion is not proven; partial workspace effects may exist." : "Update did not establish a process start.");
    } catch {
        if (dispatched) { data.attempt = { ...emptyUpdateAttempt(), state: "unknown" }; data.capture = null; data.effect = "uncertain"; }
        return updateFailure(data, "producer_failed", "Update observation failed; no rollback or safe retry is proven.");
    }
}
