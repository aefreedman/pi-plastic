import { captureAddCommand, emptyAddAttempt } from "../execution/add-command";
import { ADD_COMMAND, safeAddText, validAddOperands, type AddData, type AddError, type AddReceipt } from "../domain/add-contract";
export { ADD_COMMAND, safeAddText, validAddOperands } from "../domain/add-contract";
export type { AddData, AddError, AddReceipt, AddAttempt, AddCapture } from "../domain/add-contract";
export { presentAddReceipt } from "../presentation/add-results";
export function emptyAddData(): AddData {
    return { intendedArgv: [ADD_COMMAND], requestedOperandCount: null, workingDirectory: null, attempt: emptyAddAttempt(), capture: null, observedWorkspaceIdentity: null, observedAddedItems: null, verification: "unverified", effect: "not-attempted" };
}
function addHeader(data: AddData) {
    return { schemaVersion: 1 as const, action: "add" as const, provenance: { source: "plastic" as const, producer: "@aefree/pi-plastic" as const, contentTrust: "external" as const }, completeness: { capture: data.capture ? data.capture.complete ? "complete" as const : "incomplete" as const : "unknown" as const, projection: true as const }, data };
}
export function addFailure(data: AddData, code: AddError["code"], message: string): AddReceipt {
    return { ...addHeader(data), ok: false, outcome: data.effect === "uncertain" ? "uncertain" : "failed", error: { code, message } };
}
export async function assembleAddReceipt(args: unknown): Promise<AddReceipt> {
    const data = emptyAddData(); let dispatched = false;
    try {
        if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => key !== "workdir" && key !== "paths")) return addFailure(data, "invalid_request", "Add accepts paths and workdir only; preview and extra options are unsupported.");
        const input = args as Record<string, unknown>;
        const cwd = input.workdir === undefined ? process.cwd() : input.workdir;
        if (!safeAddText(cwd)) return addFailure(data, "invalid_request", "Working directory must be nonblank bounded text without controls or invalid Unicode.");
        const paths = Array.isArray(input.paths) && input.paths.length <= 256 ? Array.from(input.paths) : input.paths;
        if (!validAddOperands(paths)) return addFailure(data, "invalid_request", "Provide 1–256 bounded path operands; CLI options and stdin sentinel are rejected, aggregate UTF8 limit 32768 bytes.");
        data.workingDirectory = cwd; data.intendedArgv = [ADD_COMMAND, ...paths]; data.requestedOperandCount = paths.length; dispatched = true;
        const observation = await captureAddCommand([...data.intendedArgv], cwd);
        data.attempt = observation.attempt; data.capture = observation.capture;
        if (observation.capture.complete && !observation.failed && observation.attempt.state === "started" && observation.attempt.exitCode === 0) {
            data.effect = "not-proven";
            return { ...addHeader(data), ok: true, outcome: "command-completed" };
        }
        data.effect = ["started", "unknown"].includes(data.attempt.state) ? "uncertain" : "not-attempted";
        return addFailure(data, data.attempt.aborted ? "aborted" : data.effect === "uncertain" ? "uncertain" : "launch_failed", data.effect === "uncertain" ? "Add completion is not proven; partial added-item or workspace effects may exist." : "Add did not establish a process start.");
    } catch {
        if (dispatched) { data.attempt = { ...emptyAddAttempt(), state: "unknown" }; data.capture = null; data.effect = "uncertain"; }
        return addFailure(data, "producer_failed", "Add observation failed; no rollback or safe retry is proven.");
    }
}
