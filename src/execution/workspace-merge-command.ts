import { captureNativeMutation } from "./native-mutation-command";
export { emptyWorkspaceMergeAttempt } from "./native-mutation-command";
export type { WorkspaceMergeAttempt, WorkspaceMergeCapture, WorkspaceMergeCommandObservation } from "./native-mutation-command";
/** Marker inspection requires the entire listing, unlike mutation completion.
 * Keep that read contract without stopping a verbose native process. */
export async function captureWorkspaceMergeCommand(args: string[], workdir?: string, timeoutMs = 30000) {
    const observation = await captureNativeMutation(args, workdir, timeoutMs);
    if (observation.capture.truncated) observation.capture.complete = false;
    return observation;
}
