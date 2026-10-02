import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
export const DIFF_REVISIONS_CAPTURE_LIMITS = { stdoutBytes: 1048576, stderrBytes: 65536, timeoutMs: 30000 } as const;
import { commandExecutionStorage, getActiveAbortSignal } from "./context";
export class DiffRevisionsCommandError extends Error {
    constructor(readonly code: "command_failed" | "aborted" | "capture_incomplete") { super(`Revision comparison read failed (${code}).`); }
}

// Revision-comparison-only strict byte transport. Native/default and other read routes are unchanged.
export async function runDiffRevisionsCommand(executable: string, args: string[], cwd: string, allowedExitCodes: readonly number[]): Promise<{ stdout: Buffer; exitCode: number }> {
    const signal = getActiveAbortSignal();
    if (signal?.aborted) throw new DiffRevisionsCommandError("aborted");
    const dependencies = commandExecutionStorage.getStore() ?? {};
    let child;
    try { child = (dependencies.spawn ?? spawn)(executable, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new DiffRevisionsCommandError("command_failed"); }
    const schedule = dependencies.setTimeout ?? setTimeout;
    const cancel = dependencies.clearTimeout ?? clearTimeout;
    let aborted = false, incomplete = false, failed = false, settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
        if (settled) return;
        try { child.kill("SIGTERM"); } catch { /* process may already have exited */ }
        if (killTimer === undefined) killTimer = schedule(() => { if (!settled) { try { child.kill("SIGKILL"); } catch { /* process may already have exited */ } } }, dependencies.abortKillDelayMs ?? 5000);
    };
    const collectors: Array<{ dispose(): void }> = [];
    const collect = (stream: Readable | null, cap: number) => {
        let length = 0;
        const chunks: Buffer[] = [];
        if (!stream) { failed = true; terminate(); return Promise.resolve(Buffer.alloc(0)); }
        if (stream.readableEncoding) { failed = true; terminate(); }
        return new Promise<Buffer>(resolve => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(Buffer.concat(chunks, length)); } };
            const data = (chunk: unknown) => {
                // Already-decoded streams cannot attest exact source bytes.
                if (!(chunk instanceof Uint8Array)) { failed = true; terminate(); return; }
                const available = cap - length;
                if (chunk.byteLength > available) { incomplete = true; terminate(); }
                if (available > 0) { const part = Buffer.from(chunk.subarray(0, available)); chunks.push(part); length += part.length; }
                // Keep draining beyond the cap until process/streams settle.
            };
            const error = () => { failed = true; terminate(); finish(); };
            const closed = () => { if (!done && !stream.readableEnded) failed = true; finish(); };
            stream.on("data", data); stream.once("end", finish); stream.once("error", error); stream.once("close", closed);
            collectors.push({ dispose: () => { stream.removeListener("data", data); stream.removeListener("end", finish); stream.removeListener("error", error); stream.removeListener("close", closed); } });
        });
    };
    let onClose: (code: number | null, signal?: string | null) => void;
    let onError: () => void;
    const exit = new Promise<number>(resolve => {
        onClose = (code, signal) => { settled = true; if (code === null || signal) failed = true; resolve(code ?? -1); };
        onError = () => { failed = true; settled = true; child.stdout?.destroy(); child.stderr?.destroy(); resolve(1); };
        child.once("close", onClose); child.once("error", onError);
    });
    const stdout = collect(child.stdout, DIFF_REVISIONS_CAPTURE_LIMITS.stdoutBytes);
    const stderr = collect(child.stderr, DIFF_REVISIONS_CAPTURE_LIMITS.stderrBytes);
    const onAbort = () => { aborted = true; terminate(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = schedule(() => { incomplete = true; terminate(); }, Math.min(dependencies.timeoutMs ?? DIFF_REVISIONS_CAPTURE_LIMITS.timeoutMs, DIFF_REVISIONS_CAPTURE_LIMITS.timeoutMs));
    if (signal?.aborted) onAbort();
    try {
        const [code, bytes, errors] = await Promise.all([exit, stdout, stderr]);
        if (aborted || signal?.aborted) throw new DiffRevisionsCommandError("aborted");
        if (incomplete) throw new DiffRevisionsCommandError("capture_incomplete");
        if (failed || !allowedExitCodes.includes(code) || errors.length) throw new DiffRevisionsCommandError("command_failed");
        return { stdout: bytes, exitCode: code };
    } finally {
        cancel(timeout); if (killTimer !== undefined) cancel(killTimer);
        signal?.removeEventListener("abort", onAbort);
        child.removeListener("close", onClose!); child.removeListener("error", onError!);
        for (const collector of collectors) collector.dispose();
    }
}
