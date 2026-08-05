import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { __plasticDiffInternals, __plasticProcessInternals, runWithAbortSignal } from "../src/plastic-core.ts";

const assert = (condition: boolean, message: string): void =>
{
    if (!condition)
    {
        throw new Error(message);
    }
};

class FakeChildProcess extends EventEmitter
{
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly stdin = new PassThrough();
    readonly signals: string[] = [];
    killed = false;

    kill(signal?: NodeJS.Signals): boolean
    {
        this.killed = true;
        this.signals.push(signal ?? "SIGTERM");
        return true;
    }

    close(code = 0): void
    {
        this.stdout.end();
        this.stderr.end();
        this.emit("close", code, null);
    }
}

const fakeSpawn = (proc: FakeChildProcess): typeof import("node:child_process").spawn =>
    (() => proc as unknown as ReturnType<typeof import("node:child_process").spawn>) as typeof import("node:child_process").spawn;

const testExecutableResolutionAndDiagnostics = async (): Promise<void> =>
{
    assert(__plasticProcessInternals.resolveCmExecutable({}) === "cm", "Expected cm to be the default Plastic executable.");
    assert(__plasticProcessInternals.resolveCmExecutable({ PI_PLASTIC_CM_EXECUTABLE: " /tools/cm " }) === "/tools/cm", "Expected PI_PLASTIC_CM_EXECUTABLE to override cm.");
    assert(__plasticProcessInternals.resolveDiffExecutable({}) === "diff", "Expected bare diff on PATH to be the only default text-diff backend.");
    assert(__plasticProcessInternals.resolveDiffExecutable({ PATH: "C:\\Program Files\\Git\\usr\\bin" }) === "diff", "A Pi/Windows-like PATH must not turn Git Bash into an implicit diff executable path.");
    const spacedDiffPath = __plasticProcessInternals.resolveDiffExecutable({ PI_PLASTIC_DIFF_EXECUTABLE: " C:/Program Files/GNU Diff/diff.exe " });
    assert(spacedDiffPath === "C:/Program Files/GNU Diff/diff.exe", "Expected a space-containing PI_PLASTIC_DIFF_EXECUTABLE path to be preserved as one executable.");
    const spacedProc = new FakeChildProcess();
    let spawnedCommand = "";
    const spacedRun = __plasticProcessInternals.spawnAndCollect(spacedDiffPath, ["-u", "left file", "right file"], process.cwd(), undefined, undefined, {
        spawn: ((command) => {
            spawnedCommand = command;
            queueMicrotask(() => spacedProc.close(0));
            return spacedProc as unknown as ReturnType<typeof import("node:child_process").spawn>;
        }) as typeof import("node:child_process").spawn,
    });
    await spacedRun;
    assert(spawnedCommand === spacedDiffPath, "Expected the space-containing diff path to be passed directly to spawn rather than shell-split.");

    const proc = new FakeChildProcess();
    const missingCm = __plasticProcessInternals.spawnAndCollect("cm", ["status"], process.cwd(), undefined, undefined, {
        spawn: fakeSpawn(proc),
    });
    const error = Object.assign(new Error("spawn cm ENOENT"), { code: "ENOENT" });
    proc.emit("error", error);

    await missingCm.then(
        () => { throw new Error("Expected a missing executable to reject."); },
        (reason: unknown) =>
        {
            assert(reason instanceof Error && reason.message.includes("PI_PLASTIC_CM_EXECUTABLE"), "Expected missing cm guidance to name PI_PLASTIC_CM_EXECUTABLE.");
        },
    );

    // Model a Pi/Windows environment with no Git Bash directory on PATH. The
    // package must report the portable diff setup, never suggest/use Git.
    const diffProc = new FakeChildProcess();
    const missingDiff = __plasticProcessInternals.spawnAndCollect(__plasticProcessInternals.resolveDiffExecutable(), ["-u", "left", "right"], process.cwd(), undefined, undefined, {
        spawn: fakeSpawn(diffProc),
    });
    diffProc.emit("error", Object.assign(new Error("spawn diff ENOENT"), { code: "ENOENT" }));
    await missingDiff.then(
        () => { throw new Error("Expected a missing diff executable to reject."); },
        (reason: unknown) =>
        {
            assert(reason instanceof Error && reason.message.includes("PI_PLASTIC_DIFF_EXECUTABLE") && reason.message.includes("Git Bash paths automatically"), "Expected Windows-like missing-diff guidance to name PI_PLASTIC_DIFF_EXECUTABLE and explain that Git Bash is not discovered.");
        },
    );
};

const testAbortEscalatesUntilTerminalSettlement = async (): Promise<void> =>
{
    const proc = new FakeChildProcess();
    const controller = new AbortController();
    let scheduledKill: (() => void) | undefined;
    let clearedTimerCount = 0;

    const resultPromise = __plasticProcessInternals.spawnAndCollect("fake", [], process.cwd(), undefined, controller.signal, {
        spawn: fakeSpawn(proc),
        setTimeout: (callback) =>
        {
            scheduledKill = callback;
            return {} as NodeJS.Timeout;
        },
        clearTimeout: () =>
        {
            clearedTimerCount += 1;
        },
    });

    controller.abort();
    assert(proc.killed, "Expected SIGTERM to mark the fake child as killed.");
    assert(proc.signals.join(",") === "SIGTERM", "Expected abort to send SIGTERM first.");
    assert(scheduledKill !== undefined, "Expected abort to schedule escalation.");

    // ChildProcess.killed means only that SIGTERM was sent; a still-running child needs SIGKILL.
    scheduledKill?.();
    assert(proc.signals.join(",") === "SIGTERM,SIGKILL", "Expected a non-settled child to receive SIGKILL even after SIGTERM was sent.");

    proc.close();
    const result = await resultPromise;
    assert(result.aborted, "Expected abort state to be reported after terminal close.");
    assert(clearedTimerCount === 1, "Expected the escalation timer to be cleared during cleanup.");

    controller.abort();
    assert(proc.signals.join(",") === "SIGTERM,SIGKILL", "Expected abort listener cleanup after terminal settlement.");
};

const testPortableDiffReceivesActiveAbortSignal = async (): Promise<void> =>
{
    const root = await mkdtemp(join(tmpdir(), "pi-plastic-diff-abort-"));
    try
    {
        const left = join(root, "left.txt");
        const right = join(root, "right.txt");
        await Promise.all([writeFile(left, "left\n"), writeFile(right, "right\n")]);
        const proc = new FakeChildProcess();
        const controller = new AbortController();
        let spawnedResolve: (() => void) | undefined;
        const spawned = new Promise<void>((resolvePromise) => { spawnedResolve = resolvePromise; });
        const result = runWithAbortSignal(
            controller.signal,
            () => __plasticDiffInternals.runPortableTextDiff(left, right, root, "left", "right"),
            { spawn: (() => { spawnedResolve?.(); return proc as unknown as ReturnType<typeof import("node:child_process").spawn>; }) as typeof import("node:child_process").spawn },
        );
        await spawned;
        controller.abort();
        assert(proc.signals.join(",") === "SIGTERM", "Expected the active abort signal to terminate the GNU/POSIX diff subprocess.");
        proc.close(1);
        await result.then(
            () => { throw new Error("Expected an aborted text diff to reject."); },
            (error: unknown) => { assert(error instanceof Error && error.message === "Text diff was aborted.", "Expected portable diff cancellation to retain its focused diagnostic."); },
        );
    }
    finally
    {
        await rm(root, { recursive: true, force: true });
    }
};

const testTerminalListenersExistBeforeStdinWrite = async (): Promise<void> =>
{
    const proc = new FakeChildProcess();
    proc.stdin.write = ((_chunk: unknown, _callback?: (error?: Error | null) => void): boolean =>
    {
        proc.stdout.end();
        proc.stderr.end();
        // Deliberately do not invoke the write callback: terminal error must still settle.
        proc.emit("error", new Error("stdin-triggered process failure"));
        return true;
    }) as typeof proc.stdin.write;

    let thrown: unknown;
    try
    {
        await __plasticProcessInternals.spawnAndCollect("fake", [], process.cwd(), "input", undefined, {
            spawn: fakeSpawn(proc),
        });
    }
    catch (error)
    {
        thrown = error;
    }

    assert(thrown instanceof Error && thrown.message === "stdin-triggered process failure", "Expected process error raised during stdin write to reject cleanly.");
    assert(proc.listenerCount("error") === 0 && proc.listenerCount("close") === 0, "Expected terminal listeners to be removed after rejection.");
};

const main = async (): Promise<void> =>
{
    await testExecutableResolutionAndDiagnostics();
    await testAbortEscalatesUntilTerminalSettlement();
    await testPortableDiffReceivesActiveAbortSignal();
    await testTerminalListenersExistBeforeStdinWrite();
    console.log("PASS: plastic process lifecycle tests passed");
};

void main();
