import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type SpawnResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    aborted: boolean;
    timedOut?: boolean;
    stdoutTruncated?: boolean;
    stdoutTotalChars?: number;
    stderrTruncated?: boolean;
    stderrTotalChars?: number;
};

export type ExecutableEnvironment = Record<string, string | undefined>;

export const resolveExecutable = (environment: ExecutableEnvironment, overrideVariable: string, fallback: string): string =>
{
    const override = environment[overrideVariable]?.trim();
    return override || fallback;
};

export const getCmExecutable = (): string => resolveExecutable(process.env, "PI_PLASTIC_CM_EXECUTABLE", "cm");
// `diff -u` has compatible exit semantics on Windows GNU diff and macOS BSD diff.
// Keep the executable name configurable rather than assuming a .exe suffix or package-manager path.
export const getDiffExecutable = (): string => resolveExecutable(process.env, "PI_PLASTIC_DIFF_EXECUTABLE", "diff");
export const executableNotFoundError = (command: string, error: Error): Error =>
{
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    {
        return error;
    }

    if (command === getCmExecutable())
    {
        return new Error(`Unable to launch Plastic SCM executable '${command}' (ENOENT). Set PI_PLASTIC_CM_EXECUTABLE to the full path to cm, or add cm to PATH.`);
    }

    if (command === getDiffExecutable())
    {
        return new Error(`Unable to launch GNU/POSIX text diff executable '${command}' (ENOENT). Set PI_PLASTIC_DIFF_EXECUTABLE to the full path of GNU/POSIX diff (paths containing spaces are supported), or install bare diff on PATH. Pi does not discover Git Bash paths automatically.`);
    }

    return new Error(`Unable to launch executable '${command}' (ENOENT). Verify that it is installed and available on PATH.`);
};

export const writeInput = async (stdin: NodeJS.WritableStream | null | undefined, input: string): Promise<void> =>
{
    if (!stdin)
    {
        return;
    }

    await new Promise<void>((resolvePromise, rejectPromise) =>
    {
        stdin.write(`${input}\n`, (error) =>
        {
            if (error)
            {
                rejectPromise(error);
                return;
            }

            stdin.end();
            resolvePromise();
        });
    });
};

export const readStream = async (stream: NodeJS.ReadableStream | null | undefined, maxChars?: number): Promise<{ output: string; truncated: boolean; totalChars: number }> =>
{
    if (!stream)
    {
        return { output: "", truncated: false, totalChars: 0 };
    }

    let output = "";
    let totalChars = 0;
    const decoder = new StringDecoder("utf8");
    const append = (text: string): void =>
    {
        totalChars += text.length;
        if (maxChars === undefined || output.length < maxChars)
        {
            output += maxChars === undefined ? text : text.slice(0, Math.max(0, maxChars - output.length));
        }
    };
    for await (const chunk of stream)
    {
        // Byte boundaries are not character boundaries. Already-decoded streams
        // retain their strings; flush pending bytes before switching to text.
        append(typeof chunk === "string" ? decoder.end() + chunk : decoder.write(chunk));
    }
    append(decoder.end());
    return { output, truncated: maxChars !== undefined && totalChars > maxChars, totalChars };
};

export type SpawnAndCollectDependencies = {
    spawn?: typeof spawn;
    setTimeout?: (callback: () => void, delay: number) => NodeJS.Timeout;
    clearTimeout?: (timeout: NodeJS.Timeout) => void;
    abortKillDelayMs?: number;
    timeoutMs?: number;
    outputLimitChars?: number;
};

export const spawnAndCollect = async (
    command: string,
    args: string[],
    cwd: string,
    input?: string,
    signal?: AbortSignal,
    dependencies: SpawnAndCollectDependencies = {},
): Promise<SpawnResult> =>
{
    if (signal?.aborted)
    {
        throw new Error(`cm ${args.join(" ")} aborted before start.`);
    }

    let proc: ReturnType<typeof spawn>;
    try
    {
        proc = (dependencies.spawn ?? spawn)(command, args, {
            cwd,
            stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
            shell: false,
        });
    }
    catch (error)
    {
        throw executableNotFoundError(command, error instanceof Error ? error : new Error(String(error)));
    }

    const scheduleTimeout = dependencies.setTimeout ?? setTimeout;
    const cancelTimeout = dependencies.clearTimeout ?? clearTimeout;
    const stdoutPromise = readStream(proc.stdout, dependencies.outputLimitChars);
    const stderrPromise = readStream(proc.stderr, dependencies.outputLimitChars);
    let aborted = false;
    let timedOut = false;
    let terminalSettled = false;
    let killTimeout: NodeJS.Timeout | undefined;
    let operationTimeout: NodeJS.Timeout | undefined;

    let resolveExit: (exitCode: number) => void;
    let rejectExit: (error: Error) => void;
    const exitPromise = new Promise<number>((resolvePromise, rejectPromise) =>
    {
        resolveExit = resolvePromise;
        rejectExit = rejectPromise;
    });
    const onProcessError = (error: Error) =>
    {
        if (terminalSettled)
        {
            return;
        }

        terminalSettled = true;
        rejectExit(executableNotFoundError(command, error));
    };
    const onProcessClose = (code: number | null) =>
    {
        if (terminalSettled)
        {
            return;
        }

        terminalSettled = true;
        resolveExit(code ?? 1);
    };

    // Register terminal listeners before any asynchronous stdin work can cause an error or close.
    proc.once("error", onProcessError);
    proc.once("close", onProcessClose);

    const terminate = () =>
    {
        if (terminalSettled)
        {
            return;
        }

        try
        {
            proc.kill("SIGTERM");
        }
        catch
        {
            // The process may have settled between the state check and signal.
        }
        killTimeout = scheduleTimeout(() =>
        {
            // ChildProcess.killed only means a signal was sent. It does not mean the process settled.
            if (!terminalSettled)
            {
                try
                {
                    proc.kill("SIGKILL");
                }
                catch
                {
                    // The process may have settled between the state check and signal.
                }
            }
        }, dependencies.abortKillDelayMs ?? 5000);
    };
    const onAbort = () =>
    {
        aborted = true;
        terminate();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (dependencies.timeoutMs !== undefined)
    {
        operationTimeout = scheduleTimeout(() =>
        {
            timedOut = true;
            terminate();
        }, dependencies.timeoutMs);
    }

    try
    {
        const exitCode = input
            ? await Promise.race([
                exitPromise,
                writeInput(proc.stdin, input).then(() => exitPromise),
            ])
            : await exitPromise;
        const [stdoutResult, stderrResult] = await Promise.all([stdoutPromise, stderrPromise]);
        return {
            stdout: stdoutResult.output,
            stderr: stderrResult.output,
            exitCode,
            aborted,
            timedOut,
            stdoutTruncated: stdoutResult.truncated,
            stdoutTotalChars: stdoutResult.totalChars,
            stderrTruncated: stderrResult.truncated,
            stderrTotalChars: stderrResult.totalChars,
        };
    }
    finally
    {
        signal?.removeEventListener("abort", onAbort);
        proc.removeListener("error", onProcessError);
        proc.removeListener("close", onProcessClose);
        if (killTimeout)
        {
            cancelTimeout(killTimeout);
        }
        if (operationTimeout)
        {
            cancelTimeout(operationTimeout);
        }
    }
};
