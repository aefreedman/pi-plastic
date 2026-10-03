import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { commandExecutionStorage, getActiveAbortSignal } from "./context";
import { getCmExecutable } from "./process";
export type CheckinAttempt = { state: "not-attempted" | "not-started" | "started" | "unknown"; terminal: "not-observed" | "observed"; exitCode: number | null; aborted: boolean; timedOut: boolean };
export type CheckinCapture = { stdoutBytes: number; stderrBytes: number; stdoutRetainedBytes: number; stderrRetainedBytes: number; truncated: boolean; complete: boolean; validUtf8: boolean };
export const emptyCheckinAttempt = (): CheckinAttempt => ({ state: "not-attempted", terminal: "not-observed", exitCode: null, aborted: false, timedOut: false });
export type CheckinCommandObservation = { attempt: CheckinAttempt; capture: CheckinCapture; stdout: string | null; stderr: string | null; failed: boolean };
/** Selected-tool byte capture; never retries, changes encoding, or discards effect uncertainty. */
export async function captureCheckinCommand(args: string[], workdir: string, timeoutMs = 30000): Promise<CheckinCommandObservation> {
    if (args.length > 120 || args.reduce((n, a) => n + a.length, 0) > 32768 || Buffer.byteLength(JSON.stringify(args), "utf8") > 65536) throw new Error("Checkin argv exceeds the admitted bound.");
    const attempt = emptyCheckinAttempt();
    const capture: CheckinCapture = { stdoutBytes: 0, stderrBytes: 0, stdoutRetainedBytes: 0, stderrRetainedBytes: 0, truncated: false, complete: false, validUtf8: false };
    const result: CheckinCommandObservation = { attempt, capture, stdout: null, stderr: null, failed: false };
    const signal = getActiveAbortSignal(), deps = commandExecutionStorage.getStore() ?? {};
    if (signal?.aborted) { attempt.aborted = true; return result; }
    let child: ReturnType<typeof spawn>;
    try { child = (deps.spawn ?? spawn)(getCmExecutable(), args, { cwd: workdir, shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { attempt.state = "not-started"; result.failed = true; return result; }
    attempt.state = "unknown";
    const schedule = deps.setTimeout ?? setTimeout, cancel = deps.clearTimeout ?? clearTimeout;
    let settled = false, failed = false, started = false, killTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
        if (settled) return;
        try { child.kill("SIGTERM"); } catch { /* completion race */ }
        if (killTimer === undefined) killTimer = schedule(() => { if (!settled) { try { child.kill("SIGKILL"); } catch { /* completion race */ } } }, deps.abortKillDelayMs ?? 5000);
    };
    const disposers: Array<() => void> = [];
    const collect = (stream: Readable | null, cap: number, name: "stdout" | "stderr") => {
        let length = 0; const parts: Buffer[] = [];
        if (!stream) { failed = true; terminate(); return Promise.resolve(Buffer.alloc(0)); }
        if (stream.readableEncoding) { failed = true; terminate(); }
        return new Promise<Buffer>(resolve => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(Buffer.concat(parts, length)); } };
            const data = (chunk: unknown) => {
                if (!(chunk instanceof Uint8Array)) { failed = true; terminate(); return; }
                capture[name === "stdout" ? "stdoutBytes" : "stderrBytes"] += chunk.byteLength;
                const available = cap - length;
                if (chunk.byteLength > available) { capture.truncated = true; terminate(); }
                if (available > 0) { const part = Buffer.from(chunk.subarray(0, available)); parts.push(part); length += part.length; }
            };
            const error = () => { failed = true; terminate(); finish(); };
            const close = () => { if (!done && !stream.readableEnded) failed = true; finish(); };
            stream.on("data", data); stream.once("end", finish); stream.once("error", error); stream.once("close", close);
            disposers.push(() => { stream.removeListener("data", data); stream.removeListener("end", finish); stream.removeListener("error", error); stream.removeListener("close", close); });
        });
    };
    let onClose!: (code: number | null, terminalSignal?: string | null) => void, onError!: (error: NodeJS.ErrnoException) => void;
    const onSpawn = () => { started = true; attempt.state = "started"; };
    const exit = new Promise<void>(resolve => {
        onClose = (code, terminalSignal) => {
            if (settled) return; settled = true; attempt.terminal = "observed";
            attempt.exitCode = Number.isInteger(code) && code !== null && code >= 0 ? code : null;
            if (!started || attempt.exitCode === null || terminalSignal) failed = true;
            resolve();
        };
        onError = error => {
            failed = true;
            if (!started && ["ENOENT", "EACCES", "ENOTDIR"].includes(error.code ?? "")) {
                attempt.state = "not-started"; settled = true; child.stdout?.destroy(); child.stderr?.destroy(); resolve();
            } else { terminate(); }
        };
        child.once("spawn", onSpawn); child.once("close", onClose); child.once("error", onError);
    });
    const out = collect(child.stdout, 65536, "stdout"), err = collect(child.stderr, 16384, "stderr");
    const onAbort = () => { attempt.aborted = true; terminate(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = schedule(() => { attempt.timedOut = true; terminate(); }, Math.min(deps.timeoutMs ?? timeoutMs, timeoutMs));
    if (signal?.aborted) onAbort();
    try {
        const [, stdout, stderr] = await Promise.all([exit, out, err]);
        capture.stdoutRetainedBytes = stdout.length; capture.stderrRetainedBytes = stderr.length;
        result.failed = failed;
        try {
            // Preserve a BOM as evidence rather than silently removing source bytes.
            result.stdout = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stdout);
            result.stderr = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stderr);
            capture.validUtf8 = true;
        } catch { result.stdout = null; result.stderr = null; }
        if (signal?.aborted) attempt.aborted = true;
        capture.complete = !failed && !result.failed && !attempt.aborted && !attempt.timedOut && capture.validUtf8 && !capture.truncated && attempt.terminal === "observed";
        return result;
    } finally {
        cancel(timer); if (killTimer !== undefined) cancel(killTimer);
        signal?.removeEventListener("abort", onAbort);
        child.removeListener("spawn", onSpawn); child.removeListener("close", onClose); child.removeListener("error", onError);
        for (const dispose of disposers) dispose();
    }
}
