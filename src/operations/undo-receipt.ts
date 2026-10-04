import { captureUndoCommand, emptyUndoAttempt } from "../execution/undo-command";
import { UNDO_COMMAND, safeUndoText, validUndoOperands, type UndoData, type UndoError, type UndoReceipt } from "../domain/undo-contract";
export { UNDO_COMMAND, safeUndoText, validUndoOperands } from "../domain/undo-contract";
export type { UndoData, UndoError, UndoReceipt, UndoAttempt, UndoCapture } from "../domain/undo-contract";
export { presentUndoReceipt } from "../presentation/undo-results";
export function emptyUndoData(): UndoData {
    return { intendedArgv: [UNDO_COMMAND], requestedOperandCount: null, workingDirectory: null, attempt: emptyUndoAttempt(), capture: null, observedWorkspaceIdentity: null, observedUndoneItems: null, verification: "unverified", effect: "not-attempted" };
}
function undoHeader(data: UndoData) {
    return { schemaVersion: 1 as const, action: "undo" as const, provenance: { source: "plastic" as const, producer: "@aefree/pi-plastic" as const, contentTrust: "external" as const }, completeness: { capture: data.capture ? data.capture.complete ? "complete" as const : "incomplete" as const : "unknown" as const, projection: true as const }, data };
}
export function undoFailure(data: UndoData, code: UndoError["code"], message: string): UndoReceipt {
    return { ...undoHeader(data), ok: false, outcome: data.effect === "uncertain" ? "uncertain" : "failed", error: { code, message } };
}
export async function assembleUndoReceipt(args: unknown): Promise<UndoReceipt> {
    const data = emptyUndoData(); let dispatched = false;
    try {
        if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => key !== "workdir" && key !== "paths")) return undoFailure(data, "invalid_request", "Undo accepts paths and workdir only; preview and extra options are unsupported.");
        const input = args as Record<string, unknown>;
        const cwd = input.workdir === undefined ? process.cwd() : input.workdir;
        if (!safeUndoText(cwd)) return undoFailure(data, "invalid_request", "Working directory must be nonblank bounded text without controls or invalid Unicode.");
        const paths = Array.isArray(input.paths) && input.paths.length <= 256 ? Array.from(input.paths) : input.paths;
        if (!validUndoOperands(paths)) return undoFailure(data, "invalid_request", "Provide 1–256 bounded path operands; CLI options, filters and hyphen-leading sentinels are rejected, aggregate UTF8 limit 32768 bytes.");
        data.workingDirectory = cwd; data.intendedArgv = [UNDO_COMMAND, ...paths]; data.requestedOperandCount = paths.length; dispatched = true;
        const observation = await captureUndoCommand([...data.intendedArgv], cwd);
        data.attempt = observation.attempt; data.capture = observation.capture;
        if (observation.capture.complete && !observation.failed && observation.attempt.state === "started" && observation.attempt.exitCode === 0) {
            data.effect = "not-proven";
            return { ...undoHeader(data), ok: true, outcome: "command-completed" };
        }
        data.effect = ["started", "unknown"].includes(data.attempt.state) ? "uncertain" : "not-attempted";
        return undoFailure(data, data.attempt.aborted ? "aborted" : data.effect === "uncertain" ? "uncertain" : "launch_failed", data.effect === "uncertain" ? "Undo completion is not proven; partial undone-item or workspace effects may exist." : "Undo did not establish a process start.");
    } catch {
        if (dispatched) { data.attempt = { ...emptyUndoAttempt(), state: "unknown" }; data.capture = null; data.effect = "uncertain"; }
        return undoFailure(data, "producer_failed", "Undo observation failed; no rollback or safe retry is proven.");
    }
}
