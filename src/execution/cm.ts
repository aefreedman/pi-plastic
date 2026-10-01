import { getActiveAbortSignal, commandExecutionStorage } from "./context";
import { getCmExecutable, spawnAndCollect } from "./process";

export const BLOCKED_CM_DIFF_MESSAGE = "`cm diff` is blocked in Pi because it may launch GUI windows and hang the CLI. Use `plastic_status` when only changed paths are needed. Do not diff routinely; when change-boundary evidence is necessary, use a focused `plastic_diffFile`, explicitly scoped `plastic_workspaceDiff`, or `plastic_diffRevisions`.";

export const ensureCmCommandAllowed = (args: string[]): void =>
{
    const command = (args[0] ?? "").trim().toLowerCase();
    if (command === "diff" || command === "differences")
    {
        throw new Error(BLOCKED_CM_DIFF_MESSAGE);
    }
};

export const runCm = async (args: string[], workdir?: string, input?: string, signal: AbortSignal | undefined = getActiveAbortSignal()): Promise<string> =>
{
    ensureCmCommandAllowed(args);
    const cwd = workdir ?? process.cwd();
    const { stdout, stderr, exitCode, aborted } = await spawnAndCollect(getCmExecutable(), args, cwd, input, signal, commandExecutionStorage.getStore());
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();

    if (aborted)
    {
        throw new Error(output.length > 0 ? `cm ${args.join(" ")} aborted.\n\n${output}` : `cm ${args.join(" ")} aborted.`);
    }

    if (exitCode !== 0)
    {
        throw new Error(output.length > 0 ? output : `cm ${args.join(" ")} failed with exit code ${exitCode}`);
    }

    return output.length > 0 ? output : "(no output)";
};

export const runCmRaw = async (args: string[], workdir?: string, input?: string, signal: AbortSignal | undefined = getActiveAbortSignal()): Promise<string> =>
{
    ensureCmCommandAllowed(args);
    const cwd = workdir ?? process.cwd();
    const { stdout, stderr, exitCode, aborted } = await spawnAndCollect(getCmExecutable(), args, cwd, input, signal, commandExecutionStorage.getStore());

    if (aborted)
    {
        const output = [stdout, stderr].filter(Boolean).join("\n").trim();
        throw new Error(output.length > 0 ? `cm ${args.join(" ")} aborted.\n\n${output}` : `cm ${args.join(" ")} aborted.`);
    }

    if (exitCode !== 0)
    {
        const output = [stdout, stderr].filter(Boolean).join("\n").trim();
        throw new Error(output.length > 0 ? output : `cm ${args.join(" ")} failed with exit code ${exitCode}`);
    }

    return stdout ?? "";
};

export const normalizeFindOutputLines = (output: string): string[] => output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "(no output)");

