import { captureNativeMutation, emptyWorkspaceMergeAttempt } from "../execution/native-mutation-command";
import { nativeCommandCompleted, type NativeCommandData } from "../domain/native-mutation";
export function emptyNativeData(): NativeCommandData {
    return { command: null, workingDirectory: null, attempt: emptyWorkspaceMergeAttempt(), capture: null, commandCompleted: false, commandOutput: null, effect: "not-attempted" };
}
export async function runNativeMutation(data: NativeCommandData, onStdout?: (chunk: string) => void): Promise<void> {
    const observation = await captureNativeMutation(data.command!, data.workingDirectory!, 30000, onStdout);
    data.attempt = observation.attempt; data.capture = observation.capture;
    data.commandOutput = { stdout: observation.stdout, stderr: observation.stderr };
    data.commandCompleted = nativeCommandCompleted(data);
    data.effect = data.commandCompleted ? "command-completed" : ["started", "unknown"].includes(data.attempt.state) ? "uncertain" : "not-attempted";
}
