import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
export const CODE_REVIEW_FIND_CAPTURE_LIMITS = { stdoutBytes: 1048576, stderrBytes: 65536, timeoutMs: 30000, records: 20000 } as const;
import { commandExecutionStorage, getActiveAbortSignal } from "./context";
import { getCmExecutable } from "./process";
export class CodeReviewFindCommandError extends Error {
    constructor(readonly code: "command_failed" | "aborted" | "capture_incomplete") { super(`Code review find read failed (${code}).`); }
}

// Retirement sinks retain no command state or captured buffers.
const ignoreRetiredError = () => {};
// Code-review-find-only strict byte transport. Native/default and other read routes are unchanged.
export async function runCodeReviewFindIdsCommand(args: string[], workdir?: string): Promise<Buffer> {
    const signal = getActiveAbortSignal();
    if (signal?.aborted) throw new CodeReviewFindCommandError("aborted");
    const dependencies = commandExecutionStorage.getStore() ?? {};
    let child;
    try { child = (dependencies.spawn ?? spawn)(getCmExecutable(), args, { cwd: workdir ?? process.cwd(), shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new CodeReviewFindCommandError("command_failed"); }
    const schedule = dependencies.setTimeout ?? setTimeout;
    const cancel = dependencies.clearTimeout ?? clearTimeout;
    let aborted = false, incomplete = false, failed = false, settled = false, retired = false, finalized = false, terminationRequested = false;
    let killTimer: NodeJS.Timeout | undefined, retireTimer: NodeJS.Timeout | undefined;
    let settleExit!: (code: number) => void;
    const finishers: Array<() => void> = [];
    const retire = () => {
        if (retired || finalized) return;
        retired = true; incomplete = true;
        // Bounded retirement is not proof that the process stopped.
        for (const emitter of [child, child.stdout, child.stderr]) emitter?.on("error", ignoreRetiredError);
        settleExit(1);
        for (const finish of finishers) finish();
        child.stdout?.destroy(); child.stderr?.destroy();
    };
    const terminate = () => {
        if (terminationRequested || retired || finalized) return;
        terminationRequested = true;
        const grace = dependencies.abortKillDelayMs ?? 5000;
        if (!settled) { try { child.kill("SIGTERM"); } catch { /* not termination proof */ } }
        killTimer = schedule(() => {
            if (retired || finalized) return;
            if (!settled) { try { child.kill("SIGKILL"); } catch { /* not termination proof */ } }
            // Drain is bounded even when close was observed but a pipe remains open.
            retireTimer = schedule(retire, grace);
        }, grace);
    };
    const collectors: Array<{ dispose(): void }> = [];
    const collect = (stream: Readable | null, cap: number) => {
        let length = 0;
        const chunks: Buffer[] = [];
        if (!stream) { failed = true; terminate(); return Promise.resolve(Buffer.alloc(0)); }
        if (stream.readableEncoding) { failed = true; terminate(); }
        return new Promise<Buffer>(resolve => {
            let done = false;
            const finish = () => { if (!done) { done = true; const bytes = Buffer.concat(chunks, length); chunks.length = 0; resolve(bytes); } };
            finishers.push(finish);
            const data = (chunk: unknown) => {
                if (done || retired || finalized) return;
                // Already-decoded streams cannot attest exact source bytes.
                if (!(chunk instanceof Uint8Array)) { failed = true; terminate(); return; }
                const available = cap - length;
                if (chunk.byteLength > available) { incomplete = true; terminate(); }
                if (available > 0) { const part = Buffer.from(chunk.subarray(0, available)); chunks.push(part); length += part.length; }
                // Keep draining beyond the cap until process/streams settle.
            };
            const error = () => { if (retired || finalized) return; failed = true; terminate(); finish(); };
            const closed = () => { if (retired || finalized) return; if (!done && !stream.readableEnded) failed = true; finish(); };
            stream.on("data", data); stream.once("end", finish); stream.on("error", error); stream.once("close", closed);
            collectors.push({ dispose: () => { stream.removeListener("data", data); stream.removeListener("end", finish); stream.removeListener("error", error); stream.removeListener("close", closed); } });
        });
    };
    let onClose: (code: number | null) => void;
    let onError: () => void;
    const exit = new Promise<number>(resolve => {
        settleExit = resolve;
        onClose = code => { if (retired || finalized) return; settled = true; resolve(code ?? 1); };
        onError = () => { if (retired || finalized) return; failed = true; terminate(); child.stdout?.destroy(); child.stderr?.destroy(); resolve(1); };
        child.once("close", onClose); child.on("error", onError);
    });
    const stdout = collect(child.stdout, CODE_REVIEW_FIND_CAPTURE_LIMITS.stdoutBytes);
    const stderr = collect(child.stderr, CODE_REVIEW_FIND_CAPTURE_LIMITS.stderrBytes);
    const onAbort = () => { aborted = true; terminate(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = schedule(() => { incomplete = true; terminate(); }, Math.min(dependencies.timeoutMs ?? CODE_REVIEW_FIND_CAPTURE_LIMITS.timeoutMs, CODE_REVIEW_FIND_CAPTURE_LIMITS.timeoutMs));
    if (signal?.aborted) onAbort();
    try {
        const [code, bytes, errors] = await Promise.all([exit, stdout, stderr]);
        if (aborted || signal?.aborted) throw new CodeReviewFindCommandError("aborted");
        if (incomplete) throw new CodeReviewFindCommandError("capture_incomplete");
        if (failed || code !== 0 || errors.length) throw new CodeReviewFindCommandError("command_failed");
        return bytes;
    } finally {
        finalized = true;
        cancel(timeout); if (killTimer !== undefined) cancel(killTimer); if (retireTimer !== undefined) cancel(retireTimer);
        signal?.removeEventListener("abort", onAbort);
        child.removeListener("close", onClose!); child.removeListener("error", onError!);
        for (const collector of collectors) collector.dispose();
        finishers.length = 0; collectors.length = 0;
    }
}
