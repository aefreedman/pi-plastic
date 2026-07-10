import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { __plasticProcessInternals } from "../src/plastic-core.ts";

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
    assert(__plasticProcessInternals.resolveGitExecutable({ PI_PLASTIC_GIT_EXECUTABLE: "C:/Tools/git.exe" }) === "C:/Tools/git.exe", "Expected PI_PLASTIC_GIT_EXECUTABLE to override git.");

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

    const gitProc = new FakeChildProcess();
    const missingGit = __plasticProcessInternals.spawnAndCollect("git", ["--version"], process.cwd(), undefined, undefined, {
        spawn: fakeSpawn(gitProc),
    });
    gitProc.emit("error", Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }));
    await missingGit.then(
        () => { throw new Error("Expected a missing Git executable to reject."); },
        (reason: unknown) =>
        {
            assert(reason instanceof Error && reason.message.includes("PI_PLASTIC_GIT_EXECUTABLE"), "Expected missing git guidance to name PI_PLASTIC_GIT_EXECUTABLE.");
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
    await testTerminalListenersExistBeforeStdinWrite();
    console.log("PASS: plastic process lifecycle tests passed");
};

void main();
