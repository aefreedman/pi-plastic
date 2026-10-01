import { commandExecutionStorage, getActiveAbortSignal } from "./context";
import { getCmExecutable, spawnAndCollect } from "./process";

export class StatusCommandError extends Error {
    constructor(readonly code: "command_failed" | "aborted" | "capture_incomplete") {
        super(code === "aborted" ? "Status read was cancelled." : code === "capture_incomplete" ? "Status capture was incomplete." : "Status command failed; CLI support or availability is not established.");
    }
}

// Status-only transport evidence. No raw command/error text crosses this seam on failure.
export const runStatusCommand = async (args: string[], workdir?: string, raw = false) => {
    const signal = getActiveAbortSignal();
    if (signal?.aborted) throw new StatusCommandError("aborted");
    let result;
    try {
        result = await spawnAndCollect(getCmExecutable(), args, workdir ?? process.cwd(), undefined, signal, commandExecutionStorage.getStore());
    } catch {
        throw new StatusCommandError(signal?.aborted ? "aborted" : "command_failed");
    }
    if (result.aborted) throw new StatusCommandError("aborted");
    if (result.timedOut || result.stdoutTruncated || result.stderrTruncated) throw new StatusCommandError("capture_incomplete");
    if (result.exitCode !== 0) throw new StatusCommandError("command_failed");
    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return {
        output: raw ? result.stdout : combined || "(no output)",
        // Successful stderr is not machine status evidence. Do not expose its content.
        capture: raw && result.stderr.length > 0 ? "unknown" as const : "complete" as const,
    };
};
