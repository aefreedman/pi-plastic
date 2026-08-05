import { AsyncLocalStorage } from "node:async_hooks";
import { isUtf8 } from "node:buffer";
import { spawn } from "node:child_process";
import { tool } from "./pi-tool-compat";
import { promises as fs, realpathSync, statSync } from "node:fs";
import { tmpdir } from "os";
import { dirname, extname, isAbsolute, join, relative, resolve, win32 } from "path";
import { parsePlasticStatusBranch } from "./plastic-workspace";

type SpawnResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    aborted: boolean;
    stdoutTruncated?: boolean;
    stdoutTotalChars?: number;
};

const abortSignalStorage = new AsyncLocalStorage<AbortSignal | undefined>();
const commandExecutionStorage = new AsyncLocalStorage<SpawnAndCollectDependencies | undefined>();

type ExecutableEnvironment = Record<string, string | undefined>;

const resolveExecutable = (environment: ExecutableEnvironment, overrideVariable: string, fallback: string): string =>
{
    const override = environment[overrideVariable]?.trim();
    return override || fallback;
};

const getCmExecutable = (): string => resolveExecutable(process.env, "PI_PLASTIC_CM_EXECUTABLE", "cm");
// `diff -u` has compatible exit semantics on Windows GNU diff and macOS BSD diff.
// Keep the executable name configurable rather than assuming a .exe suffix or package-manager path.
const getDiffExecutable = (): string => resolveExecutable(process.env, "PI_PLASTIC_DIFF_EXECUTABLE", "diff");

const executableNotFoundError = (command: string, error: Error): Error =>
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

const getActiveAbortSignal = (): AbortSignal | undefined => abortSignalStorage.getStore();

export const runWithAbortSignal = async <T>(
    signal: AbortSignal | undefined,
    fn: () => Promise<T>,
    commandExecution?: SpawnAndCollectDependencies,
): Promise<T> => abortSignalStorage.run(signal, () => commandExecutionStorage.run(commandExecution, fn));

const writeInput = async (stdin: NodeJS.WritableStream | null | undefined, input: string): Promise<void> =>
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

const readStream = async (stream: NodeJS.ReadableStream | null | undefined, maxChars?: number): Promise<{ output: string; truncated: boolean; totalChars: number }> =>
{
    if (!stream)
    {
        return { output: "", truncated: false, totalChars: 0 };
    }

    let output = "";
    let totalChars = 0;
    for await (const chunk of stream)
    {
        const text = chunk.toString();
        totalChars += text.length;
        if (maxChars === undefined || output.length < maxChars)
        {
            output += maxChars === undefined ? text : text.slice(0, Math.max(0, maxChars - output.length));
        }
    }
    return { output, truncated: maxChars !== undefined && totalChars > maxChars, totalChars };
};

type SpawnAndCollectDependencies = {
    spawn?: typeof spawn;
    setTimeout?: (callback: () => void, delay: number) => NodeJS.Timeout;
    clearTimeout?: (timeout: NodeJS.Timeout) => void;
    abortKillDelayMs?: number;
    outputLimitChars?: number;
};

const spawnAndCollect = async (
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
    let terminalSettled = false;
    let killTimeout: NodeJS.Timeout | undefined;

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

    const onAbort = () =>
    {
        if (terminalSettled)
        {
            return;
        }

        aborted = true;
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

    signal?.addEventListener("abort", onAbort, { once: true });

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
            stdoutTruncated: stdoutResult.truncated,
            stdoutTotalChars: stdoutResult.totalChars,
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
    }
};

const BLOCKED_CM_DIFF_MESSAGE = "`cm diff` is blocked in Pi because it may launch GUI windows and hang the CLI. Use `plastic_status` when only changed paths are needed. Do not diff routinely; when change-boundary evidence is necessary, use a focused `plastic_diffFile`, explicitly scoped `plastic_workspaceDiff`, or `plastic_diffRevisions`.";

const ensureCmCommandAllowed = (args: string[]): void =>
{
    const command = (args[0] ?? "").trim().toLowerCase();
    if (command === "diff" || command === "differences")
    {
        throw new Error(BLOCKED_CM_DIFF_MESSAGE);
    }
};

const runCm = async (args: string[], workdir?: string, input?: string, signal: AbortSignal | undefined = getActiveAbortSignal()): Promise<string> =>
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

const runCmRaw = async (args: string[], workdir?: string, input?: string, signal: AbortSignal | undefined = getActiveAbortSignal()): Promise<string> =>
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

type PendingItemKind = "added" | "changed" | "moved" | "deleted" | "private" | "other";

type PendingItem = {
    statusCode: string;
    workspacePath: string;
    normalizedPath: string;
    comparisonKey: string;
    isDirectory: boolean;
    kind: PendingItemKind;
    revisionId?: string;
    sourceWorkspacePath?: string;
};

type PendingItemSummary = {
    totalPending: number;
    added: number;
    changed: number;
    moved: number;
    deleted: number;
    private: number;
    other: number;
    tracked: number;
    privatePaths: string[];
};

type PrivateAutoAddSelection = {
    candidatePaths: string[];
    blockedPaths: Array<{ path: string; reason: string }>;
};

type ResolvedCheckinPaths = {
    requestedPaths: string[];
    includedPaths: string[];
    includedAbsolutePaths: string[];
    fallbackPaths: string[];
    fallbackAbsolutePaths: string[];
    rewrittenPaths: string[];
    excludedPaths: Array<{ path: string; reason: string }>;
    shouldApplyChanged: boolean;
    rewriteReason?: string;
    matchedPendingCount: number;
};

const isWindowsStyleAbsolutePath = (absolutePath: string): boolean => /^[A-Za-z]:\//.test(absolutePath) || absolutePath.startsWith("//");

const toNormalizedAbsolutePath = (pathValue: string, cwd: string): string =>
{
    const normalizedPathValue = pathValue.replace(/\\/g, "/");
    const normalizedCwd = cwd.replace(/\\/g, "/");
    if (isWindowsStyleAbsolutePath(normalizedPathValue))
    {
        return win32.normalize(normalizedPathValue).replace(/\\/g, "/");
    }

    if (isWindowsStyleAbsolutePath(normalizedCwd))
    {
        return win32.resolve(normalizedCwd, normalizedPathValue).replace(/\\/g, "/");
    }

    const absolutePath = isAbsolute(pathValue) ? resolve(pathValue) : resolve(cwd, pathValue);
    return absolutePath.replace(/\\/g, "/");
};

const darwinVolumeCaseSensitivity = new Map<string, boolean>();
const isSameFilesystemDevice = (volumeDevice: number | bigint, candidateDevice: number | bigint): boolean =>
    volumeDevice === candidateDevice;

const findCanonicalExistingAncestor = (absolutePath: string): string | null =>
{
    let candidate = absolutePath;
    while (true)
    {
        try
        {
            return realpathSync.native(candidate).replace(/\\/g, "/");
        }
        catch
        {
            const parent = dirname(candidate);
            if (parent === candidate)
            {
                return null;
            }

            candidate = parent;
        }
    }
};

const toggleFirstAsciiLetterCase = (value: string): string | null =>
{
    const index = value.search(/[A-Za-z]/);
    if (index < 0)
    {
        return null;
    }

    const letter = value[index];
    const toggled = letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase();
    return `${value.slice(0, index)}${toggled}${value.slice(index + 1)}`;
};

// APFS may be formatted case-sensitive or case-insensitive, so Darwin must probe the
// canonical existing ancestor on the target volume instead of assuming a platform policy.
const isDarwinCaseInsensitiveVolume = (absolutePath: string): boolean =>
{
    const canonicalAncestor = findCanonicalExistingAncestor(absolutePath);
    if (!canonicalAncestor)
    {
        return false;
    }

    try
    {
        const volumeDevice = statSync(canonicalAncestor).dev;
        const volumeKey = String(volumeDevice);
        const cached = darwinVolumeCaseSensitivity.get(volumeKey);
        if (cached !== undefined)
        {
            return cached;
        }

        let probePath = canonicalAncestor;
        while (true)
        {
            const parent = dirname(probePath);
            if (parent === probePath)
            {
                darwinVolumeCaseSensitivity.set(volumeKey, false);
                return false;
            }

            // A mount point's parent belongs to a different filesystem. Do not
            // infer the mounted volume's case policy from the parent/root volume.
            if (!isSameFilesystemDevice(volumeDevice, statSync(parent).dev))
            {
                darwinVolumeCaseSensitivity.set(volumeKey, false);
                return false;
            }

            const alternateName = toggleFirstAsciiLetterCase(probePath.slice(parent.length + 1));
            if (alternateName)
            {
                try
                {
                    const canonicalAlternate = realpathSync.native(join(parent, alternateName)).replace(/\\/g, "/");
                    const isCaseInsensitive = canonicalAlternate === probePath;
                    darwinVolumeCaseSensitivity.set(volumeKey, isCaseInsensitive);
                    return isCaseInsensitive;
                }
                catch
                {
                    darwinVolumeCaseSensitivity.set(volumeKey, false);
                    return false;
                }
            }

            probePath = parent;
        }
    }
    catch
    {
        // A failed probe must preserve distinct paths rather than risk conflating files.
        return false;
    }
};

type PathComparisonPolicy = {
    platform?: NodeJS.Platform;
    isDarwinCaseInsensitiveVolume?: (absolutePath: string) => boolean;
};

const toPathComparisonKeyFromAbsolutePath = (absolutePath: string, policy: PathComparisonPolicy = {}): string =>
{
    const normalizedPath = absolutePath.replace(/\\/g, "/");
    // Keep Windows and UNC behavior regardless of the host platform, including when parsing
    // status captured from a Windows workspace on another machine.
    if (isWindowsStyleAbsolutePath(normalizedPath))
    {
        return normalizedPath.toLowerCase();
    }

    if ((policy.platform ?? process.platform) === "darwin"
        && (policy.isDarwinCaseInsensitiveVolume ?? isDarwinCaseInsensitiveVolume)(normalizedPath))
    {
        return normalizedPath.toLowerCase();
    }

    return normalizedPath;
};

const toPathComparisonKey = (pathValue: string, cwd: string): string => toPathComparisonKeyFromAbsolutePath(toNormalizedAbsolutePath(pathValue, cwd));

const toCommandPath = (absolutePath: string, cwd: string): string =>
{
    const relativePath = isWindowsStyleAbsolutePath(absolutePath.replace(/\\/g, "/"))
        && isWindowsStyleAbsolutePath(cwd.replace(/\\/g, "/"))
        ? win32.relative(cwd, absolutePath)
        : relative(cwd, absolutePath);
    if (relativePath.length === 0)
    {
        return ".";
    }

    if (relativePath.startsWith(".."))
    {
        return absolutePath;
    }

    return relativePath;
};

const isWithinPathScope = (candidatePath: string, scopePath: string): boolean =>
{
    if (candidatePath === scopePath)
    {
        return true;
    }

    return candidatePath.startsWith(`${scopePath}/`);
};

const dedupeAndMinimizeAbsolutePaths = (absolutePaths: string[]): string[] =>
{
    const uniquePaths: string[] = [];
    const seenComparisonKeys = new Set<string>();
    for (const path of absolutePaths)
    {
        const comparisonKey = toPathComparisonKeyFromAbsolutePath(path);
        if (seenComparisonKeys.has(comparisonKey))
        {
            continue;
        }

        seenComparisonKeys.add(comparisonKey);
        uniquePaths.push(path);
    }

    const sortedPaths = uniquePaths.sort((left, right) => left.length - right.length);
    const minimizedPaths: string[] = [];
    const minimizedComparisonKeys: string[] = [];

    for (const path of sortedPaths)
    {
        const comparisonKey = toPathComparisonKeyFromAbsolutePath(path);
        if (minimizedComparisonKeys.some((scopePath) => isWithinPathScope(comparisonKey, scopePath)))
        {
            continue;
        }

        minimizedPaths.push(path);
        minimizedComparisonKeys.push(comparisonKey);
    }

    return minimizedPaths;
};

const inferPendingItemKind = (statusCode: string): PendingItemKind =>
{
    const normalizedStatus = statusCode.toUpperCase();

    if (normalizedStatus.includes("MV"))
    {
        return "moved";
    }

    if (normalizedStatus.includes("LD") || normalizedStatus.includes("RD") || normalizedStatus.includes("DE") || normalizedStatus.includes("RM"))
    {
        return "deleted";
    }

    if (normalizedStatus.includes("AD"))
    {
        return "added";
    }

    if (normalizedStatus.includes("PR"))
    {
        return "private";
    }

    if (normalizedStatus.includes("CH") || normalizedStatus.includes("CO") || normalizedStatus.includes("RP"))
    {
        return "changed";
    }

    return "other";
};

// Unit separator is accepted by Plastic and cannot occur in supported workspace paths.
const STATUS_FIELD_SEPARATOR = "\x1f";

const parseMachineReadablePendingItems = (output: string, cwd: string): PendingItem[] =>
{
    const lines = normalizeFindOutputLines(output);
    // Legacy records have no reliable way to distinguish the source and destination
    // fields of a move, so they remain supported for normal records only.
    const legacyStatusLinePattern = /^([A-Z+]+)\s+(.+)\s+(True|False)(?:\s+(.*))?$/;
    const pendingItems: PendingItem[] = [];
    const addItem = (statusCode: string, workspacePath: string, isDirectory: boolean, revisionId?: string, sourceWorkspacePath?: string): void =>
    {
        const normalizedPath = toNormalizedAbsolutePath(workspacePath, cwd);
        pendingItems.push({
            statusCode,
            workspacePath,
            normalizedPath,
            comparisonKey: toPathComparisonKeyFromAbsolutePath(normalizedPath),
            isDirectory,
            kind: inferPendingItemKind(statusCode),
            ...(revisionId ? { revisionId } : {}),
            ...(sourceWorkspacePath ? { sourceWorkspacePath } : {}),
        });
    };

    for (const line of lines)
    {
        if (line.startsWith("STATUS "))
        {
            continue;
        }

        if (line.includes(STATUS_FIELD_SEPARATOR))
        {
            const fields = line.split(STATUS_FIELD_SEPARATOR);
            const statusCode = fields[0];
            if (!/^[A-Z+]+$/.test(statusCode))
            {
                continue;
            }

            const kind = inferPendingItemKind(statusCode);
            if (kind === "moved")
            {
                // MV: status, percent, source, destination, directory, revision, metadata.
                const [,, sourceWorkspacePath, workspacePath, directoryField, revisionField] = fields;
                if (!sourceWorkspacePath || !workspacePath || (directoryField !== "True" && directoryField !== "False"))
                {
                    continue;
                }
                addItem(statusCode, workspacePath, directoryField === "True", /^\d+$/.test(revisionField ?? "") ? revisionField : undefined, sourceWorkspacePath);
                continue;
            }

            // Ordinary records: status, path, directory, revision, metadata.
            // Only moved records include a similarity-percent field.
            const [, workspacePath, directoryField, revisionField] = fields;
            if (!workspacePath || (directoryField !== "True" && directoryField !== "False"))
            {
                continue;
            }
            addItem(statusCode, workspacePath, directoryField === "True", /^\d+$/.test(revisionField ?? "") ? revisionField : undefined);
            continue;
        }

        const match = line.match(legacyStatusLinePattern);
        if (!match)
        {
            continue;
        }

        const statusCode = match[1];
        // A whitespace-delimited MV record cannot safely reveal which portion is
        // its destination. Skipping it prevents checkin/diff from targeting a
        // wrong workspace path; package-owned calls always request a separator.
        if (inferPendingItemKind(statusCode) === "moved")
        {
            continue;
        }
        const workspacePath = match[2];
        const isDirectory = match[3] === "True";
        const revisionId = (match[4] ?? "").match(/^\s*(\d+)\b/)?.[1];
        addItem(statusCode, workspacePath, isDirectory, revisionId);
    }

    return pendingItems;
};

const getMachineReadablePendingItems = async (workdir?: string): Promise<PendingItem[]> =>
{
    const cwd = workdir ?? process.cwd();
    const output = await runCmRaw(["status", "--machinereadable", "--includeRevId", `--fieldseparator=${STATUS_FIELD_SEPARATOR}`], workdir);
    return parseMachineReadablePendingItems(output, cwd);
};

const summarizePendingItems = (pendingItems: PendingItem[], cwd?: string): PendingItemSummary =>
{
    const summary: PendingItemSummary = {
        totalPending: pendingItems.length,
        added: 0,
        changed: 0,
        moved: 0,
        deleted: 0,
        private: 0,
        other: 0,
        tracked: 0,
        privatePaths: [],
    };

    for (const item of pendingItems)
    {
        switch (item.kind)
        {
            case "added":
                summary.added += 1;
                break;
            case "changed":
                summary.changed += 1;
                break;
            case "moved":
                summary.moved += 1;
                break;
            case "deleted":
                summary.deleted += 1;
                break;
            case "private":
                summary.private += 1;
                summary.privatePaths.push(cwd ? toCommandPath(item.normalizedPath, cwd) : item.workspacePath);
                break;
            default:
                summary.other += 1;
                break;
        }
    }

    summary.tracked = summary.totalPending - summary.private;
    return summary;
};

const formatPendingPathPreview = (pendingItems: PendingItem[], cwd: string, limit = 5): string =>
{
    if (pendingItems.length === 0)
    {
        return "(none)";
    }

    const preview = pendingItems
        .slice(0, limit)
        .map((item) => toCommandPath(item.normalizedPath, cwd));

    return pendingItems.length > limit ? `${preview.join(", ")}, ...` : preview.join(", ");
};

const SENSITIVE_PRIVATE_PATH_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
    { label: "dotenv", pattern: /(^|\/)\.env(\.|$)/i },
    { label: "private-key", pattern: /\.(pem|key|pfx|p12|jks|keystore|ppk)$/i },
    { label: "ssh-key", pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i },
    { label: "credentials-json", pattern: /(^|\/)(credentials|secrets?)\.json$/i },
    { label: "npmrc", pattern: /(^|\/)\.npmrc$/i },
];

const getSensitivePrivatePathReason = (pathValue: string): string | null =>
{
    const normalizedPath = pathValue.replace(/\\/g, "/");
    for (const definition of SENSITIVE_PRIVATE_PATH_PATTERNS)
    {
        if (definition.pattern.test(normalizedPath))
        {
            return `sensitive_path:${definition.label}`;
        }
    }

    return null;
};

const selectPrivatePathsForAutoAdd = (
    pendingItems: PendingItem[],
    scopedAbsolutePaths: string[],
    cwd: string,
): PrivateAutoAddSelection =>
{
    const privateItems = pendingItems.filter((item) => item.kind === "private");
    const scopedComparisonKeys = scopedAbsolutePaths.map((path) => toPathComparisonKeyFromAbsolutePath(path));
    const scopedItems = scopedAbsolutePaths.length > 0
        ? privateItems.filter((item) => scopedComparisonKeys.some((scopePath) => isWithinPathScope(item.comparisonKey, scopePath)))
        : privateItems;

    const blockedPaths: Array<{ path: string; reason: string }> = [];
    const candidatePaths: string[] = [];

    for (const item of scopedItems)
    {
        const commandPath = toCommandPath(item.normalizedPath, cwd);
        if (commandPath === ".")
        {
            continue;
        }

        const sensitiveReason = getSensitivePrivatePathReason(commandPath);
        if (sensitiveReason)
        {
            blockedPaths.push({
                path: commandPath,
                reason: sensitiveReason,
            });
            continue;
        }

        candidatePaths.push(commandPath);
    }

    return {
        candidatePaths: Array.from(new Set(candidatePaths)),
        blockedPaths,
    };
};

const filterPendingItemsByScope = (pendingItems: PendingItem[], scopedAbsolutePaths: string[]): PendingItem[] =>
{
    if (scopedAbsolutePaths.length === 0)
    {
        return pendingItems;
    }

    const scopedComparisonKeys = scopedAbsolutePaths.map((path) => toPathComparisonKeyFromAbsolutePath(path));
    return pendingItems.filter((item) => scopedComparisonKeys.some((scopePath) => isWithinPathScope(item.comparisonKey, scopePath)));
};

const resolveCheckinPaths = (requestedPaths: string[], pendingItems: PendingItem[], cwd: string): ResolvedCheckinPaths =>
{
    const includedAbsolutePaths: string[] = [];
    const fallbackAbsolutePaths: string[] = [];
    const excludedPaths: Array<{ path: string; reason: string }> = [];
    const matchedPendingItems = new Set<string>();
    let shouldApplyChanged = false;

    for (const requestedPath of requestedPaths)
    {
        const requestedAbsolutePath = toNormalizedAbsolutePath(requestedPath, cwd);
        const requestedComparisonKey = toPathComparisonKey(requestedPath, cwd);
        const matchedItems = pendingItems.filter((item) => isWithinPathScope(item.comparisonKey, requestedComparisonKey));

        if (matchedItems.length === 0)
        {
            excludedPaths.push({
                path: requestedPath,
                reason: "no_pending_changes",
            });
            continue;
        }

        for (const item of matchedItems)
        {
            matchedPendingItems.add(`${item.statusCode}:${item.comparisonKey}`);
        }

        const includesDeletedOrMoved = matchedItems.some((item) => item.kind === "deleted" || item.kind === "moved");
        let fallbackAbsolutePath = requestedAbsolutePath;
        if (includesDeletedOrMoved)
        {
            shouldApplyChanged = true;
            const hasChildMatches = matchedItems.some((item) => item.comparisonKey.length > requestedComparisonKey.length && item.comparisonKey.startsWith(`${requestedComparisonKey}/`));
            const hasDirectDirectoryMatch = matchedItems.some((item) => item.isDirectory && item.comparisonKey === requestedComparisonKey);
            fallbackAbsolutePath = hasChildMatches || hasDirectDirectoryMatch
                ? requestedAbsolutePath
                : toNormalizedAbsolutePath(dirname(requestedAbsolutePath), cwd);
        }

        includedAbsolutePaths.push(requestedAbsolutePath);
        fallbackAbsolutePaths.push(fallbackAbsolutePath);
    }

    const resolvedAbsolutePaths = dedupeAndMinimizeAbsolutePaths(includedAbsolutePaths);
    const resolvedFallbackAbsolutePaths = dedupeAndMinimizeAbsolutePaths(fallbackAbsolutePaths);
    const includedPaths = resolvedAbsolutePaths.map((path) => toCommandPath(path, cwd));
    const fallbackPaths = resolvedFallbackAbsolutePaths.map((path) => toCommandPath(path, cwd));
    const rewrittenPaths: string[] = [];

    return {
        requestedPaths,
        includedPaths,
        includedAbsolutePaths: resolvedAbsolutePaths,
        fallbackPaths,
        fallbackAbsolutePaths: resolvedFallbackAbsolutePaths,
        rewrittenPaths,
        excludedPaths,
        shouldApplyChanged,
        rewriteReason: shouldApplyChanged ? "Detected moved/deleted pending items; enabled --applychanged and will retry with parent-directory scope only if Plastic rejects the path-scoped command." : undefined,
        matchedPendingCount: matchedPendingItems.size,
    };
};

const shouldRetryCheckinWithFallbackScope = (errorMessage: string): boolean =>
{
    const normalized = errorMessage.toLowerCase();
    return normalized.includes("is not changed in current workspace")
        || normalized.includes("none of the provided checkin paths have pending changes")
        || normalized.includes("is not changed in current workspace.")
        || normalized.includes("none of the provided checkin paths");
};

const isNoChangesWorkspaceCheckinError = (errorMessage: string): boolean =>
{
    const normalized = errorMessage.toLowerCase();
    return normalized.includes("there are no changes in the workspace")
        || normalized.includes("no changes in the workspace");
};

const buildFallbackScopePaths = (absolutePaths: string[], cwd: string): string[] =>
{
    const fallbackAbsolutePaths = absolutePaths.map((path) => toNormalizedAbsolutePath(dirname(path), cwd));
    return dedupeAndMinimizeAbsolutePaths(fallbackAbsolutePaths).map((path) => toCommandPath(path, cwd));
};

const isRevisionNotFoundError = (message: string): boolean =>
{
    const normalized = message.toLowerCase();
    return normalized.includes("the specified revision was not found");
};

const isGlobalRevisionSpec = (revision: string): boolean =>
{
    const normalized = revision.toLowerCase();
    return normalized.startsWith("rev:")
        || normalized.startsWith("revid:")
        || normalized.startsWith("itemid:")
        || normalized.startsWith("serverpath:");
};

const isItemSelectorRevisionSpec = (revision: string): boolean =>
{
    const normalized = revision.toLowerCase();
    return /^\d+$/.test(revision)
        || normalized.startsWith("cs:")
        || normalized.startsWith("br:")
        || normalized.startsWith("lb:");
};

type DiffFileRevisionResolution = {
    supplied: string | null;
    kind: "workspace-base" | "changeset" | "branch" | "label" | "global-revision" | "file-qualified";
    resolved: string;
};

const resolveDiffFileRevision = (pathForRevision: string, revision?: string): DiffFileRevisionResolution =>
{
    const normalizedPath = pathForRevision.trim();
    const normalizedRevision = revision?.trim() ?? "";
    if (!normalizedPath)
    {
        throw new Error("path must identify a workspace file.");
    }

    // A bare item path is the unambiguous common case: cm cat resolves the
    // workspace's loaded/base revision without asking agents to guess a revspec.
    if (!normalizedRevision)
    {
        return { supplied: null, kind: "workspace-base", resolved: normalizedPath };
    }

    const lowerRevision = normalizedRevision.toLowerCase();
    if (lowerRevision === "base" || lowerRevision === "head" || lowerRevision === "cs:head" || /^cs:br:/i.test(normalizedRevision))
    {
        throw new Error(
            `Unsupported revision '${revision}'. Omit revision for the workspace base, or use a changeset number/cs:<number>, br:/<branch>, lb:<label>, a file-qualified '<path>#<selector>', or a global revid:/rev: spec.`,
        );
    }

    if (normalizedRevision.includes("#"))
    {
        return { supplied: normalizedRevision, kind: "file-qualified", resolved: normalizedRevision };
    }

    if (isGlobalRevisionSpec(normalizedRevision))
    {
        return { supplied: normalizedRevision, kind: "global-revision", resolved: normalizedRevision };
    }

    if (/^\d+$/.test(normalizedRevision) || /^cs:\d+$/i.test(normalizedRevision))
    {
        const selector = /^\d+$/.test(normalizedRevision) ? `cs:${normalizedRevision}` : normalizedRevision;
        return { supplied: normalizedRevision, kind: "changeset", resolved: `${normalizedPath}#${selector}` };
    }

    if (/^br:\/.+/i.test(normalizedRevision))
    {
        return { supplied: normalizedRevision, kind: "branch", resolved: `${normalizedPath}#${normalizedRevision}` };
    }

    if (/^lb:[^\s#]+/i.test(normalizedRevision))
    {
        return { supplied: normalizedRevision, kind: "label", resolved: `${normalizedPath}#${normalizedRevision}` };
    }

    throw new Error(
        `Unsupported revision '${revision}'. Omit revision for the workspace base, or use a changeset number/cs:<number>, br:/<branch>, lb:<label>, a file-qualified '<path>#<selector>', or a global revid:/rev: spec.`,
    );
};

// Kept as a small compatibility seam for older focused tests and consumers.
const normalizeDiffFileRevisionSpec = (pathForRevision: string, revision: string): string =>
    resolveDiffFileRevision(pathForRevision, revision).resolved;

const isValidGlobalRevisionSpec = (revision: string): boolean =>
    /^(?:rev|revid|itemid|serverpath):\S+$/i.test(revision.trim());

const isValidFileQualifiedRevisionSpec = (revision: string): boolean =>
{
    const normalized = revision.trim();
    const separator = normalized.lastIndexOf("#");
    if (separator <= 0 || separator === normalized.length - 1)
    {
        return false;
    }

    const selector = normalized.slice(separator + 1);
    return /^cs:\d+$/i.test(selector)
        || /^br:\/.+/i.test(selector)
        || /^lb:[^\s#]+$/i.test(selector)
        || isValidGlobalRevisionSpec(selector);
};

const isValidDiffRevisionSpec = (revision: string): boolean =>
    isValidGlobalRevisionSpec(revision) || isValidFileQualifiedRevisionSpec(revision);

const isUnscopedDiffRevisionSpec = (revision: string): boolean => !isValidDiffRevisionSpec(revision);

const extractBranchSelectorFromRevision = (revision: string): string | null =>
{
    const match = revision.match(/(?:^|#)(br:[^\s#]+)/i);
    if (!match)
    {
        return null;
    }

    const selector = (match[1] ?? "").trim();
    return selector.length > 0 ? selector : null;
};

const extractBranchNameFromSelector = (branchSelector: string): string | null =>
{
    const normalized = branchSelector.trim().replace(/^br:/i, "");
    if (!normalized)
    {
        return null;
    }

    const atIndex = normalized.indexOf("@");
    const branchName = atIndex >= 0 ? normalized.slice(0, atIndex).trim() : normalized.trim();
    return branchName.length > 0 ? branchName : null;
};

type SwitchPendingProfile = {
    hasPendingChanges: boolean;
    hasTrackedPendingChanges: boolean;
    hasPrivatePendingChanges: boolean;
    hasPrivateOnlyPendingChanges: boolean;
};

const toLegacyPendingSummary = (summary: PendingItemSummary): PendingSummary =>
{
    return {
        totalPending: summary.totalPending,
        added: summary.added,
        changed: summary.changed,
        moved: summary.moved,
        deleted: summary.deleted,
        other: summary.other + summary.private,
    };
};

const normalizeBranchSpecForComparison = (branch: string): string =>
{
    const trimmed = branch.trim();
    const withoutPrefix = trimmed.replace(/^br:/i, "");
    const withoutRepository = withoutPrefix.split("@")[0] ?? withoutPrefix;
    return withoutRepository.replace(/\\/g, "/");
};

const isSameBranchSpec = (left: string, right: string): boolean =>
{
    return normalizeBranchSpecForComparison(left) === normalizeBranchSpecForComparison(right);
};

const getBranchLeafName = (branch: string): string =>
{
    const normalized = normalizeBranchSpecForComparison(branch);
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    return segments.at(-1) ?? normalized;
};

const resolveBranchCreationTarget = (
    requestedBranch: string,
    parentBranch?: string,
    allowRootBranch = false,
): string =>
{
    const requested = requestedBranch.trim();
    const normalizedRequested = normalizeBranchSpecForComparison(requested);

    if (normalizedRequested.length === 0)
    {
        throw new Error("Branch must be non-empty.");
    }

    if (!normalizedRequested.startsWith("/"))
    {
        if (!parentBranch)
        {
            throw new Error("A relative branch name requires a parent branch.");
        }

        const normalizedParent = normalizeBranchSpecForComparison(parentBranch).replace(/\/$/, "");
        if (!normalizedParent.startsWith("/") || normalizedParent === "/")
        {
            throw new Error(`Parent branch must be a hierarchical branch path, received ${parentBranch}.`);
        }
        return `${normalizedParent}/${normalizedRequested}`;
    }

    const segments = normalizedRequested.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 1 && !allowRootBranch)
    {
        throw new Error(
            `Refusing to create top-level branch ${requested}. ` +
            "Create <parent-branch>/<new-branch>, pass parent with a relative branch name, " +
            "or set allowRootBranch=true when top-level branch creation is intentional.",
        );
    }

    return requested;
};

const buildSwitchPendingProfile = (summary: PendingItemSummary): SwitchPendingProfile =>
{
    return {
        hasPendingChanges: summary.totalPending > 0,
        hasTrackedPendingChanges: summary.tracked > 0,
        hasPrivatePendingChanges: summary.private > 0,
        hasPrivateOnlyPendingChanges: summary.private > 0 && summary.tracked === 0,
    };
};

const isSwitchBringBlockedForUnattended = (pendingChoice: "shelve" | "bring" | "cancel", profile: SwitchPendingProfile): boolean =>
{
    return pendingChoice === "bring" && profile.hasTrackedPendingChanges;
};

const canSwitchDirectWithPrivateOnlyPending = (
    pendingChoice: "shelve" | "bring" | "cancel",
    defaultedPolicy: boolean,
    profile: SwitchPendingProfile,
): boolean =>
{
    if (!profile.hasPrivateOnlyPendingChanges)
    {
        return false;
    }

    if (pendingChoice === "shelve" || pendingChoice === "bring")
    {
        return true;
    }

    return defaultedPolicy;
};

type PatchCommandArgs = {
    source: string;
    destination?: string;
    output?: string;
    toolPath?: string;
    clean?: boolean;
    integration?: boolean;
};

const assertRequiredPatchValue = (name: keyof PatchCommandArgs, value: string | undefined): void =>
{
    if (value === undefined || value.trim().length === 0)
    {
        throw new Error(`${name} must be non-empty.`);
    }
};

const assertNonBlankPatchValue = (name: keyof PatchCommandArgs, value: string | undefined): void =>
{
    if (value !== undefined && value.trim().length === 0)
    {
        throw new Error(`${name} must be non-empty when provided.`);
    }
};

const resolvePatchToolPath = (toolPath?: string): string =>
{
    if (toolPath?.trim())
    {
        return toolPath.trim();
    }

    // Keep cm patch on the same configurable portable diff executable used by
    // text-only file diffs. `diff` remains a PATH lookup on both platforms.
    return getDiffExecutable();
};

const buildPatchCommandArgs = (args: PatchCommandArgs): string[] =>
{
    assertRequiredPatchValue("source", args.source);
    assertNonBlankPatchValue("destination", args.destination);
    assertNonBlankPatchValue("output", args.output);
    assertNonBlankPatchValue("toolPath", args.toolPath);

    const cmdArgs: string[] = ["patch", args.source];

    if (args.destination)
    {
        cmdArgs.push(args.destination);
    }

    if (args.output)
    {
        cmdArgs.push(`--output=${args.output}`);
    }

    if (args.toolPath)
    {
        cmdArgs.push(`--tool=${args.toolPath}`);
    }

    if (args.clean)
    {
        cmdArgs.push("--clean");
    }

    if (args.integration)
    {
        cmdArgs.push("--integration");
    }

    return cmdArgs;
};

export const __plasticProcessInternals = {
    resolveCmExecutable: (environment: ExecutableEnvironment = process.env): string => resolveExecutable(environment, "PI_PLASTIC_CM_EXECUTABLE", "cm"),
    resolveDiffExecutable: (environment: ExecutableEnvironment = process.env): string => resolveExecutable(environment, "PI_PLASTIC_DIFF_EXECUTABLE", "diff"),
    spawnAndCollect,
    runCm,
    runCmRaw,
};

export const __plasticPatchInternals = {
    buildPatchCommandArgs,
    resolvePatchToolPath,
};

export const __plasticCheckinInternals = {
    // Optional policy injection makes path-case behavior deterministic in focused tests.
    toPathComparisonKeyFromAbsolutePath,
    isSameFilesystemDevice,
    inferPendingItemKind,
    parseMachineReadablePendingItems,
    summarizePendingItems,
    getSensitivePrivatePathReason,
    selectPrivatePathsForAutoAdd,
    filterPendingItemsByScope,
    resolveCheckinPaths,
    buildFallbackScopePaths,
    isNoChangesWorkspaceCheckinError,
    isRevisionNotFoundError,
    normalizeDiffFileRevisionSpec,
    resolveDiffFileRevision,
    isUnscopedDiffRevisionSpec,
    extractBranchSelectorFromRevision,
    extractBranchNameFromSelector,
};

export const __plasticSwitchInternals = {
    toLegacyPendingSummary,
    normalizeBranchSpecForComparison,
    isSameBranchSpec,
    buildSwitchPendingProfile,
    isSwitchBringBlockedForUnattended,
    canSwitchDirectWithPrivateOnlyPending,
};

export const __plasticBranchInternals = {
    getBranchLeafName,
    parsePlasticStatusBranch,
    resolveBranchCreationTarget,
};

// Capture enough subprocess output for diagnostics while keeping the default
// agent-facing response intentionally small. Callers may opt into a larger
// focused response, but never the full capture bound.
const DIFF_OUTPUT_MAX_CHARS = 60_000;
const DIFF_RESPONSE_DEFAULT_MAX_CHARS = 8_000;
const DIFF_RESPONSE_MAX_CHARS = 20_000;
const DIFF_RESPONSE_MIN_CHARS = 500;
const DIFF_RESPONSE_TOTAL_MAX_CHARS = 24_000;

type TextDiffResult = {
    backend: "diff";
    changed: boolean;
    binary: boolean;
    output: string;
    truncated: boolean;
    totalChars: number;
};

// Do not classify serialized Unity YAML by its extension or importer metadata:
// valid UTF-8 YAML is text, while NUL-containing or invalid UTF-8 bytes are binary.
const isBinaryContent = (content: Buffer): boolean => content.includes(0) || !isUtf8(content);

const stableDiffHeaders = (output: string, leftLabel: string, rightLabel: string): string =>
{
    const lines = output.split(/\r?\n/);
    // Both GNU and BSD `diff -u` put the source paths in the first two header
    // lines. Replacing only those lines keeps hunk content verbatim while never
    // leaking package-owned temporary paths or host-specific timestamps.
    if (lines[0]?.startsWith("--- "))
    {
        lines[0] = `--- ${leftLabel}`;
    }
    if (lines[1]?.startsWith("+++ "))
    {
        lines[1] = `+++ ${rightLabel}`;
    }
    return lines.join("\n").replace(/\n+$/, "");
};

const boundDiffOutput = (output: string): Pick<TextDiffResult, "output" | "truncated" | "totalChars"> =>
{
    const totalChars = output.length;
    if (totalChars <= DIFF_OUTPUT_MAX_CHARS)
    {
        return { output, truncated: false, totalChars };
    }

    return {
        output: `${output.slice(0, DIFF_OUTPUT_MAX_CHARS)}\n\n[Diff output truncated at ${DIFF_OUTPUT_MAX_CHARS} characters; inspect a narrower file or use a review patch for the complete change.]`,
        truncated: true,
        totalChars,
    };
};

const runPortableTextDiff = async (
    leftPath: string,
    rightPath: string,
    cwd: string,
    leftLabel: string,
    rightLabel: string,
): Promise<TextDiffResult> =>
{
    const [leftContent, rightContent] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
    if (isBinaryContent(leftContent) || isBinaryContent(rightContent))
    {
        return { backend: "diff", changed: !leftContent.equals(rightContent), binary: true, output: "", truncated: false, totalChars: 0 };
    }

    const { stdout, stderr, exitCode, aborted, stdoutTruncated, stdoutTotalChars } = await spawnAndCollect(
        getDiffExecutable(),
        ["-u", leftPath, rightPath],
        cwd,
        undefined,
        getActiveAbortSignal(),
        { ...commandExecutionStorage.getStore(), outputLimitChars: DIFF_OUTPUT_MAX_CHARS },
    );
    if (aborted)
    {
        throw new Error("Text diff was aborted.");
    }
    if (exitCode > 1)
    {
        const diagnostic = [stdout, stderr].filter(Boolean).join("\n").trim();
        const sanitized = diagnostic
            .split(leftPath).join(leftLabel)
            .split(rightPath).join(rightLabel);
        throw new Error(sanitized || `Text diff failed with exit code ${exitCode}.`);
    }

    const normalized = stableDiffHeaders(stdout, leftLabel, rightLabel);
    const bounded = stdoutTruncated
        ? {
            output: `${normalized}\n\n[Diff output truncated at ${DIFF_OUTPUT_MAX_CHARS} characters; inspect a narrower file or generate a review patch for the complete change.]`,
            truncated: true,
            totalChars: stdoutTotalChars ?? normalized.length,
        }
        : boundDiffOutput(normalized);
    return { backend: "diff", changed: exitCode === 1, binary: false, ...bounded };
};

const safeTempExtension = (pathValue: string): string =>
{
    const extension = extname(pathValue);
    return /^\.[A-Za-z0-9]{1,12}$/.test(extension) ? extension : ".tmp";
};

const materializeRevision = async (revision: string, destination: string, workdir?: string): Promise<void> =>
{
    // --file keeps historical bytes out of the decoded stdout path. This is
    // required for both reliable binary detection and Unity YAML text handling.
    try
    {
        await runCm(["cat", revision, `--file=${destination}`], workdir);
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.split(destination).join("<package-owned-temp-file>"));
    }
    const destinationStat = await fs.stat(destination).catch(() => null);
    if (!destinationStat?.isFile())
    {
        throw new Error("Plastic did not materialize the requested historical file content.");
    }
};

const normalizeDiffResponseMaxChars = (value: unknown): number =>
{
    if (typeof value !== "number" || !Number.isFinite(value))
    {
        return DIFF_RESPONSE_DEFAULT_MAX_CHARS;
    }
    return Math.min(DIFF_RESPONSE_MAX_CHARS, Math.max(DIFF_RESPONSE_MIN_CHARS, Math.trunc(value)));
};

const formatTextDiff = async (
    action: "diffFile" | "diffRevisions",
    format: OutputFormat | undefined,
    comparisonKind: string,
    unboundedResult: TextDiffResult,
    workdir: string | undefined,
    comparisonMetadata: Record<string, unknown> = {},
    maxChars?: number,
): Promise<string> =>
{
    const result = boundTextDiffResult(unboundedResult, normalizeDiffResponseMaxChars(maxChars));
    const status = result.binary ? (result.changed ? "binary-different" : "unchanged") : (result.changed ? "changed" : "unchanged");
    const text = result.binary
        ? (result.changed ? "Binary content differs; a text diff is unavailable." : "No differences.")
        : (result.changed ? result.output : "No differences.");
    const data = {
        comparisonKind,
        ...comparisonMetadata,
        backend: result.backend,
        status,
        changed: result.changed,
        binary: result.binary,
        truncated: result.truncated,
        totalChars: result.totalChars,
        diff: result.changed && !result.binary ? result.output : undefined,
    };
    const warnings = result.truncated ? ["Diff output was truncated; use a narrower file or generate a review patch for the complete result."] : undefined;
    if (format === "json")
    {
        return toBoundedDiffStructuredResult(action, data, workdir, warnings);
    }
    return text;
};

const isNoDataError = (message: string): boolean =>
{
    const normalized = message.toLowerCase();
    return normalized.includes("--nodata")
        || normalized.includes("no data available")
        || normalized.includes("data is not available")
        || normalized.includes("cannot retrieve data")
        || normalized.includes("could not retrieve data");
};

const withWorkspaceBaseUnavailableDiagnostic = (path: string, error: unknown): Error =>
{
    const message = error instanceof Error ? error.message : String(error);
    if (!isNoDataError(message))
    {
        return error instanceof Error ? error : new Error(message);
    }

    return new Error(
        `Plastic cannot supply historical/base bytes for '${path}' because this workspace/status record is --nodata. `
        + "A workspace diff cannot be calculated without those bytes. Run plastic_status(machineReadable=true, includeRevId=true) to verify the item, then update/refresh the workspace or use plastic_diffRevisions with two known file-qualified revisions when historical content is available.",
    );
};

const boundTextDiffResult = (result: TextDiffResult, maxChars: number): TextDiffResult =>
{
    if (!result.output || result.output.length <= maxChars)
    {
        return result;
    }

    const suffix = `\n\n[Diff output truncated at the requested ${maxChars}-character response bound.]`;
    return {
        ...result,
        output: suffix.length >= maxChars ? suffix.slice(0, maxChars) : `${result.output.slice(0, maxChars - suffix.length)}${suffix}`,
        truncated: true,
        totalChars: result.totalChars,
    };
};

export const __plasticDiffInternals = {
    DIFF_OUTPUT_MAX_CHARS,
    DIFF_RESPONSE_DEFAULT_MAX_CHARS,
    DIFF_RESPONSE_MAX_CHARS,
    DIFF_RESPONSE_MIN_CHARS,
    DIFF_RESPONSE_TOTAL_MAX_CHARS,
    normalizeDiffResponseMaxChars,
    isBinaryContent,
    stableDiffHeaders,
    boundDiffOutput,
    runPortableTextDiff,
    safeTempExtension,
    materializeRevision,
    isNoDataError,
    withWorkspaceBaseUnavailableDiagnostic,
    boundTextDiffResult,
    resolveDiffFileRevision,
    isUnscopedDiffRevisionSpec,
};

const workdirArg = tool.schema.string().optional().describe("Working directory for the workspace.");

const escapeCmWhereValue = (value: string): string => value.replace(/\\/g, "\\\\").replace(/'/g, "''");
const cmWhereEquals = (field: string, value: string): string => `${field} = '${escapeCmWhereValue(value)}'`;
const cmWhereLike = (field: string, value: string): string => `${field} like '${escapeCmWhereValue(value)}'`;
const normalizeFindOutputLines = (output: string): string[] => output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "(no output)");

const listRecentBranchNames = async (workdir?: string, limit = 200): Promise<string[]> =>
{
    const output = await runCmRaw([
        "find",
        "branch",
        `order by date desc limit ${limit}`,
        "--format={name}",
        "--nototal",
    ], workdir);
    return normalizeFindOutputLines(output);
};

const buildRevisionNotFoundGuidance = async (resolvedRevision: string, path: string, workdir?: string): Promise<string | null> =>
{
    const branchSelector = extractBranchSelectorFromRevision(resolvedRevision);
    if (!branchSelector)
    {
        return null;
    }

    const branchName = extractBranchNameFromSelector(branchSelector);
    if (!branchName)
    {
        return null;
    }

    try
    {
        const recentBranchNames = await listRecentBranchNames(workdir, 300);
        const exactMatchExists = recentBranchNames.includes(branchName);
        if (exactMatchExists)
        {
            return `Branch '${branchName}' exists, but '${path}' was not found at '${branchSelector}'. The file likely does not exist on that branch. Use a branch or changeset where the file exists, following the current repository's branch and changeset conventions.`;
        }

        const childMatches = recentBranchNames
            .filter((name) => name.startsWith(`${branchName}/`))
            .slice(0, 5);
        if (childMatches.length > 0)
        {
            const suggestions = childMatches.map((name) => `br:${name}`).join(", ");
            return `Branch '${branchName}' was not found. Did you mean one of: ${suggestions}?`;
        }

        return `Branch '${branchName}' was not found in the recent branch list. Use 'cm find branch "order by date desc limit 200" --format="{name}" --nototal' to discover valid branch specs.`;
    }
    catch
    {
        return `Revision '${branchSelector}' could not be resolved for '${path}'. Use a concrete file-qualified revision such as '<workspace-path>#<revision-spec>'.`;
    }
};

const TOOL_VERSION = "v2.0.0";
type OutputFormat = "text" | "json";
const outputFormatArg = tool.schema.enum(["text", "json"]).optional().describe("Output format. Defaults to text.");

let cachedCmVersion: string | null = null;
let cmVersionPromise: Promise<string> | null = null;

const getCmVersion = async (workdir?: string): Promise<string> =>
{
    if (cachedCmVersion)
    {
        return cachedCmVersion;
    }

    if (!cmVersionPromise)
    {
        cmVersionPromise = runCmRaw(["version"], workdir)
            .then((value) =>
            {
                const parsed = normalizeFindOutputLines(value)[0] ?? "unknown";
                cachedCmVersion = parsed;
                cmVersionPromise = null;
                return parsed;
            })
            .catch(() =>
            {
                cmVersionPromise = null;
                return "unknown";
            });
    }

    return cmVersionPromise;
};

type PendingSummary = {
    totalPending: number;
    added: number;
    changed: number;
    moved: number;
    deleted: number;
    other: number;
};

type MergeStatusSummary = {
    hasPendingMergeLinks: boolean;
    pendingMergeLinks: string[];
    mergeInProgressHints: string[];
    hasMergeInProgress: boolean;
};

const summarizeShortStatus = (output: string): PendingSummary =>
{
    const lines = normalizeFindOutputLines(output);
    const summary: PendingSummary = {
        totalPending: lines.length,
        added: 0,
        changed: 0,
        moved: 0,
        deleted: 0,
        other: 0,
    };

    for (const line of lines)
    {
        const normalized = line.toLowerCase();
        if (normalized.includes("added") || /^a\s/.test(normalized))
        {
            summary.added += 1;
            continue;
        }

        if (normalized.includes("changed") || normalized.includes("modified") || /^c\s/.test(normalized) || /^m\s/.test(normalized))
        {
            summary.changed += 1;
            continue;
        }

        if (normalized.includes("moved") || normalized.includes("renamed"))
        {
            summary.moved += 1;
            continue;
        }

        if (normalized.includes("deleted") || /^d\s/.test(normalized))
        {
            summary.deleted += 1;
            continue;
        }

        summary.other += 1;
    }

    return summary;
};

const analyzeMergeStatusOutput = (output: string): MergeStatusSummary =>
{
    const lines = normalizeFindOutputLines(output);
    const pendingMergeLinks: string[] = [];
    const mergeInProgressHints: string[] = [];
    let inPendingMergeLinksSection = false;

    for (const line of lines)
    {
        const trimmed = line.trim();
        const normalized = trimmed.toLowerCase();

        if (normalized === "pending merge links")
        {
            inPendingMergeLinksSection = true;
            continue;
        }

        if (inPendingMergeLinksSection)
        {
            if (trimmed.length === 0)
            {
                continue;
            }

            if (/^(changed|added|deleted|moved|private|controlled changes|items changed|local changes)\b/i.test(trimmed))
            {
                inPendingMergeLinksSection = false;
            }
            else if (/^merge\s+from\b/i.test(trimmed))
            {
                pendingMergeLinks.push(trimmed);
                continue;
            }
        }

        if (/merge\s+in\s+progress|finish\s+it\s+before\s+checkin|unresolved\s+merge|pending\s+conflicts/i.test(trimmed))
        {
            mergeInProgressHints.push(trimmed);
        }
    }

    return {
        hasPendingMergeLinks: pendingMergeLinks.length > 0,
        pendingMergeLinks,
        mergeInProgressHints,
        hasMergeInProgress: mergeInProgressHints.length > 0,
    };
};

const formatPreflightText = (title: string, lines: string[]): string =>
{
    return [title, "", ...lines].join("\n");
};

const toStructuredResult = async (
    action: string,
    format: OutputFormat,
    text: string,
    data: Record<string, unknown>,
    workdir?: string,
    warnings?: string[],
    nextSuggestedAction?: string,
): Promise<string> =>
{
    if (format !== "json")
    {
        return text;
    }

    const payload: Record<string, unknown> = {
        ok: true,
        action,
        toolVersion: TOOL_VERSION,
        cliVersion: await getCmVersion(workdir),
        data,
    };

    if (warnings && warnings.length > 0)
    {
        payload.warnings = warnings;
    }

    if (nextSuggestedAction)
    {
        payload.nextSuggestedAction = nextSuggestedAction;
    }

    return `## ${action}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
};

const toBoundedDiffStructuredResult = async (
    action: "diffFile" | "diffRevisions",
    data: Record<string, unknown>,
    workdir?: string,
    warnings?: string[],
): Promise<string> =>
{
    const wrap = (payload: Record<string, unknown>): string => `## ${action}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    const basePayload = {
        ok: true,
        action,
        toolVersion: TOOL_VERSION,
        cliVersion: (await getCmVersion(workdir)).slice(0, 256),
    };
    const initial = wrap({ ...basePayload, data, ...(warnings?.length ? { warnings } : {}) });
    if (initial.length <= DIFF_RESPONSE_TOTAL_MAX_CHARS)
    {
        return initial;
    }

    const originalDiff = typeof data.diff === "string" ? data.diff : "";
    const responseWarning = `Diff content was further truncated after JSON escaping to keep the complete response within ${DIFF_RESPONSE_TOTAL_MAX_CHARS} characters.`;
    const boundedWarnings = [...(warnings ?? []), responseWarning];
    const suffix = `\n\n[Diff output truncated to keep the complete JSON response within ${DIFF_RESPONSE_TOTAL_MAX_CHARS} characters.]`;
    const render = (prefixChars: number): string => wrap({
        ...basePayload,
        data: {
            ...data,
            truncated: true,
            diff: `${originalDiff.slice(0, prefixChars)}${suffix}`,
        },
        warnings: boundedWarnings,
    });

    let low = 0;
    let high = originalDiff.length;
    let best = render(0);
    while (low <= high)
    {
        const middle = Math.floor((low + high) / 2);
        const candidate = render(middle);
        if (candidate.length <= DIFF_RESPONSE_TOTAL_MAX_CHARS)
        {
            best = candidate;
            low = middle + 1;
        }
        else
        {
            high = middle - 1;
        }
    }
    return best;
};

type MergeConflictStrategy = "auto" | "source" | "destination";

type MergeMachineReadableRecord = {
    raw: string;
    fields: string[];
    operation: string;
};

type MergeOutputSummary = {
    recordCount: number;
    conflictSignals: string[];
    unresolvedSignals: string[];
    warningSignals: string[];
    fileConflictSignals: string[];
    fileConflictPaths: string[];
};

const MERGE_START_LINE_SEPARATOR = "__OC_MR_START__";
const MERGE_END_LINE_SEPARATOR = "__OC_MR_END__";
const MERGE_FIELD_SEPARATOR = "__OC_MR_FIELD__";

const mergeConflictSignalPattern = /\b(conflict|eviltwin|changedelete|deletechange|movedelete|deletemove|loadedtwice|addmove|moveadd|divergentmove|cyclemove|movedeviltwin)\b/i;
const mergeUnresolvedSignalPattern = /\b(unresolved|cannot\s+resolve|can't\s+resolve|manual\s+conflict|not\s+solved|failed\s+to\s+resolve)\b/i;
const mergeWarningSignalPattern = /\bwarn(?:ing)?\b/i;
const mergeFileConflictOperation = "FILE_CONFLICT";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeErrorMessage = (error: unknown): string =>
{
    if (error instanceof Error)
    {
        return error.message;
    }

    return String(error ?? "Unknown error");
};

const parseMergeMachineReadableRecords = (output: string): MergeMachineReadableRecord[] =>
{
    const pattern = new RegExp(`${escapeRegex(MERGE_START_LINE_SEPARATOR)}([\\s\\S]*?)${escapeRegex(MERGE_END_LINE_SEPARATOR)}`, "g");
    const records: MergeMachineReadableRecord[] = [];

    for (const match of output.matchAll(pattern))
    {
        const raw = String(match[1] ?? "").trim();
        if (!raw)
        {
            continue;
        }

        const fields = raw
            .split(MERGE_FIELD_SEPARATOR)
            .map((field) => field.trim())
            .filter((field) => field.length > 0);
        const operation = fields[0] ?? "";
        records.push({
            raw,
            fields,
            operation,
        });
    }

    return records;
};

const summarizeMergeOutput = (output: string): MergeOutputSummary =>
{
    const records = parseMergeMachineReadableRecords(output);
    const textLines = normalizeFindOutputLines(output);
    const conflictSignals = new Set<string>();
    const unresolvedSignals = new Set<string>();
    const warningSignals = new Set<string>();
    const fileConflictSignals = new Set<string>();
    const fileConflictPaths = new Set<string>();

    for (const record of records)
    {
        const mergedText = record.fields.join(" ");
        const isFileConflict = record.operation.toUpperCase() === mergeFileConflictOperation;

        if (isFileConflict)
        {
            conflictSignals.add(record.raw);
            unresolvedSignals.add(record.raw);
            fileConflictSignals.add(record.raw);
            if (record.fields[1])
            {
                fileConflictPaths.add(record.fields[1]);
            }
        }
        else if (mergeConflictSignalPattern.test(mergedText))
        {
            conflictSignals.add(record.raw);
        }

        if (mergeUnresolvedSignalPattern.test(mergedText))
        {
            unresolvedSignals.add(record.raw);
        }

        if (record.operation.toUpperCase().includes("WARN") || mergeWarningSignalPattern.test(mergedText))
        {
            warningSignals.add(record.raw);
        }
    }

    for (const line of textLines)
    {
        if (/\bFILE_CONFLICT\b/i.test(line))
        {
            conflictSignals.add(line);
            unresolvedSignals.add(line);
            fileConflictSignals.add(line);
        }
        else if (mergeConflictSignalPattern.test(line))
        {
            conflictSignals.add(line);
        }

        if (mergeUnresolvedSignalPattern.test(line))
        {
            unresolvedSignals.add(line);
        }

        if (/DIS_OP_WARN|\bwarn(?:ing)?\b/i.test(line))
        {
            warningSignals.add(line);
        }
    }

    return {
        recordCount: records.length,
        conflictSignals: Array.from(conflictSignals),
        unresolvedSignals: Array.from(unresolvedSignals),
        warningSignals: Array.from(warningSignals),
        fileConflictSignals: Array.from(fileConflictSignals),
        fileConflictPaths: Array.from(fileConflictPaths),
    };
};

const buildMergeAbortMessage = (
    source: string,
    strategy: MergeConflictStrategy,
    output: string,
    summary: MergeOutputSummary,
): string =>
{
    const lines: string[] = [
        "Merge requires resolution/finalization before checkin.",
        `Source: ${source}`,
        `Strategy: ${strategy}`,
        `Conflict signals: ${summary.conflictSignals.length}`,
        `File conflicts: ${summary.fileConflictPaths.length}`,
        `Unresolved signals: ${summary.unresolvedSignals.length}`,
    ];

    if (summary.fileConflictPaths.length > 0)
    {
        lines.push("File conflict paths:");
        for (const conflictPath of summary.fileConflictPaths.slice(0, 20))
        {
            lines.push(`- ${conflictPath}`);
        }
    }

    if (summary.conflictSignals.length > 0)
    {
        lines.push("Conflict details:");
        for (const signal of summary.conflictSignals.slice(0, 20))
        {
            lines.push(`- ${signal}`);
        }
    }

    if (summary.unresolvedSignals.length > 0)
    {
        lines.push("Unresolved details:");
        for (const signal of summary.unresolvedSignals.slice(0, 20))
        {
            lines.push(`- ${signal}`);
        }
    }

    if (output.trim().length > 0)
    {
        lines.push("Raw merge output:");
        lines.push(output.trim());
    }

    lines.push("Review and resolve the listed files, run validation, then run plastic_finalizeMerge(source=..., strategy=destination) or rerun plastic_merge(...) with an explicit source/destination strategy when that policy is intentional.");
    return lines.join("\n");
};

const isMergeInProgressCheckinError = (message: string): boolean =>
{
    return /checkin operation cannot be started because there is a merge in progress|finish it before checkin|in progress merge/i.test(message);
};

const buildMergeInProgressCheckinMessage = async (originalMessage: string, workdir?: string): Promise<string> =>
{
    const statusOutput = await runCmRaw(["status"], workdir).catch(() => "");
    const mergeState = analyzeMergeStatusOutput(statusOutput);
    const lines: string[] = [
        "Checkin blocked: Plastic still has a merge in progress.",
        originalMessage.trim(),
    ];

    if (mergeState.pendingMergeLinks.length > 0)
    {
        lines.push("", "Pending merge links:");
        for (const link of mergeState.pendingMergeLinks.slice(0, 10))
        {
            lines.push(`- ${link}`);
        }
    }

    lines.push(
        "",
        "Next steps:",
        "- If files still need manual work, resolve and validate them first.",
        "- If files are already resolved and validated, run plastic_finalizeMerge(source=<original source>, strategy=destination) to finalize Plastic merge metadata, then retry plastic_checkin.",
        "- Use strategy=source/destination only when that conflict policy is intentional.",
    );

    return lines.join("\n");
};

const resolveBranchParentName = async (branch: string, workdir?: string): Promise<string | undefined> =>
{
    const normalizedBranch = normalizeBranchSpecForComparison(branch);
    const candidates = Array.from(new Set([branch.trim(), normalizedBranch, `br:${normalizedBranch}`]
        .filter((candidate) => candidate.length > 0)));

    for (const candidate of candidates)
    {
        const output = await runCmRaw([
            "find",
            "branch",
            `where ${cmWhereEquals("name", candidate)}`,
            "--format={parent}",
            "--nototal",
        ], workdir).catch(() => "");
        const lines = normalizeFindOutputLines(output);
        const parent = lines[0]?.trim();
        if (parent)
        {
            return parent;
        }
    }

    return undefined;
};

const resolveCurrentBranchName = async (workdir?: string): Promise<string> =>
{
    const statusOutput = await runCmRaw(["status"], workdir);
    const statusBranch = parsePlasticStatusBranch(statusOutput);
    if (statusBranch.kind === "found" && statusBranch.value.branch)
    {
        return statusBranch.value.branch;
    }

    const compactOutput = await runCmRaw(["status", "--compact"], workdir);
    const compactBranch = parsePlasticStatusBranch(compactOutput);
    if (compactBranch.kind === "found" && compactBranch.value.branch)
    {
        return compactBranch.value.branch;
    }

    if (compactBranch.kind === "found" && compactBranch.value.changesetId)
    {
        const changesetBranchOutput = await runCmRaw([
            "find",
            "changeset",
            `where changesetid=${compactBranch.value.changesetId}`,
            "--format={branch}",
            "--nototal",
        ], workdir);
        const branchLines = normalizeFindOutputLines(changesetBranchOutput);
        if (branchLines.length > 0)
        {
            return branchLines[0];
        }
    }

    const trimmed = compactOutput.trim();
    if (trimmed.length === 0)
    {
        throw new Error("Unable to determine current branch from empty status output.");
    }

    throw new Error(`Unable to parse current branch from status output: ${trimmed}`);
};

export const status = tool({
    description: "Show Plastic SCM workspace status (cm status).",
    args: {
        workdir: workdirArg,
        includeRevId: tool.schema.boolean().optional().describe("Include revision IDs in the status output when supported."),
        machineReadable: tool.schema.boolean().optional().describe("Return machine-readable status output when supported."),
        short: tool.schema.boolean().optional().describe("Use short status output."),
        format: outputFormatArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const cmdArgs: string[] = ["status"];

        if (args.short)
        {
            cmdArgs.push("--short");
        }

        if (args.includeRevId)
        {
            cmdArgs.push("--includeRevId");
        }

        if (args.machineReadable)
        {
            cmdArgs.push("--machinereadable");
            const machineOutput = await runCmRaw(cmdArgs, args.workdir);
            return toStructuredResult(
                "status",
                format,
                machineOutput,
                {
                    rawOutput: machineOutput,
                    machineReadable: true,
                },
                args.workdir,
            );
        }

        const output = await runCm(cmdArgs, args.workdir);
        const shortOutput = await runCmRaw(["status", "--short"], args.workdir);
        const summary = summarizeShortStatus(shortOutput);
        const mergeState = analyzeMergeStatusOutput(output);
        const textOutput = mergeState.hasMergeInProgress || mergeState.hasPendingMergeLinks
            ? [
                output,
                "",
                "## Merge State",
                `- Pending merge links: ${mergeState.pendingMergeLinks.length}`,
                `- Merge-in-progress hints: ${mergeState.mergeInProgressHints.length}`,
                ...(mergeState.hasMergeInProgress ? ["- Checkin may be blocked until merge metadata is finalized. If files are resolved, run plastic_finalizeMerge(...)."] : []),
            ].join("\n")
            : output;

        return toStructuredResult(
            "status",
            format,
            textOutput,
            {
                rawOutput: output,
                shortOutput,
                summary,
                mergeState,
                usedShortFlag: args.short ?? false,
            },
            args.workdir,
        );
    },
});

export const update = tool({
    description: "Update workspace safely without launching interactive merge (cm update --dontmerge --noinput).",
    args: {
        workdir: workdirArg,
    },
    async execute(args)
    {
        return runCm(["update", "--dontmerge", "--noinput"], args.workdir);
    },
});

export const add = tool({
    description: "Add items to Plastic SCM (cm add).",
    args: {
        paths: tool.schema.array(tool.schema.string()).min(1).describe("Paths to add."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        return runCm(["add", ...args.paths], args.workdir);
    },
});

export const checkin = tool({
    description: "Check in pending changes with a required comment (cm checkin -c=...).",
    args: {
        message: tool.schema.string().min(1).describe("Changeset comment."),
        paths: tool.schema.array(tool.schema.string()).optional().describe("Optional paths to check in."),
        applyChanged: tool.schema.boolean().optional().describe("Include changed items not checked out."),
        includePrivate: tool.schema.boolean().optional().describe("Include private items."),
        includeAll: tool.schema.boolean().optional().describe("Include changed, moved, and deleted items."),
        updateAfter: tool.schema.boolean().optional().describe("Deprecated in unattended mode. Blocked because checkin --update can trigger interactive update-merge."),
        preflight: tool.schema.boolean().optional().describe("Preview command and included paths without executing checkin."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const preflight = args.preflight ?? false;

        if (args.updateAfter)
        {
            const message = "updateAfter is disabled for unattended safety because checkin --update can trigger interactive update-merge flows. Run plastic_update() first, then plastic_merge(...) with an explicit conflict strategy.";
            if (preflight)
            {
                return toStructuredResult(
                    "checkin-preflight",
                    format,
                    formatPreflightText("## Checkin Preflight", [
                        "- Would run: no",
                        `- Reason: ${message}`,
                    ]),
                    {
                        wouldRun: false,
                        blockedOption: "updateAfter",
                        errorCode: "UNATTENDED_UPDATE_AFTER_BLOCKED",
                    },
                    args.workdir,
                    [message],
                    "Run plastic_update() and then plastic_merge(...) using the default strategy (auto), or set strategy=source|destination only when you need an explicit override.",
                );
            }

            throw new Error(message);
        }

        const cwd = args.workdir ?? process.cwd();
        const prePendingItems = await getMachineReadablePendingItems(args.workdir);
        const prePendingSummary = summarizePendingItems(prePendingItems, cwd);
        let requestedPaths: string[] = args.paths ?? [];
        let includedPaths: string[] = [];
        let includedAbsolutePaths: string[] = [];
        let fallbackPaths: string[] = [];
        let rewrittenPaths: string[] = [];
        let rewriteReason: string | undefined;
        let matchedPendingCount = args.paths && args.paths.length > 0 ? 0 : prePendingSummary.totalPending;
        let autoEnabledApplyChanged = false;
        let usedFallbackRetry = false;
        let usedNoChangesRecovery = false;
        let usedPrivateAutoAddRecovery = false;
        const autoAddedPrivatePaths: string[] = [];
        const blockedPrivateAutoAddPaths: Array<{ path: string; reason: string }> = [];
        const decisionSteps: string[] = ["initial-checkin"];
        const excludedPaths: Array<{ path: string; reason: string }> = [];
        let useApplyChanged = args.applyChanged ?? false;
        let pendingItemsInScope: PendingItem[] = prePendingItems;
        let pendingSummaryInScope: PendingItemSummary = prePendingSummary;

        const buildCommandArgs = (paths: string[], forceApplyChanged: boolean): string[] =>
        {
            const cmdArgs: string[] = ["checkin", `-c=${args.message}`];

            if (args.includeAll)
            {
                cmdArgs.push("--all");
            }

            if (forceApplyChanged)
            {
                cmdArgs.push("--applychanged");
            }

            if (args.includePrivate)
            {
                cmdArgs.push("--private");
            }

            if (args.updateAfter)
            {
                cmdArgs.push("--update");
            }

            if (paths.length > 0)
            {
                cmdArgs.push(...paths);
            }

            return cmdArgs;
        };

        if (args.paths && args.paths.length > 0)
        {
            const pathResolution = resolveCheckinPaths(args.paths, prePendingItems, cwd);
            requestedPaths = pathResolution.requestedPaths;
            includedPaths = pathResolution.includedPaths;
            includedAbsolutePaths = pathResolution.includedAbsolutePaths;
            fallbackPaths = pathResolution.fallbackPaths;
            rewrittenPaths = pathResolution.rewrittenPaths;
            rewriteReason = pathResolution.rewriteReason;
            matchedPendingCount = pathResolution.matchedPendingCount;
            excludedPaths.push(...pathResolution.excludedPaths);
            autoEnabledApplyChanged = pathResolution.shouldApplyChanged && !useApplyChanged;
            useApplyChanged = useApplyChanged || pathResolution.shouldApplyChanged;
            pendingItemsInScope = filterPendingItemsByScope(prePendingItems, includedAbsolutePaths);
            pendingSummaryInScope = summarizePendingItems(pendingItemsInScope, cwd);

            if (includedPaths.length === 0)
            {
                const pendingPreview = formatPendingPathPreview(prePendingItems, cwd);
                const message = "None of the provided checkin paths have pending changes. "
                    + `Workdir: ${cwd}. `
                    + `Pending sample: ${pendingPreview}. `
                    + "Run plastic_status(machineReadable=true) or plastic_checkin(preflight=true, ...) to verify path scope before checkin.";
                const commandPreview = buildCommandArgs(includedPaths, useApplyChanged);
                if (preflight)
                {
                    return toStructuredResult(
                        "checkin-preflight",
                        format,
                        formatPreflightText("## Checkin Preflight", [
                            "- Would run: no",
                            `- Reason: ${message}`,
                            `- Excluded paths: ${excludedPaths.length}`,
                        ]),
                        {
                            wouldRun: false,
                            command: ["cm", ...commandPreview],
                            requestedPaths,
                            includedPaths,
                            fallbackPaths,
                            excludedPaths,
                            rewrittenPaths,
                            rewriteReason,
                            matchedPendingCount,
                            errorCode: "NO_PENDING_PATHS",
                        },
                        args.workdir,
                        [message],
                    );
                }

                throw new Error(message);
            }
        }

        const cmdArgs = buildCommandArgs(includedPaths, useApplyChanged);

        if (preflight)
        {
            const text = formatPreflightText("## Checkin Preflight", [
                "- Would run: yes",
                `- Command: cm ${cmdArgs.join(" ")}`,
                `- Requested paths: ${requestedPaths.length > 0 ? requestedPaths.join(", ") : "(none)"}`,
                `- Included paths: ${includedPaths.length > 0 ? includedPaths.join(", ") : "(all pending)"}`,
                `- Pending summary (scope): total=${pendingSummaryInScope.totalPending}, tracked=${pendingSummaryInScope.tracked}, private=${pendingSummaryInScope.private}`,
                `- Private handling: ${args.includePrivate ? "include via --private" : "excluded unless added"}`,
                `- Rewritten paths: ${rewrittenPaths.length > 0 ? rewrittenPaths.join(", ") : "(none)"}`,
                `- Auto-enabled --applychanged: ${autoEnabledApplyChanged ? "yes" : "no"}`,
                `- Matched pending entries: ${matchedPendingCount}`,
                `- Excluded paths: ${excludedPaths.length}`,
                `- Rewrite reason: ${rewriteReason ?? "(none)"}`,
            ]);

            return toStructuredResult(
                "checkin-preflight",
                format,
                text,
                {
                    wouldRun: true,
                    command: ["cm", ...cmdArgs],
                    requestedPaths,
                    includedPaths,
                    fallbackPaths,
                    rewrittenPaths,
                    excludedPaths,
                    rewriteReason,
                    autoEnabledApplyChanged,
                    matchedPendingCount,
                    prePendingSummary,
                    pendingSummaryInScope,
                },
                args.workdir,
            );
        }

        let output = "";
        let executedCommandArgs = cmdArgs;
        const attemptPathScopeFallbackRetry = async (errorMessage: string): Promise<boolean> =>
        {
            if (!args.paths || args.paths.length === 0 || !shouldRetryCheckinWithFallbackScope(errorMessage))
            {
                return false;
            }

            const resolvedFallbackPaths = fallbackPaths.length > 0 ? fallbackPaths : buildFallbackScopePaths(includedAbsolutePaths, cwd);
            const fallbackCommandArgs = buildCommandArgs(resolvedFallbackPaths, true);
            if (resolvedFallbackPaths.length === 0 || fallbackCommandArgs.join("\0") === cmdArgs.join("\0"))
            {
                return false;
            }

            output = await runCm(fallbackCommandArgs, args.workdir);
            executedCommandArgs = fallbackCommandArgs;
            usedFallbackRetry = true;
            includedPaths = resolvedFallbackPaths;
            fallbackPaths = resolvedFallbackPaths;
            rewrittenPaths = resolvedFallbackPaths;
            rewriteReason = "Automatic retry used parent-directory scope with --applychanged after Plastic rejected path-scoped checkin.";
            useApplyChanged = true;
            decisionSteps.push("path-scope-fallback-retry");
            return true;
        };

        try
        {
            output = await runCm(cmdArgs, args.workdir);
        }
        catch (error)
        {
            let currentError: unknown = error;
            let currentErrorMessage = normalizeErrorMessage(currentError);

            if (isMergeInProgressCheckinError(currentErrorMessage))
            {
                throw new Error(await buildMergeInProgressCheckinMessage(currentErrorMessage, args.workdir));
            }

            if (isNoChangesWorkspaceCheckinError(currentErrorMessage)
                && !args.includePrivate
                && pendingSummaryInScope.private > 0
                && pendingSummaryInScope.tracked === 0
                && (Boolean(args.includeAll) || requestedPaths.length > 0))
            {
                const scopedAutoAddSelection = selectPrivatePathsForAutoAdd(
                    pendingItemsInScope,
                    includedAbsolutePaths,
                    cwd,
                );
                blockedPrivateAutoAddPaths.push(...scopedAutoAddSelection.blockedPaths);

                if (scopedAutoAddSelection.candidatePaths.length > 0)
                {
                    await runCm(["add", ...scopedAutoAddSelection.candidatePaths], args.workdir);
                    autoAddedPrivatePaths.push(...scopedAutoAddSelection.candidatePaths);
                    usedPrivateAutoAddRecovery = true;
                    decisionSteps.push("auto-add-private");

                    try
                    {
                        output = await runCm(cmdArgs, args.workdir);
                        currentError = null;
                        currentErrorMessage = "";
                        decisionSteps.push("auto-add-private-retry-success");
                    }
                    catch (retryError)
                    {
                        currentError = retryError;
                        currentErrorMessage = normalizeErrorMessage(currentError);
                    }
                }
                else if (scopedAutoAddSelection.blockedPaths.length > 0)
                {
                    const blockedPreview = scopedAutoAddSelection.blockedPaths
                        .slice(0, 8)
                        .map((item) => `${item.path} (${item.reason})`)
                        .join(", ");
                    throw new Error(
                        `Checkin blocked: only private items were pending and all candidates matched sensitive filters: ${blockedPreview}. `
                        + "Run plastic_add(paths=[...]) with explicit safe paths, or use includePrivate=true only when intentional.",
                    );
                }
            }

            if (currentError
                && isNoChangesWorkspaceCheckinError(currentErrorMessage)
                && !args.includePrivate
                && pendingSummaryInScope.private > 0
                && pendingSummaryInScope.tracked === 0
                && !Boolean(args.includeAll)
                && requestedPaths.length === 0)
            {
                throw new Error(
                    "Checkin found only private pending items. includeAll/includePrivate were not set, so nothing was eligible for checkin. "
                    + "Run plastic_add(paths=[...]) for expected files or rerun with includePrivate=true only when intentional.",
                );
            }

            if (currentError && isNoChangesWorkspaceCheckinError(currentErrorMessage) && pendingSummaryInScope.tracked > 0)
            {
                const postPendingItems = await getMachineReadablePendingItems(args.workdir).catch(() => []);
                const postPendingSummaryForRecovery = summarizePendingItems(postPendingItems, cwd);
                if (postPendingSummaryForRecovery.totalPending === 0)
                {
                    output = "Checkin completed with clean-workspace recovery: Plastic reported 'no changes in the workspace', but no pending changes remain after the attempt.";
                    currentError = null;
                    currentErrorMessage = "";
                    usedNoChangesRecovery = true;
                    decisionSteps.push("clean-workspace-no-changes-recovery");
                }
            }

            if (currentError)
            {
                const fallbackHandled = await attemptPathScopeFallbackRetry(currentErrorMessage);
                if (!fallbackHandled)
                {
                    throw currentError;
                }
            }
        }

        const postPendingItems = await getMachineReadablePendingItems(args.workdir).catch(() => []);
        const postPendingSummary = summarizePendingItems(postPendingItems, cwd);

        return toStructuredResult(
            "checkin",
            format,
            output,
            {
                command: ["cm", ...executedCommandArgs],
                initialCommand: ["cm", ...cmdArgs],
                requestedPaths,
                includedPaths,
                fallbackPaths,
                rewrittenPaths,
                excludedPaths,
                rewriteReason,
                autoEnabledApplyChanged,
                usedFallbackRetry,
                usedNoChangesRecovery,
                usedPrivateAutoAddRecovery,
                applyChanged: useApplyChanged,
                matchedPendingCount,
                prePendingSummary,
                pendingSummaryInScope,
                postPendingSummary,
                autoAddedPrivatePaths,
                blockedPrivateAutoAddPaths,
                decisionPath: decisionSteps.join(" -> "),
                rawOutput: output,
            },
            args.workdir,
            [
                ...(excludedPaths.length > 0 ? ["Some requested paths were excluded because they had no pending changes."] : []),
                ...(autoEnabledApplyChanged ? ["Enabled --applychanged automatically because requested scope included moved/deleted pending items."] : []),
                ...(usedFallbackRetry ? ["Retried checkin automatically with parent-directory scope after Plastic rejected the original path-scoped request."] : []),
                ...(usedPrivateAutoAddRecovery ? [`Auto-added ${autoAddedPrivatePaths.length} private pending item(s) before retrying checkin.`] : []),
                ...(blockedPrivateAutoAddPaths.length > 0 ? [`Skipped ${blockedPrivateAutoAddPaths.length} private pending item(s) from auto-add due to sensitive-path filters.`] : []),
                ...(usedNoChangesRecovery ? ["Recovered from Plastic no-changes error because workspace was clean after the checkin attempt."] : []),
            ],
        );
    },
});

export const undo = tool({
    description: "Undo changes for specified items (cm undo).",
    args: {
        paths: tool.schema.array(tool.schema.string()).min(1).describe("Paths to undo."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        return runCm(["undo", ...args.paths], args.workdir);
    },
});

export const resolveDeleteChangeConflict = tool({
    description: "Resolve a Plastic SCM delete/change conflict by accepting the source-side deletion with cm remove.",
    args: {
        paths: tool.schema.array(tool.schema.string()).min(1).describe("Controlled workspace paths to resolve by accepting the source-side deletion."),
        keepOnDisk: tool.schema.boolean().optional().describe("Keep removed items on disk as private files via --nodisk. Defaults to true."),
        preflight: tool.schema.boolean().optional().describe("Preview the resolution command without executing it."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const keepOnDisk = args.keepOnDisk ?? true;
        const preflight = args.preflight ?? false;
        const cmdArgs = ["remove", ...(keepOnDisk ? ["--nodisk"] : []), ...args.paths];

        if (preflight)
        {
            return toStructuredResult(
                "resolve-delete-change-conflict-preflight",
                format,
                formatPreflightText("## Delete/Change Conflict Resolution Preflight", [
                    "- Would run: yes",
                    "- Resolution: accept source-side deletion",
                    `- Keep removed items on disk: ${keepOnDisk ? "yes (--nodisk)" : "no"}`,
                    `- Command: cm ${cmdArgs.join(" ")}`,
                ]),
                {
                    wouldRun: true,
                    resolution: "accept-source-deletion",
                    keepOnDisk,
                    command: ["cm", ...cmdArgs],
                    paths: args.paths,
                },
                args.workdir,
            );
        }

        const output = await runCm(cmdArgs, args.workdir);
        const shortStatusAfterResolution = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const pendingSummaryAfterResolution = summarizeShortStatus(shortStatusAfterResolution);
        const reportLines = [
            "## Delete/Change Conflict Resolution Result",
            "",
            "- Resolution: accepted source-side deletion",
            `- Keep removed items on disk: ${keepOnDisk ? "yes (--nodisk)" : "no"}`,
            `- Paths resolved: ${args.paths.length}`,
            `- Pending items after resolution: ${pendingSummaryAfterResolution.totalPending}`,
        ];

        if (output.trim().length > 0 && output.trim() !== "(no output)")
        {
            reportLines.push("", "Raw command output:", output.trim());
        }

        return toStructuredResult(
            "resolve-delete-change-conflict",
            format,
            reportLines.join("\n"),
            {
                resolution: "accept-source-deletion",
                keepOnDisk,
                command: ["cm", ...cmdArgs],
                paths: args.paths,
                shortStatusAfterResolution,
                pendingSummaryAfterResolution,
                rawOutput: output,
            },
            args.workdir,
            keepOnDisk ? ["Removed items were kept on disk as private files via --nodisk."] : undefined,
            "Rerun plastic_merge(...) for the original source branch to continue the merge.",
        );
    },
});

export const diff = tool({
    description: "Disabled alias for cm diff; use text-only alternatives.",
    args: {
        source: tool.schema.string().min(1).describe("Source changeset/label/shelveset/branch spec (cs:, lb:, sh:, br:, or a numeric changeset)."),
        destination: tool.schema.string().optional().describe("Optional destination changeset/label/shelveset/branch spec."),
        added: tool.schema.boolean().optional().describe("Show only added items."),
        changed: tool.schema.boolean().optional().describe("Show only changed items."),
        moved: tool.schema.boolean().optional().describe("Show only moved items."),
        deleted: tool.schema.boolean().optional().describe("Show only deleted items."),
        repositoryPaths: tool.schema.boolean().optional().describe("Print repository paths instead of workspace paths."),
        format: tool.schema.string().optional().describe("Format string for CLI output."),
        dateFormat: tool.schema.string().optional().describe("Date format for output dates."),
        comparisonMethod: tool.schema.enum([
            "ignoreeol",
            "ignorewhitespaces",
            "ignoreeolandwhitespaces",
            "recognizeall",
        ]).optional().describe("Comparison method used for diff calculations."),
        clean: tool.schema.boolean().optional().describe("Exclude changes produced by merges."),
        integration: tool.schema.boolean().optional().describe("Show pending integration differences."),
        fullPaths: tool.schema.boolean().optional().describe("Force full workspace paths when possible."),
        workdir: workdirArg,
    },
    async execute(_args)
    {
        throw new Error(`plastic_diff is disabled. ${BLOCKED_CM_DIFF_MESSAGE}`);
    },
});

export const patch = tool({
    description: "Generate a Plastic SCM patch with the configured portable diff backend and optional clean/integration filtering (cm patch).",
    args: {
        source: tool.schema.string().min(1).describe("Source changeset or branch spec, for example a changeset spec or branch spec selected from the current workspace."),
        destination: tool.schema.string().optional().describe("Optional second changeset or branch spec for two-spec patch generation."),
        output: tool.schema.string().optional().describe("Optional output file path. If omitted, patch content is printed to stdout."),
        toolPath: tool.schema.string().optional().describe("Optional path to the diff executable used by cm patch. Defaults to PI_PLASTIC_DIFF_EXECUTABLE or diff on PATH."),
        clean: tool.schema.boolean().optional().describe("Exclude content that arrived via merges and include only direct checkins."),
        integration: tool.schema.boolean().optional().describe("Show branch changes pending integration into the parent branch."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cwd = args.workdir ?? process.cwd();
        const tempDir = args.output ? null : await fs.mkdtemp(join(tmpdir(), "plastic-patch-"));
        const requestedOutput = args.output ?? join(tempDir!, "review.patch");
        const resolvedOutput = isAbsolute(requestedOutput) ? requestedOutput : resolve(cwd, requestedOutput);

        try
        {
            const cmdArgs = buildPatchCommandArgs({ ...args, output: requestedOutput, toolPath: resolvePatchToolPath(args.toolPath) });
            const commandOutput = await runCm(cmdArgs, args.workdir);
            const patchStat = await fs.stat(resolvedOutput).catch(() => null);
            if (!patchStat?.isFile())
            {
                throw new Error(`Plastic reported patch generation success but did not create '${requestedOutput}'.`);
            }

            const patchBytes = await fs.readFile(resolvedOutput);
            const isText = isUtf8(patchBytes);
            const patchText = isText ? patchBytes.toString("utf8") : "";
            const bounded = boundDiffOutput(patchText);
            const binaryLimited = /Binary files? .* differ|cannot diff|binary (?:content|file) (?:is )?not supported/i.test(`${patchText}\n${commandOutput}`);
            const metadata = {
                status: patchBytes.length === 0 ? "empty" : (binaryLimited ? "generated-with-binary-warning" : "generated"),
                output: args.output ? requestedOutput : null,
                bytes: patchBytes.length,
                empty: patchBytes.length === 0,
                binaryLimited: !isText || binaryLimited,
                truncated: !args.output && bounded.truncated,
                content: args.output ? null : bounded.output,
            };
            return JSON.stringify(metadata, null, 2);
        }
        finally
        {
            if (tempDir)
            {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        }
    },
});

export const diffRevisions = tool({
    description: "Show a bounded text-only diff between two file-qualified Plastic revisions using portable diff -u; binary content is reported explicitly.",
    args: {
        leftRevision: tool.schema.string().min(1).describe("Left file-qualified Plastic revision spec for cm cat."),
        rightRevision: tool.schema.string().min(1).describe("Right file-qualified Plastic revision spec for cm cat."),
        maxChars: tool.schema.number().int().min(DIFF_RESPONSE_MIN_CHARS).max(DIFF_RESPONSE_MAX_CHARS).optional().describe(`Maximum diff-body characters returned (default ${DIFF_RESPONSE_DEFAULT_MAX_CHARS}, maximum ${DIFF_RESPONSE_MAX_CHARS}).`),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        if (isUnscopedDiffRevisionSpec(args.leftRevision) || isUnscopedDiffRevisionSpec(args.rightRevision))
        {
            throw new Error("plastic_diffRevisions requires file-qualified revspecs. For workspace-vs-revision comparisons, use plastic_diffFile(path=..., revision=...).");
        }

        const cwd = args.workdir ?? process.cwd();
        const leftLabel = args.leftRevision.includes("#") ? args.leftRevision.replace("#", "@") : args.leftRevision;
        const rightLabel = args.rightRevision.includes("#") ? args.rightRevision.replace("#", "@") : args.rightRevision;
        const tempDir = await fs.mkdtemp(join(tmpdir(), "plastic-core-"));
        const leftPath = join(tempDir, `left${safeTempExtension(args.leftRevision)}`);
        const rightPath = join(tempDir, `right${safeTempExtension(args.rightRevision)}`);

        try
        {
            await materializeRevision(args.leftRevision, leftPath, args.workdir);
            await materializeRevision(args.rightRevision, rightPath, args.workdir);
            const result = await runPortableTextDiff(leftPath, rightPath, cwd, leftLabel, rightLabel);
            return formatTextDiff("diffRevisions", args.format, "revision-to-revision", result, args.workdir, {}, args.maxChars);
        }
        finally
        {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    },
});

type WorkspacePendingDiff = {
    item?: PendingItem;
    workspacePath: string;
    displayPath: string;
    revisionPath: string;
    pendingKind: "added" | "changed" | "moved" | "deleted" | "private" | "other";
    result: TextDiffResult;
    comparisonKind: string;
};

const diffPendingWorkspaceFile = async (
    args: { path: string; workdir?: string },
    pendingItem?: PendingItem,
): Promise<WorkspacePendingDiff> =>
{
    const cwd = args.workdir ?? process.cwd();
    const workspacePath = toNormalizedAbsolutePath(args.path, cwd);
    const pendingKind = pendingItem?.kind ?? "changed";
    const isAdded = pendingKind === "added";
    const isPrivate = pendingKind === "private";
    const isDeleted = pendingKind === "deleted";
    const workspaceStat = await fs.stat(workspacePath).catch(() => null);
    if (!workspaceStat?.isFile() && !isDeleted)
    {
        throw new Error(`Workspace file '${args.path}' does not exist or is not a regular file. Use plastic_status to confirm its pending status.`);
    }

    const displayPath = isAbsolute(args.path) ? toCommandPath(workspacePath, cwd) : args.path;
    const revisionPath = displayPath.length > 0 ? displayPath : args.path;
    const workspaceBase = resolveDiffFileRevision(revisionPath);
    const leftLabel = isAdded
        ? `${revisionPath} (empty before add)`
        : isPrivate
            ? `${revisionPath} (empty before private/new file)`
            : workspaceBase.resolved.includes("#") ? workspaceBase.resolved.replace("#", "@") : `${revisionPath} (Plastic base)`;
    const rightLabel = isDeleted ? `${displayPath} (empty after delete)` : `${displayPath} (workspace)`;
    const materializeSpec = pendingItem?.revisionId ? `revid:${pendingItem.revisionId}` : workspaceBase.resolved;
    if (isDeleted && !pendingItem?.revisionId)
    {
        throw new Error(`Plastic status identified '${args.path}' as deleted but did not provide its base revision ID.`);
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), "plastic-core-"));
    const basePath = join(tempDir, `base${safeTempExtension(workspacePath)}`);
    const emptyWorkspacePath = join(tempDir, `workspace${safeTempExtension(workspacePath)}`);
    try
    {
        if (isAdded || isPrivate)
        {
            await fs.writeFile(basePath, "");
        }
        else
        {
            try
            {
                // Status revision IDs preserve the exact pre-change materialization for
                // changed, moved, and deleted records. Explicit revision requests use a
                // separate path below and never consult workspace status.
                await materializeRevision(materializeSpec, basePath, args.workdir);
            }
            catch (error)
            {
                throw withWorkspaceBaseUnavailableDiagnostic(args.path, error);
            }
        }

        if (isDeleted)
        {
            await fs.writeFile(emptyWorkspacePath, "");
        }
        const result = await runPortableTextDiff(basePath, isDeleted ? emptyWorkspacePath : workspacePath, cwd, leftLabel, rightLabel);
        return {
            item: pendingItem,
            workspacePath,
            displayPath,
            revisionPath,
            pendingKind,
            result,
            comparisonKind: isPrivate ? "workspace-private-new" : (isAdded ? "workspace-added" : (isDeleted ? "workspace-deleted" : `workspace-${pendingKind}`)),
        };
    }
    finally
    {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
};

export const diffFile = tool({
    description: "Show a bounded text-only diff between a workspace file and its Plastic base (or a supported revision). Omit revision for the common workspace-base comparison.",
    args: {
        path: tool.schema.string().min(1).describe("Workspace file path to diff."),
        revision: tool.schema.string().optional().describe("Optional revision: changeset number/cs:<number>, br:/<branch>, lb:<label>, file-qualified '<path>#<selector>', or global revid:/rev:. Omit for the workspace base."),
        maxChars: tool.schema.number().int().min(DIFF_RESPONSE_MIN_CHARS).max(DIFF_RESPONSE_MAX_CHARS).optional().describe(`Maximum diff-body characters returned (default ${DIFF_RESPONSE_DEFAULT_MAX_CHARS}, maximum ${DIFF_RESPONSE_MAX_CHARS}).`),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        // Explicit revision behavior intentionally bypasses workspace status. It is
        // a request for the supplied historical selector, not a pending-item diff.
        if (args.revision)
        {
            const cwd = args.workdir ?? process.cwd();
            const workspacePath = toNormalizedAbsolutePath(args.path, cwd);
            const workspaceStat = await fs.stat(workspacePath).catch(() => null);
            if (!workspaceStat?.isFile())
            {
                throw new Error(`Workspace file '${args.path}' does not exist or is not a regular file.`);
            }
            const displayPath = isAbsolute(args.path) ? toCommandPath(workspacePath, cwd) : args.path;
            const revision = resolveDiffFileRevision(displayPath || args.path, args.revision);
            const tempDir = await fs.mkdtemp(join(tmpdir(), "plastic-core-"));
            const basePath = join(tempDir, `base${safeTempExtension(workspacePath)}`);
            try
            {
                try
                {
                    await materializeRevision(revision.resolved, basePath, args.workdir);
                }
                catch (error)
                {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (isRevisionNotFoundError(errorMessage))
                    {
                        const guidance = await buildRevisionNotFoundGuidance(revision.resolved, displayPath || args.path, args.workdir);
                        if (guidance)
                        {
                            throw new Error(`${errorMessage}\n\n${guidance}`);
                        }
                    }
                    throw error;
                }
                const result = await runPortableTextDiff(basePath, workspacePath, cwd, revision.resolved.replace("#", "@"), `${displayPath} (workspace)`);
                return formatTextDiff("diffFile", args.format, revision.kind, result, args.workdir, { pendingKind: null, isNew: false }, args.maxChars);
            }
            finally
            {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        }

        const cwd = args.workdir ?? process.cwd();
        const workspacePath = toNormalizedAbsolutePath(args.path, cwd);
        const pendingItems = await getMachineReadablePendingItems(args.workdir);
        const pendingItem = pendingItems.find((item) => item.comparisonKey === toPathComparisonKeyFromAbsolutePath(workspacePath));
        const compared = await diffPendingWorkspaceFile(args, pendingItem);
        return formatTextDiff(
            "diffFile",
            args.format,
            compared.comparisonKind,
            compared.result,
            args.workdir,
            { pendingKind: compared.pendingKind, isNew: compared.pendingKind === "private" || compared.pendingKind === "added", statusRevisionId: pendingItem?.revisionId },
            args.maxChars,
        );
    },
});

const WORKSPACE_DIFF_DEFAULT_MAX_FILES = 3;
const WORKSPACE_DIFF_MAX_FILES = 20;
const WORKSPACE_DIFF_MAX_PATHS = 20;
const WORKSPACE_DIFF_PATH_MAX_CHARS = 1_024;
const WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS = 256;
const WORKSPACE_DIFF_ERROR_MAX_CHARS = 1_024;
const WORKSPACE_DIFF_DEFAULT_MAX_CHARS = 3_000;
const WORKSPACE_DIFF_PER_FILE_MAX_CHARS = 8_000;
const WORKSPACE_DIFF_MIN_CHARS = 500;
// This is a response bound, not just a diff-body bound. Reserve space for
// framing and an omission summary so both text and JSON remain useful.
const WORKSPACE_DIFF_TOTAL_MAX_CHARS = 20_000;
const WORKSPACE_DIFF_CONTENT_MAX_CHARS = 16_000;

const boundWorkspaceValue = (value: string, maxChars: number): string =>
{
    if (maxChars <= 0)
    {
        return "";
    }
    if (value.length <= maxChars)
    {
        return value;
    }
    const suffix = `… [truncated; original ${value.length} characters]`;
    return suffix.length >= maxChars ? value.slice(0, maxChars) : `${value.slice(0, maxChars - suffix.length)}${suffix}`;
};

const boundWorkspaceDiffResult = (result: TextDiffResult, maxChars: number): TextDiffResult =>
{
    if (result.output.length <= maxChars)
    {
        return result;
    }
    return { ...result, output: boundWorkspaceValue(result.output, maxChars), truncated: true };
};

const workspacePathPreview = (paths: string[]): string[] => paths.map((path) => boundWorkspaceValue(path, WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS));

const appendBoundedWorkspaceText = (prefix: string, sections: string[], omitted: number): string =>
{
    const omission = (count: number): string => `\n\n[${count} file outcome(s) omitted to keep this response within ${WORKSPACE_DIFF_TOTAL_MAX_CHARS} characters.]`;
    let text = prefix;
    let omittedCount = omitted;
    for (let index = 0; index < sections.length; index += 1)
    {
        const candidate = `${text}\n\n${sections[index]}`;
        if (candidate.length + omission(omittedCount + sections.length - index - 1).length > WORKSPACE_DIFF_TOTAL_MAX_CHARS)
        {
            omittedCount += sections.length - index;
            break;
        }
        text = candidate;
    }
    return omittedCount > 0 ? `${text}${omission(omittedCount)}` : text;
};

const formatWorkspaceDiffResult = async (
    format: OutputFormat,
    textPrefix: string,
    textSections: string[],
    data: Record<string, unknown>,
    warnings: string[],
    outcomes: Array<Record<string, unknown>>,
    preOmittedOutcomes: number,
    workdir?: string,
): Promise<string> =>
{
    if (format !== "json")
    {
        return appendBoundedWorkspaceText(textPrefix, textSections, preOmittedOutcomes);
    }

    const cliVersion = boundWorkspaceValue(await getCmVersion(workdir), WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS);
    const wrap = (payload: Record<string, unknown>): string => `## workspaceDiff\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    const retained: Array<Record<string, unknown>> = [];
    let omittedOutcomes = preOmittedOutcomes;
    const payloadFor = (): Record<string, unknown> => ({
        ok: true,
        action: "workspaceDiff",
        toolVersion: TOOL_VERSION,
        cliVersion,
        data: { ...data, outcomes: retained, omittedOutcomes },
        ...(warnings.length > 0 ? { warnings } : {}),
    });

    for (let index = 0; index < outcomes.length; index += 1)
    {
        retained.push(outcomes[index]);
        const remainingCount = outcomes.length - index - 1;
        // Keep an omission field in the serialized payload before deciding to
        // retain another result; JSON escaping can otherwise exceed the bound.
        omittedOutcomes = preOmittedOutcomes + remainingCount;
        if (wrap(payloadFor()).length > WORKSPACE_DIFF_TOTAL_MAX_CHARS)
        {
            retained.pop();
            omittedOutcomes = preOmittedOutcomes + outcomes.length - index;
            break;
        }
    }
    return wrap(payloadFor());
};

export const workspaceDiff = tool({
    description: "Review explicitly selected pending workspace file diffs, or opt into a small bounded whole-workspace review with allPending=true. Use plastic_status when only changed paths are needed.",
    args: {
        paths: tool.schema.array(tool.schema.string().min(1).max(WORKSPACE_DIFF_PATH_MAX_CHARS)).max(WORKSPACE_DIFF_MAX_PATHS).optional().describe(`Pending workspace paths to review (maximum ${WORKSPACE_DIFF_MAX_PATHS}, ${WORKSPACE_DIFF_PATH_MAX_CHARS} characters each). Selecting paths includes matching private files.`),
        allPending: tool.schema.boolean().optional().describe("Explicitly review pending non-private files when paths are omitted. Defaults to false; required for an unscoped workspace diff."),
        includePrivate: tool.schema.boolean().optional().describe("Include private pending files with allPending=true. Selected private paths do not require this flag."),
        maxFiles: tool.schema.number().int().min(1).max(WORKSPACE_DIFF_MAX_FILES).optional().describe(`Maximum files to compare for allPending review (default ${WORKSPACE_DIFF_DEFAULT_MAX_FILES}, maximum ${WORKSPACE_DIFF_MAX_FILES}); selected paths are all considered unless this is set.`),
        maxChars: tool.schema.number().int().min(WORKSPACE_DIFF_MIN_CHARS).max(WORKSPACE_DIFF_PER_FILE_MAX_CHARS).optional().describe(`Maximum diff-body characters returned per file (default ${WORKSPACE_DIFF_DEFAULT_MAX_CHARS}, maximum ${WORKSPACE_DIFF_PER_FILE_MAX_CHARS}).`),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cwd = args.workdir ?? process.cwd();
        // Runtime guards also cover direct execute() callers that bypass schema validation.
        if (args.paths !== undefined && !Array.isArray(args.paths))
        {
            throw new Error("paths must be an array of non-blank workspace paths.");
        }
        if (args.allPending !== undefined && typeof args.allPending !== "boolean")
        {
            throw new Error("allPending must be a boolean; whole-workspace review requires allPending=true explicitly.");
        }
        if (args.includePrivate !== undefined && typeof args.includePrivate !== "boolean")
        {
            throw new Error("includePrivate must be a boolean and only applies with allPending=true.");
        }
        const rawPaths = Array.isArray(args.paths) ? args.paths : [];
        if (rawPaths.some((path) => typeof path !== "string" || path.trim().length === 0))
        {
            throw new Error("paths must contain only non-blank workspace paths.");
        }
        const selectedPaths = rawPaths.length > 0
            ? rawPaths.slice(0, WORKSPACE_DIFF_MAX_PATHS).map((path) => boundWorkspaceValue(path, WORKSPACE_DIFF_PATH_MAX_CHARS))
            : undefined;
        const allPending = args.allPending === true;
        const includePrivate = args.includePrivate === true;
        const workspaceRoot = toNormalizedAbsolutePath(".", cwd);
        if (selectedPaths?.some((path) => toPathComparisonKeyFromAbsolutePath(toNormalizedAbsolutePath(path, cwd)) === toPathComparisonKeyFromAbsolutePath(workspaceRoot)))
        {
            throw new Error("A workspace-root path is a whole-workspace review; use allPending=true instead of selecting the workspace root.");
        }
        if (selectedPaths && allPending)
        {
            throw new Error("Choose either explicit paths or allPending=true, not both.");
        }
        if (!selectedPaths && !allPending)
        {
            throw new Error("plastic_workspaceDiff requires explicit paths or allPending=true. Use plastic_status when only pending paths are needed.");
        }
        if (selectedPaths && includePrivate)
        {
            throw new Error("includePrivate is only used with allPending=true; explicitly selected private paths are already included.");
        }
        const ignoredPathInputs = Math.max(0, rawPaths.length - (selectedPaths?.length ?? 0));
        const pendingItems = await getMachineReadablePendingItems(args.workdir); // exactly one status command per batch
        const selectedScopes = selectedPaths?.map((path) => toNormalizedAbsolutePath(path, cwd)) ?? [];
        let candidates = selectedPaths ? filterPendingItemsByScope(pendingItems, selectedScopes) : pendingItems.filter((item) => item.kind !== "private");
        if (!selectedPaths && includePrivate)
        {
            candidates = pendingItems;
        }
        const defaultMaxFiles = selectedPaths ? selectedPaths.length : WORKSPACE_DIFF_DEFAULT_MAX_FILES;
        const requestedMaxFiles = typeof args.maxFiles === "number" && Number.isFinite(args.maxFiles) ? Math.trunc(args.maxFiles) : defaultMaxFiles;
        const maxFiles = Math.min(WORKSPACE_DIFF_MAX_FILES, Math.max(1, requestedMaxFiles));
        const requestedMaxChars = typeof args.maxChars === "number" && Number.isFinite(args.maxChars) ? Math.trunc(args.maxChars) : WORKSPACE_DIFF_DEFAULT_MAX_CHARS;
        const maxChars = Math.min(WORKSPACE_DIFF_PER_FILE_MAX_CHARS, Math.max(WORKSPACE_DIFF_MIN_CHARS, requestedMaxChars));
        const skippedByLimit = Math.max(0, candidates.length - maxFiles);
        candidates = candidates.slice(0, maxFiles);

        const outcomes: Array<Record<string, unknown>> = [];
        const textSections: string[] = [];
        let totalOutputChars = 0;
        let unprocessedCandidates = 0;
        for (let index = 0; index < candidates.length; index += 1)
        {
            if (totalOutputChars >= WORKSPACE_DIFF_CONTENT_MAX_CHARS)
            {
                unprocessedCandidates = candidates.length - index;
                break;
            }
            const item = candidates[index];
            const path = toCommandPath(item.normalizedPath, cwd);
            const displayPath = boundWorkspaceValue(path, WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS);
            if (item.isDirectory)
            {
                outcomes.push({ path: displayPath, kind: item.kind, status: "skipped-directory" });
                textSections.push(`### ${displayPath} (${item.kind})\nDirectory entries are not diffed.`);
                totalOutputChars += textSections[textSections.length - 1].length;
                continue;
            }
            try
            {
                const compared = await diffPendingWorkspaceFile({ path, workdir: args.workdir }, item);
                const remaining = Math.max(0, WORKSPACE_DIFF_CONTENT_MAX_CHARS - totalOutputChars);
                const perFile = boundWorkspaceDiffResult(compared.result, maxChars);
                const bounded = boundWorkspaceDiffResult(perFile, remaining);
                const status = bounded.binary ? (bounded.changed ? "binary-different" : "unchanged") : (bounded.changed ? "changed" : "unchanged");
                const diffOutput = bounded.changed && !bounded.binary ? bounded.output : undefined;
                outcomes.push({ path: displayPath, kind: item.kind, status, changed: bounded.changed, binary: bounded.binary, truncated: bounded.truncated, totalChars: bounded.totalChars, ...(diffOutput ? { diff: diffOutput } : {}) });
                const body = bounded.binary ? (bounded.changed ? "Binary content differs; a text diff is unavailable." : "No differences.") : (bounded.changed ? bounded.output : "No differences.");
                const section = `### ${displayPath} (${item.kind})\n${body}`;
                textSections.push(section);
                totalOutputChars += section.length;
            }
            catch (error)
            {
                const message = boundWorkspaceValue(error instanceof Error ? error.message : String(error), WORKSPACE_DIFF_ERROR_MAX_CHARS);
                outcomes.push({ path: displayPath, kind: item.kind, status: "unavailable", error: message });
                const section = `### ${displayPath} (${item.kind})\nUnavailable: ${message}`;
                textSections.push(section);
                totalOutputChars += section.length;
            }
        }

        const unmatchedPaths = selectedPaths?.filter((path) => !filterPendingItemsByScope(pendingItems, [toNormalizedAbsolutePath(path, cwd)]).length) ?? [];
        const unmatchedPreviews = workspacePathPreview(unmatchedPaths);
        const warnings = [
            ...(skippedByLimit > 0 ? [`Skipped ${skippedByLimit} pending item(s) after the maxFiles bound of ${maxFiles}.`] : []),
            ...(unmatchedPreviews.length > 0 ? [`${unmatchedPreviews.length} selected path(s) had no pending status record: ${unmatchedPreviews.slice(0, 5).join(", ")}${unmatchedPreviews.length > 5 ? `; ${unmatchedPreviews.length - 5} more omitted` : ""}.`] : []),
            ...(ignoredPathInputs > 0 ? [`Ignored ${ignoredPathInputs} path input(s) after the ${WORKSPACE_DIFF_MAX_PATHS}-path bound.`] : []),
            ...(!selectedPaths && !includePrivate && pendingItems.some((item) => item.kind === "private") ? ["Private pending files were excluded; select their paths explicitly or pass includePrivate=true."] : []),
        ].map((warning) => boundWorkspaceValue(warning, WORKSPACE_DIFF_ERROR_MAX_CHARS));
        const textPrefix = [
            "## Workspace Diff",
            "",
            `- Status records inspected once: ${pendingItems.length}`,
            `- Files considered: ${candidates.length}`,
            `- Per-file output bound: ${maxChars} characters; complete response bound: ${WORKSPACE_DIFF_TOTAL_MAX_CHARS} characters.`,
            ...warnings.map((warning) => `- Warning: ${warning}`),
            ...(textSections.length > 0 ? [] : ["", "No eligible pending files."]),
        ].join("\n");
        return formatWorkspaceDiffResult(args.format ?? "text", textPrefix, textSections, {
            statusRecords: pendingItems.length,
            selectedPaths: selectedPaths ? workspacePathPreview(selectedPaths) : null,
            selectedPathCount: selectedPaths?.length ?? 0,
            allPending,
            includePrivate,
            maxFiles,
            perFileMaxChars: maxChars,
            totalMaxChars: WORKSPACE_DIFF_TOTAL_MAX_CHARS,
            skippedByLimit,
            unmatchedPaths: unmatchedPreviews,
            unprocessedCandidates,
        }, warnings, outcomes, unprocessedCandidates, args.workdir);
    },
});

export const branchCreate = tool({
    description: "Create a hierarchical Plastic SCM branch, guarding rare top-level branch creation (cm branch create).",
    args: {
        branch: tool.schema.string().min(1).describe("Relative new-branch name or full hierarchical branch path. A relative name uses parent, or the current branch when parent is omitted."),
        parent: tool.schema.string().optional().describe("Parent branch for a relative branch name. May differ from the workspace branch; Plastic uses the parent's latest changeset by default."),
        changeset: tool.schema.string().optional().describe("Changeset used as the starting point instead of the parent branch's latest changeset."),
        label: tool.schema.string().optional().describe("Label used as the starting point."),
        comment: tool.schema.string().optional().describe("Optional branch comment."),
        commentsFile: tool.schema.string().optional().describe("File path containing the branch comment."),
        allowRootBranch: tool.schema.boolean().optional().describe("Allow intentional top-level branch creation such as /<new-branch>. Defaults to false."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        if (args.branch.trim().length === 0)
        {
            throw new Error("Branch must be non-empty.");
        }

        if (args.changeset && args.label)
        {
            throw new Error("Provide either changeset or label, not both.");
        }

        if (args.comment && args.commentsFile)
        {
            throw new Error("Provide either comment or commentsFile, not both.");
        }

        if (args.comment !== undefined && args.comment.trim().length === 0)
        {
            throw new Error("Comment must be non-empty when provided.");
        }

        const normalizedRequested = normalizeBranchSpecForComparison(args.branch);
        const needsParent = !normalizedRequested.startsWith("/");
        const parentBranch = needsParent
            ? args.parent ?? await resolveCurrentBranchName(args.workdir)
            : args.parent;
        const targetBranch = resolveBranchCreationTarget(args.branch, parentBranch, args.allowRootBranch);
        const cmdArgs: string[] = ["branch", "create", targetBranch];

        if (args.changeset)
        {
            cmdArgs.push(`--changeset=${args.changeset}`);
        }

        if (args.label)
        {
            cmdArgs.push(`--label=${args.label}`);
        }

        if (args.comment)
        {
            cmdArgs.push(`-c=${args.comment}`);
        }

        if (args.commentsFile)
        {
            cmdArgs.push(`-commentsfile=${args.commentsFile}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const switchBranch = tool({
    description: "Switch the Plastic SCM workspace to a branch (cm switch), handling pending changes when needed.",
    args: {
        branch: tool.schema.string().min(1).describe("Branch name or spec selected from the current repository convention."),
        pendingChanges: tool.schema.enum(["shelve", "bring", "cancel"]).optional().describe("How to handle pending changes when switching branches. Defaults to cancel. In unattended mode, bring is blocked only when tracked pending changes exist."),
        preflight: tool.schema.boolean().optional().describe("Preview switch strategy without executing switch."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const preflight = args.preflight ?? false;
        const cwd = args.workdir ?? process.cwd();
        const branchBefore = await resolveCurrentBranchName(args.workdir);
        const pendingItems = await getMachineReadablePendingItems(args.workdir);
        const pendingSummaryDetailed = summarizePendingItems(pendingItems, cwd);
        const pendingSummary = toLegacyPendingSummary(pendingSummaryDetailed);
        const pendingProfile = buildSwitchPendingProfile(pendingSummaryDetailed);
        const targetAlreadyLoaded = isSameBranchSpec(branchBefore, args.branch);
        const switchCmd = ["switch", "--silent", "--noinput", args.branch];

        if (targetAlreadyLoaded)
        {
            const message = "Branch switch skipped: workspace is already on the target branch.";
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: no",
                        "- Strategy: already-on-target-branch",
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Reason: ${message}`,
                    ]),
                    {
                        wouldRun: false,
                        strategy: "already-on-target-branch",
                        branchBefore,
                        branchAfter: branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                    },
                    args.workdir,
                    [message],
                );
            }

            return toStructuredResult(
                "switch-branch",
                format,
                message,
                {
                    strategy: "already-on-target-branch",
                    branchBefore,
                    branchAfter: branchBefore,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    rawOutput: message,
                },
                args.workdir,
                [message],
            );
        }

        if (!pendingProfile.hasPendingChanges)
        {
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: yes",
                        `- Strategy: silent-noinput`,
                        `- Command: cm ${switchCmd.join(" ")}`,
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                    ]),
                    {
                        wouldRun: true,
                        strategy: "silent-noinput",
                        command: ["cm", ...switchCmd],
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                    },
                    args.workdir,
                );
            }

            const output = await runCm(switchCmd, args.workdir);
            const branchAfter = await resolveCurrentBranchName(args.workdir);
            return toStructuredResult(
                "switch-branch",
                format,
                output,
                {
                    strategy: "silent-noinput",
                    command: ["cm", ...switchCmd],
                    branchBefore,
                    branchAfter,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    rawOutput: output,
                },
                args.workdir,
            );
        }

        const pendingChoice = args.pendingChanges ?? "cancel";
        const defaulted = args.pendingChanges === undefined;

        if (canSwitchDirectWithPrivateOnlyPending(pendingChoice, defaulted, pendingProfile))
        {
            const reason = pendingChoice === "bring"
                ? "pendingChanges=bring requested with private-only pending changes. Running non-interactive switch directly because no tracked changes require interactive bring prompts."
                : pendingChoice === "shelve"
                    ? "pendingChanges=shelve requested with private-only pending changes. Skipping shelveset creation because there are no tracked changes to shelve."
                    : "Pending changes are private-only and pendingChanges was defaulted to cancel. Running non-interactive switch directly for unattended safety.";
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: yes",
                        "- Strategy: direct-switch-private-only",
                        `- Command: cm ${switchCmd.join(" ")}`,
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Pending policy: ${pendingChoice}`,
                        `- Reason: ${reason}`,
                    ]),
                    {
                        wouldRun: true,
                        strategy: "direct-switch-private-only",
                        command: ["cm", ...switchCmd],
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                        pendingPolicy: pendingChoice,
                        defaultedPolicy: defaulted,
                    },
                    args.workdir,
                    [reason],
                );
            }

            const output = await runCm(switchCmd, args.workdir);
            const branchAfter = await resolveCurrentBranchName(args.workdir);
            return toStructuredResult(
                "switch-branch",
                format,
                output,
                {
                    strategy: "direct-switch-private-only",
                    command: ["cm", ...switchCmd],
                    branchBefore,
                    branchAfter,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    pendingPolicy: pendingChoice,
                    defaultedPolicy: defaulted,
                    rawOutput: output,
                },
                args.workdir,
                [reason],
            );
        }

        if (isSwitchBringBlockedForUnattended(pendingChoice, pendingProfile))
        {
            const reason = "pendingChanges=bring is blocked for unattended runs when tracked pending changes exist because cm switch requires interactive prompts for bring mode. Use pendingChanges=shelve or resolve/shelve tracked changes first.";
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: no",
                        "- Strategy: blocked-bring-tracked-pending",
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Reason: ${reason}`,
                    ]),
                    {
                        wouldRun: false,
                        strategy: "blocked-bring-tracked-pending",
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                        pendingPolicy: pendingChoice,
                        defaultedPolicy: defaulted,
                    },
                    args.workdir,
                    [reason],
                    "Set pendingChanges to shelve, or shelve/clean tracked changes before switching.",
                );
            }

            throw new Error(reason);
        }

        if (pendingChoice === "cancel")
        {
            const reason = defaulted
                ? "Switch canceled because pending changes were detected and the default policy is cancel unless pendingChanges is set."
                : "Switch canceled because pending changes were detected and pendingChanges was set to cancel.";
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: no",
                        "- Strategy: cancel-with-pending",
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Reason: ${reason}`,
                    ]),
                    {
                        wouldRun: false,
                        strategy: "cancel-with-pending",
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                        pendingPolicy: pendingChoice,
                        defaultedPolicy: defaulted,
                    },
                    args.workdir,
                    [reason],
                    "Set pendingChanges to shelve if you want to continue switching with pending changes.",
                );
            }

            return toStructuredResult(
                "switch-branch",
                format,
                reason,
                {
                    strategy: "cancel-with-pending",
                    branchBefore,
                    branchAfter: branchBefore,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    pendingPolicy: pendingChoice,
                    defaultedPolicy: defaulted,
                    rawOutput: reason,
                },
                args.workdir,
                [reason],
                "Set pendingChanges to shelve if you want to continue switching with pending changes.",
            );
        }

        const shelveComment = `Auto-shelve before switch to ${args.branch}`;
        const shelveCmd = ["shelveset", "create", "--all", `-c=${shelveComment}`];

        if (preflight)
        {
            return toStructuredResult(
                "switch-branch-preflight",
                format,
                formatPreflightText("## Branch Switch Preflight", [
                    "- Would run: yes",
                    "- Strategy: shelve-then-switch-noinput",
                    `- Shelve command: cm ${shelveCmd.join(" ")}`,
                    `- Switch command: cm ${switchCmd.join(" ")}`,
                    `- Branch before: ${branchBefore}`,
                    `- Branch target: ${args.branch}`,
                ]),
                {
                    wouldRun: true,
                    strategy: "shelve-then-switch-noinput",
                    commands: [
                        ["cm", ...shelveCmd],
                        ["cm", ...switchCmd],
                    ],
                    branchBefore,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    pendingPolicy: pendingChoice,
                    defaultedPolicy: defaulted,
                },
                args.workdir,
            );
        }

        let shelveOutput = "";
        let usedNoChangesShelveRecovery = false;
        try
        {
            shelveOutput = await runCm(shelveCmd, args.workdir);
        }
        catch (error)
        {
            const errorMessage = normalizeErrorMessage(error);
            if (!isNoChangesWorkspaceCheckinError(errorMessage))
            {
                throw error;
            }

            const pendingAfterShelveAttempt = await getMachineReadablePendingItems(args.workdir).catch(() => []);
            const pendingSummaryAfterShelveAttempt = summarizePendingItems(pendingAfterShelveAttempt, cwd);
            const profileAfterShelveAttempt = buildSwitchPendingProfile(pendingSummaryAfterShelveAttempt);
            if (profileAfterShelveAttempt.hasTrackedPendingChanges)
            {
                throw error;
            }

            usedNoChangesShelveRecovery = true;
            shelveOutput = "Skipped shelveset creation because no tracked pending changes were detected after recovery check.";
        }

        const switchOutput = await runCm(switchCmd, args.workdir);
        const branchAfter = await resolveCurrentBranchName(args.workdir).catch(() => branchBefore);

        return toStructuredResult(
            "switch-branch",
            format,
            `${shelveOutput}\n${switchOutput}`,
            {
                strategy: "shelve-then-switch-noinput",
                commands: [
                    ["cm", ...shelveCmd],
                    ["cm", ...switchCmd],
                ],
                branchBefore,
                branchAfter,
                branchTarget: args.branch,
                pendingSummary,
                pendingSummaryDetailed,
                pendingPolicy: pendingChoice,
                defaultedPolicy: defaulted,
                usedNoChangesShelveRecovery,
                rawOutput: {
                    shelve: shelveOutput,
                    switch: switchOutput,
                },
            },
            args.workdir,
            [
                ...(usedNoChangesShelveRecovery ? ["Recovered from shelveset no-changes error and switched directly because tracked pending changes were no longer present."] : []),
            ],
        );
    },
});

export const merge = tool({
    description: "Merge safely with explicit non-interactive conflict strategy (cm merge --merge --nointeractiveresolution).",
    args: {
        source: tool.schema.string().min(1).describe("Source branch/changeset/label/shelveset spec to merge from."),
        strategy: tool.schema.enum(["auto", "source", "destination"]).optional().describe("Conflict resolution strategy. auto tries non-destructive auto-resolution and aborts if manual conflict remains. source/destination are explicit overrides."),
        cherrypicking: tool.schema.boolean().optional().describe("Enable cherry-picking mode."),
        forced: tool.schema.boolean().optional().describe("Skip connected-branch checks when supported by the merge mode."),
        preflight: tool.schema.boolean().optional().describe("Preview command without executing merge."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const preflight = args.preflight ?? false;
        const strategy: MergeConflictStrategy = args.strategy ?? "auto";
        const cmdArgs: string[] = [
            "merge",
            args.source,
            "--merge",
            "--nointeractiveresolution",
            "--machinereadable",
            `--startlineseparator=${MERGE_START_LINE_SEPARATOR}`,
            `--endlineseparator=${MERGE_END_LINE_SEPARATOR}`,
            `--fieldseparator=${MERGE_FIELD_SEPARATOR}`,
        ];

        let conflictPolicyDescription = "auto-try-abort-on-unresolved";

        if (strategy === "auto")
        {
            cmdArgs.push("--mergetype=try");
        }
        else
        {
            const prefersSource = strategy === "source";
            const strategyFlag = prefersSource ? "--keepsource" : "--keepdestination";
            const strategySuffix = prefersSource ? "src" : "dst";
            cmdArgs.push("--mergetype=forced", strategyFlag, `--automaticresolution=all-${strategySuffix}`);
            conflictPolicyDescription = prefersSource
                ? "forced-prefer-source"
                : "forced-prefer-destination";
        }

        if (args.cherrypicking)
        {
            cmdArgs.push("--cherrypicking");
        }

        if (args.forced)
        {
            cmdArgs.push("--forced");
        }

        if (preflight)
        {
            return toStructuredResult(
                "merge-preflight",
                format,
                formatPreflightText("## Merge Preflight", [
                    "- Would run: yes",
                    "- Strategy: non-interactive",
                    `- Conflict strategy: ${strategy}`,
                    `- Conflict policy: ${conflictPolicyDescription}`,
                    `- Command: cm ${cmdArgs.join(" ")}`,
                ]),
                {
                    wouldRun: true,
                    strategy: "non-interactive",
                    conflictStrategy: strategy,
                    conflictPolicy: conflictPolicyDescription,
                    command: ["cm", ...cmdArgs],
                    source: args.source,
                },
                args.workdir,
            );
        }

        let output: string;
        try
        {
            output = await runCm(cmdArgs, args.workdir);
        }
        catch (error)
        {
            const errorOutput = normalizeErrorMessage(error);
            const summary = summarizeMergeOutput(errorOutput);
            throw new Error(buildMergeAbortMessage(args.source, strategy, errorOutput, summary));
        }

        const summary = summarizeMergeOutput(output);
        if (summary.unresolvedSignals.length > 0)
        {
            throw new Error(buildMergeAbortMessage(args.source, strategy, output, summary));
        }

        const shortStatusAfterMerge = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const fullStatusAfterMerge = await runCmRaw(["status"], args.workdir).catch(() => "");
        const pendingSummaryAfterMerge = summarizeShortStatus(shortStatusAfterMerge);
        const mergeStateAfterMerge = analyzeMergeStatusOutput(fullStatusAfterMerge);
        const reportLines: string[] = [
            "## Merge Result",
            "",
            `- Source: ${args.source}`,
            `- Conflict strategy: ${strategy}`,
            `- Conflict policy: ${conflictPolicyDescription}`,
            `- Merge conflict signals: ${summary.conflictSignals.length}`,
            `- File conflict paths: ${summary.fileConflictPaths.length}`,
            `- Merge warning signals: ${summary.warningSignals.length}`,
            `- Pending items after merge: ${pendingSummaryAfterMerge.totalPending}`,
            `- Pending merge links after merge: ${mergeStateAfterMerge.pendingMergeLinks.length}`,
            `- Merge-in-progress hints after merge: ${mergeStateAfterMerge.mergeInProgressHints.length}`,
        ];

        if (summary.conflictSignals.length > 0)
        {
            reportLines.push("", "Conflict signal details:");
            for (const signal of summary.conflictSignals.slice(0, 20))
            {
                reportLines.push(`- ${signal}`);
            }
        }

        if (summary.warningSignals.length > 0)
        {
            reportLines.push("", "Warning signal details:");
            for (const signal of summary.warningSignals.slice(0, 20))
            {
                reportLines.push(`- ${signal}`);
            }
        }

        if (output.trim().length > 0 && output.trim() !== "(no output)")
        {
            reportLines.push("", "Raw merge output:", output.trim());
        }

        const warnings: string[] = [
            `Merged conflict signals reported by Plastic: ${summary.conflictSignals.length}.`,
        ];

        return toStructuredResult(
            "merge",
            format,
            reportLines.join("\n"),
            {
                strategy: "non-interactive",
                conflictStrategy: strategy,
                conflictPolicy: conflictPolicyDescription,
                command: ["cm", ...cmdArgs],
                source: args.source,
                mergeSummary: summary,
                shortStatusAfterMerge,
                pendingSummaryAfterMerge,
                fullStatusAfterMerge,
                mergeStateAfterMerge,
                rawOutput: output,
            },
            args.workdir,
            warnings,
        );
    },
});

export const mergeToBranch = tool({
    description: "Merge a source branch into a target branch using safe Plastic update, switch, merge, and checkin steps.",
    args: {
        source: tool.schema.string().optional().describe("Source branch to merge. Defaults to the currently loaded branch."),
        target: tool.schema.string().optional().describe("Target branch to merge into. Defaults to the source branch's Plastic parent branch."),
        cardRef: tool.schema.string().optional().describe("Optional tracker card reference to include in the merge checkin message, for example $4re."),
        message: tool.schema.string().optional().describe("Optional checkin message. Defaults to Merge <source> into <target>."),
        strategy: tool.schema.enum(["auto", "source", "destination"]).optional().describe("Merge conflict strategy. Defaults to auto."),
        updateTarget: tool.schema.boolean().optional().describe("Run plastic_update on the target branch before merging. Defaults to true."),
        includePrivate: tool.schema.boolean().optional().describe("Include private items in the merge checkin. Defaults to false."),
        preflight: tool.schema.boolean().optional().describe("Preview the planned closeout merge steps without executing them."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const startingBranch = await resolveCurrentBranchName(args.workdir);
        const sourceBranch = args.source ?? startingBranch;
        const resolvedParentBranch = args.target ? undefined : await resolveBranchParentName(sourceBranch, args.workdir);
        if (!args.target && !resolvedParentBranch)
        {
            throw new Error(`Unable to resolve the parent branch for ${sourceBranch}. Pass target explicitly.`);
        }
        const targetBranch = args.target ?? resolvedParentBranch!;
        const strategy: MergeConflictStrategy = args.strategy ?? "auto";
        const updateTarget = args.updateTarget ?? true;
        const includePrivate = args.includePrivate ?? false;
        const cardLine = args.cardRef?.trim() ? `${args.cardRef.trim()}\n\n` : "";
        const checkinMessage = args.message?.trim()
            ? args.message.trim()
            : `Merge ${sourceBranch} into ${targetBranch}\n\n${cardLine}Co-authored-by: Pi <pi@earendil.works>`;

        if (isSameBranchSpec(sourceBranch, targetBranch))
        {
            throw new Error(`Refusing to merge ${sourceBranch} into itself.`);
        }

        const plannedSteps = [
            `Resolve source branch: ${sourceBranch}`,
            `Switch to target branch: ${targetBranch}`,
            ...(updateTarget ? [`Update target branch safely: ${targetBranch}`] : []),
            `Merge source into target with strategy=${strategy}: ${sourceBranch}`,
            "Inspect merge status for unresolved hints.",
            "Check in merge result.",
        ];

        if (args.preflight)
        {
            const pendingItems = await getMachineReadablePendingItems(args.workdir);
            const pendingSummary = summarizePendingItems(pendingItems, args.workdir ?? process.cwd());
            return toStructuredResult(
                "merge-to-branch-preflight",
                format,
                formatPreflightText("## Merge To Branch Preflight", [
                    `- Starting branch: ${startingBranch}`,
                    `- Source branch: ${sourceBranch}`,
                    `- Target branch: ${targetBranch}`,
                    `- Target source: ${args.target ? "explicit argument" : "source branch parent"}`,
                    `- Update target: ${updateTarget ? "yes" : "no"}`,
                    `- Conflict strategy: ${strategy}`,
                    `- Include private: ${includePrivate ? "yes" : "no"}`,
                    `- Pending items before switch: ${pendingSummary.totalPending}`,
                    "",
                    "Planned steps:",
                    ...plannedSteps.map((step) => `- ${step}`),
                    "",
                    "Checkin message:",
                    checkinMessage,
                ]),
                {
                    wouldRun: true,
                    startingBranch,
                    sourceBranch,
                    targetBranch,
                    targetSource: args.target ? "explicit" : "parent",
                    resolvedParentBranch: resolvedParentBranch ?? null,
                    updateTarget,
                    conflictStrategy: strategy,
                    includePrivate,
                    pendingSummary,
                    checkinMessage,
                    plannedSteps,
                },
                args.workdir,
            );
        }

        const switchResult = await switchBranch.execute({
            branch: targetBranch,
            pendingChanges: "cancel",
            format: "json",
            workdir: args.workdir,
        });
        const updateResult = updateTarget ? await update.execute({ workdir: args.workdir }) : "(skipped)";
        const mergeResult = await merge.execute({
            source: sourceBranch,
            strategy,
            format: "json",
            workdir: args.workdir,
        });

        const fullStatusAfterMerge = await runCmRaw(["status"], args.workdir).catch(() => "");
        const mergeStateAfterMerge = analyzeMergeStatusOutput(fullStatusAfterMerge);
        if (mergeStateAfterMerge.hasMergeInProgress)
        {
            return toStructuredResult(
                "merge-to-branch",
                format,
                [
                    "## Merge To Branch Paused",
                    "",
                    `- Source branch: ${sourceBranch}`,
                    `- Target branch: ${targetBranch}`,
                    "- Merge completed, but merge-in-progress hints remain.",
                    "- Do not check in until merge metadata is resolved/finalized.",
                ].join("\n"),
                {
                    sourceBranch,
                    targetBranch,
                    switchResult,
                    updateResult,
                    mergeResult,
                    fullStatusAfterMerge,
                    mergeStateAfterMerge,
                    checkedIn: false,
                },
                args.workdir,
                ["Merge-in-progress hints remain after merge; checkin skipped."],
                "Resolve/finalize the merge metadata, validate, then run plastic_checkin for the merge result.",
            );
        }

        const preflightResult = await checkin.execute({
            message: checkinMessage,
            includeAll: true,
            includePrivate,
            preflight: true,
            format: "json",
            workdir: args.workdir,
        });
        const checkinResult = await checkin.execute({
            message: checkinMessage,
            includeAll: true,
            includePrivate,
            format: "json",
            workdir: args.workdir,
        });
        const finalBranch = await resolveCurrentBranchName(args.workdir);
        const finalShortStatus = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const finalPendingSummary = summarizeShortStatus(finalShortStatus);

        return toStructuredResult(
            "merge-to-branch",
            format,
            [
                "## Merge To Branch Complete",
                "",
                `- Source branch: ${sourceBranch}`,
                `- Target branch: ${targetBranch}`,
                `- Final branch: ${finalBranch}`,
                `- Update target: ${updateTarget ? "yes" : "no"}`,
                `- Conflict strategy: ${strategy}`,
                `- Merge checkin completed: yes`,
                `- Pending items after checkin: ${finalPendingSummary.totalPending}`,
            ].join("\n"),
            {
                sourceBranch,
                targetBranch,
                targetSource: args.target ? "explicit" : "parent",
                resolvedParentBranch: resolvedParentBranch ?? null,
                finalBranch,
                updateTarget,
                conflictStrategy: strategy,
                includePrivate,
                checkinMessage,
                switchResult,
                updateResult,
                mergeResult,
                preflightResult,
                checkinResult,
                finalShortStatus,
                finalPendingSummary,
                checkedIn: true,
            },
            args.workdir,
        );
    },
});

export const finalizeMerge = tool({
    description: "Finalize Plastic merge metadata after manual conflict resolution using an explicit non-interactive source/destination policy.",
    args: {
        source: tool.schema.string().min(1).describe("Original source branch/changeset/label/shelveset spec being merged."),
        strategy: tool.schema.enum(["source", "destination"]).optional().describe("Explicit finalization policy. destination preserves destination/manual workspace resolution in typical post-resolution flows; source accepts source where Plastic still needs a policy."),
        preflight: tool.schema.boolean().optional().describe("Preview finalization command without executing it."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const preflight = args.preflight ?? false;
        const strategy = args.strategy ?? "destination";
        const prefersSource = strategy === "source";
        const strategyFlag = prefersSource ? "--keepsource" : "--keepdestination";
        const strategySuffix = prefersSource ? "src" : "dst";
        const cmdArgs: string[] = [
            "merge",
            args.source,
            "--merge",
            "--nointeractiveresolution",
            "--mergetype=forced",
            strategyFlag,
            `--automaticresolution=all-${strategySuffix}`,
            "--machinereadable",
            `--startlineseparator=${MERGE_START_LINE_SEPARATOR}`,
            `--endlineseparator=${MERGE_END_LINE_SEPARATOR}`,
            `--fieldseparator=${MERGE_FIELD_SEPARATOR}`,
        ];

        if (preflight)
        {
            return toStructuredResult(
                "finalize-merge-preflight",
                format,
                formatPreflightText("## Merge Finalization Preflight", [
                    "- Would run: yes",
                    `- Source: ${args.source}`,
                    `- Strategy: ${strategy}`,
                    `- Command: cm ${cmdArgs.join(" ")}`,
                    "- Use this only after reviewing/resolving files and validating the workspace.",
                ]),
                {
                    wouldRun: true,
                    source: args.source,
                    strategy,
                    command: ["cm", ...cmdArgs],
                },
                args.workdir,
            );
        }

        const output = await runCm(cmdArgs, args.workdir);
        const summary = summarizeMergeOutput(output);
        const shortStatusAfterFinalize = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const fullStatusAfterFinalize = await runCmRaw(["status"], args.workdir).catch(() => "");
        const pendingSummaryAfterFinalize = summarizeShortStatus(shortStatusAfterFinalize);
        const mergeStateAfterFinalize = analyzeMergeStatusOutput(fullStatusAfterFinalize);
        const reportLines: string[] = [
            "## Merge Finalization Result",
            "",
            `- Source: ${args.source}`,
            `- Strategy: ${strategy}`,
            `- Conflict signals from finalization command: ${summary.conflictSignals.length}`,
            `- File conflict paths from finalization command: ${summary.fileConflictPaths.length}`,
            `- Pending items after finalization: ${pendingSummaryAfterFinalize.totalPending}`,
            `- Pending merge links after finalization: ${mergeStateAfterFinalize.pendingMergeLinks.length}`,
            `- Merge-in-progress hints after finalization: ${mergeStateAfterFinalize.mergeInProgressHints.length}`,
        ];

        if (summary.fileConflictPaths.length > 0)
        {
            reportLines.push("", "File conflict paths reported during finalization:");
            for (const conflictPath of summary.fileConflictPaths.slice(0, 20))
            {
                reportLines.push(`- ${conflictPath}`);
            }
        }

        if (output.trim().length > 0 && output.trim() !== "(no output)")
        {
            reportLines.push("", "Raw finalization output:", output.trim());
        }

        return toStructuredResult(
            "finalize-merge",
            format,
            reportLines.join("\n"),
            {
                source: args.source,
                strategy,
                command: ["cm", ...cmdArgs],
                mergeSummary: summary,
                shortStatusAfterFinalize,
                fullStatusAfterFinalize,
                pendingSummaryAfterFinalize,
                mergeStateAfterFinalize,
                rawOutput: output,
            },
            args.workdir,
            [
                "Review plastic_status() before checkin. Pending merge links are expected until the merge result is checked in; merge-in-progress hints are not.",
            ],
            mergeStateAfterFinalize.hasMergeInProgress
                ? "Resolve remaining merge-in-progress state before checkin."
                : "If validation passes, run plastic_checkin(...) to record the merge result.",
        );
    },
});

export const currentBranch = tool({
    description: "Get the current Plastic SCM branch from workspace status output.",
    args: {
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const branch = await resolveCurrentBranchName(args.workdir);
        return toStructuredResult(
            "current-branch",
            format,
            branch,
            {
                branch,
            },
            args.workdir,
        );
    },
});

export const branchList = tool({
    description: "List Plastic SCM branches using cm find branch with optional filters.",
    args: {
        nameLike: tool.schema.string().optional().describe("Filter by branch name pattern (supports % wildcard)."),
        parent: tool.schema.string().optional().describe("Filter by parent branch spec."),
        owner: tool.schema.string().optional().describe("Filter by branch owner."),
        includeHidden: tool.schema.boolean().optional().describe("Include hidden branches in the query result."),
        limit: tool.schema.number().int().min(1).optional().describe("Maximum number of branches to return."),
        orderBy: tool.schema.enum(["date", "branchname"]).optional().describe("Sort field for branch queries."),
        descending: tool.schema.boolean().optional().describe("Sort descending when true."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const whereClauses: string[] = [];

        if (args.nameLike)
        {
            whereClauses.push(cmWhereLike("name", args.nameLike));
        }

        if (args.parent)
        {
            whereClauses.push(cmWhereEquals("parent", args.parent));
        }

        if (args.owner)
        {
            whereClauses.push(cmWhereEquals("owner", args.owner));
        }

        if (args.includeHidden !== true)
        {
            whereClauses.push("hidden = 'false'");
        }
        else
        {
            whereClauses.push("(hidden = 'true' or hidden = 'false')");
        }

        const cmdArgs: string[] = ["find", "branch"];
        if (whereClauses.length > 0)
        {
            cmdArgs.push(`where ${whereClauses.join(" and ")}`);
        }

        if (args.orderBy)
        {
            cmdArgs.push(`order by ${args.orderBy}${args.descending ? " desc" : " asc"}`);
        }

        if (args.limit)
        {
            cmdArgs.push(`limit ${args.limit}`);
        }

        cmdArgs.push("--nototal");
        return runCm(cmdArgs, args.workdir);
    },
});

export const branchExists = tool({
    description: "Check whether a branch exists using cm find branch.",
    args: {
        branch: tool.schema.string().min(1).describe("Branch name to check."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        // Plastic's `name` query field contains only the leaf segment even though
        // `{name}` renders the full branch path. Query by leaf, then compare the
        // returned full paths so identical leaf names under other parents do not
        // produce a false positive.
        const output = await runCmRaw([
            "find",
            "branch",
            `where ${cmWhereEquals("name", getBranchLeafName(args.branch))}`,
            "--format={name}",
            "--nototal",
        ], args.workdir);
        const exists = normalizeFindOutputLines(output).some((branch) => isSameBranchSpec(branch, args.branch));
        return exists ? "true" : "false";
    },
});

export const branchDelete = tool({
    description: "Delete a Plastic SCM branch (cm branch delete).",
    args: {
        branch: tool.schema.string().min(1).describe("Branch spec to delete."),
        deleteChangesets: tool.schema.boolean().optional().describe("Delete changesets inside the branch when required."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["branch", "delete", args.branch];

        if (args.deleteChangesets)
        {
            cmdArgs.push("--delete-changesets");
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const shelvesetCreate = tool({
    description: "Create a shelveset (cm shelveset create).",
    args: {
        comment: tool.schema.string().optional().describe("Shelveset comment."),
        commentsFile: tool.schema.string().optional().describe("File path containing shelveset comment."),
        paths: tool.schema.array(tool.schema.string()).optional().describe("Optional item paths to shelve."),
        all: tool.schema.boolean().optional().describe("Include changed, moved, and deleted items."),
        dependencies: tool.schema.boolean().optional().describe("Include local change dependencies."),
        summaryFormat: tool.schema.boolean().optional().describe("Print only created shelveset spec for automation."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        if (args.comment && args.commentsFile)
        {
            throw new Error("Provide either comment or commentsFile, not both.");
        }

        if (args.comment !== undefined && args.comment.trim().length === 0)
        {
            throw new Error("Comment must be non-empty when provided.");
        }

        const cmdArgs: string[] = ["shelveset", "create"];

        if (args.paths && args.paths.length > 0)
        {
            cmdArgs.push(...args.paths);
        }

        if (args.all)
        {
            cmdArgs.push("--all");
        }

        if (args.dependencies)
        {
            cmdArgs.push("--dependencies");
        }

        if (args.summaryFormat)
        {
            cmdArgs.push("--summaryformat");
        }

        if (args.comment)
        {
            cmdArgs.push(`-c=${args.comment}`);
        }

        if (args.commentsFile)
        {
            cmdArgs.push(`-commentsfile=${args.commentsFile}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const shelvesetApply = tool({
    description: "Apply a shelveset (cm shelveset apply).",
    args: {
        shelveset: tool.schema.string().min(1).describe("Shelveset spec to apply (for example, sh:3)."),
        changePaths: tool.schema.array(tool.schema.string()).optional().describe("Optional shelve server paths to apply."),
        preview: tool.schema.boolean().optional().describe("Preview changes without applying them."),
        dontCheckout: tool.schema.boolean().optional().describe("Keep applied changes as local modifications without checkout."),
        comparisonMethod: tool.schema.enum([
            "ignoreeol",
            "ignorewhitespaces",
            "ignoreeolandwhitespaces",
            "recognizeall",
        ]).optional().describe("Comparison method used when applying changes."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["shelveset", "apply", args.shelveset];

        if (args.changePaths && args.changePaths.length > 0)
        {
            cmdArgs.push(...args.changePaths);
        }

        if (args.preview)
        {
            cmdArgs.push("--preview");
        }

        if (args.dontCheckout)
        {
            cmdArgs.push("--dontcheckout");
        }

        if (args.comparisonMethod)
        {
            cmdArgs.push(`--comparisonmethod=${args.comparisonMethod}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const shelvesetDelete = tool({
    description: "Delete a shelveset (cm shelveset delete).",
    args: {
        shelveset: tool.schema.string().min(1).describe("Shelveset spec to delete (for example, sh:3)."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        return runCm(["shelveset", "delete", args.shelveset], args.workdir);
    },
});

export const shelvesetList = tool({
    description: "List shelvesets using cm find shelve.",
    args: {
        owner: tool.schema.string().optional().describe("Filter by shelveset owner."),
        commentLike: tool.schema.string().optional().describe("Filter by shelveset comment pattern (supports % wildcard)."),
        limit: tool.schema.number().int().min(1).optional().describe("Maximum number of shelvesets to return."),
        dateFrom: tool.schema.string().optional().describe("Filter shelvesets created on or after this date/date constant."),
        format: tool.schema.string().optional().describe("Format string for query output."),
        dateFormat: tool.schema.string().optional().describe("Date format for query output."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const whereClauses: string[] = [];

        if (args.owner)
        {
            whereClauses.push(cmWhereEquals("owner", args.owner));
        }

        if (args.commentLike)
        {
            whereClauses.push(cmWhereLike("comment", args.commentLike));
        }

        if (args.dateFrom)
        {
            whereClauses.push(`date >= '${escapeCmWhereValue(args.dateFrom)}'`);
        }

        const cmdArgs: string[] = ["find", "shelve"];
        if (whereClauses.length > 0)
        {
            cmdArgs.push(`where ${whereClauses.join(" and ")}`);
        }

        if (args.limit)
        {
            cmdArgs.push(`limit ${args.limit}`);
        }

        if (args.format)
        {
            cmdArgs.push(`--format=${args.format}`);
        }

        if (args.dateFormat)
        {
            cmdArgs.push(`--dateformat=${args.dateFormat}`);
        }

        cmdArgs.push("--nototal");
        return runCm(cmdArgs, args.workdir);
    },
});

export const codeReviewCreate = tool({
    description: "Create a code review (cm codereview).",
    args: {
        target: tool.schema.string().min(1).describe("Review target spec (branch, changeset, or shelveset spec)."),
        title: tool.schema.string().min(1).describe("Code review title."),
        status: tool.schema.string().optional().describe("Initial review status."),
        assignee: tool.schema.string().optional().describe("Initial review assignee."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        format: tool.schema.string().optional().describe("Format string for creation output."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["codereview", args.target, args.title];

        if (args.status)
        {
            cmdArgs.push(`--status=${args.status}`);
        }

        if (args.assignee)
        {
            cmdArgs.push(`--assignee=${args.assignee}`);
        }

        if (args.repository)
        {
            cmdArgs.push(`--repository=${args.repository}`);
        }

        if (args.format)
        {
            cmdArgs.push(`--format=${args.format}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const codeReviewUpdate = tool({
    description: "Update an existing code review (cm codereview -e).",
    args: {
        id: tool.schema.string().min(1).describe("Code review id or GUID."),
        status: tool.schema.string().optional().describe("Updated review status."),
        assignee: tool.schema.string().optional().describe("Updated review assignee."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["codereview", "-e", args.id];

        if (args.status)
        {
            cmdArgs.push(`--status=${args.status}`);
        }

        if (args.assignee)
        {
            cmdArgs.push(`--assignee=${args.assignee}`);
        }

        if (args.repository)
        {
            cmdArgs.push(`--repository=${args.repository}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const codeReviewDelete = tool({
    description: "Delete one or more code reviews (cm codereview -d).",
    args: {
        ids: tool.schema.array(tool.schema.string()).min(1).describe("Code review IDs or GUIDs to delete."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["codereview", "-d", ...args.ids];

        if (args.repository)
        {
            cmdArgs.push(`--repository=${args.repository}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const codeReviewFind = tool({
    description: "Find code reviews with filters using cm find review.",
    args: {
        status: tool.schema.string().optional().describe("Filter by review status."),
        assignee: tool.schema.string().optional().describe("Filter by review assignee."),
        owner: tool.schema.string().optional().describe("Filter by review owner."),
        target: tool.schema.string().optional().describe("Filter by review target branch/changeset spec."),
        targetType: tool.schema.enum(["branch", "changeset"]).optional().describe("Filter by review target type."),
        titleLike: tool.schema.string().optional().describe("Filter by title pattern (supports % wildcard)."),
        limit: tool.schema.number().int().min(1).optional().describe("Maximum number of reviews to return."),
        orderBy: tool.schema.enum(["date", "modifieddate", "status"]).optional().describe("Sort field for review queries."),
        descending: tool.schema.boolean().optional().describe("Sort descending when true."),
        format: tool.schema.string().optional().describe("Format string for query output."),
        dateFormat: tool.schema.string().optional().describe("Date format for query output."),
        output: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const outputFormat = args.output ?? "text";
        const whereClauses: string[] = [];

        if (args.status)
        {
            whereClauses.push(cmWhereEquals("status", args.status));
        }

        if (args.assignee)
        {
            whereClauses.push(cmWhereEquals("assignee", args.assignee));
        }

        if (args.owner)
        {
            whereClauses.push(cmWhereEquals("owner", args.owner));
        }

        if (args.target)
        {
            whereClauses.push(cmWhereEquals("target", args.target));
        }

        if (args.targetType)
        {
            whereClauses.push(cmWhereEquals("targettype", args.targetType));
        }

        if (args.titleLike)
        {
            whereClauses.push(cmWhereLike("title", args.titleLike));
        }

        const cmdArgs: string[] = ["find", "review"];
        if (whereClauses.length > 0)
        {
            cmdArgs.push(`where ${whereClauses.join(" and ")}`);
        }

        if (args.orderBy)
        {
            cmdArgs.push(`order by ${args.orderBy}${args.descending ? " desc" : " asc"}`);
        }

        if (args.limit)
        {
            cmdArgs.push(`limit ${args.limit}`);
        }

        if (args.format)
        {
            cmdArgs.push(`--format=${args.format}`);
        }

        if (args.dateFormat)
        {
            cmdArgs.push(`--dateformat=${args.dateFormat}`);
        }

        cmdArgs.push("--nototal");
        const output = await runCm(cmdArgs, args.workdir);
        return toStructuredResult(
            "code-review-find",
            outputFormat,
            output,
            {
                command: ["cm", ...cmdArgs],
                rawOutput: output,
                resultCount: normalizeFindOutputLines(output).length,
            },
            args.workdir,
        );
    },
});

export const workspaceCreate = tool({
    description: "Create a Plastic SCM workspace (cm workspace create).",
    args: {
        name: tool.schema.string().min(1).describe("Workspace name."),
        path: tool.schema.string().min(1).describe("Workspace path."),
        repositorySpec: tool.schema.string().optional().describe("Optional repository specification for the new workspace."),
        selectorFile: tool.schema.string().optional().describe("Optional selector file path for the new workspace."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        if (args.repositorySpec && args.selectorFile)
        {
            throw new Error("Provide either repositorySpec or selectorFile, not both.");
        }

        const cmdArgs: string[] = ["workspace", "create", args.name, args.path];

        if (args.repositorySpec)
        {
            cmdArgs.push(args.repositorySpec);
        }

        if (args.selectorFile)
        {
            cmdArgs.push(`--selector=${args.selectorFile}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const workspaceList = tool({
    description: "List Plastic SCM workspaces (cm workspace list).",
    args: {
        format: tool.schema.string().optional().describe("Format string for workspace list output."),
        output: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const outputFormat = args.output ?? "text";
        const cmdArgs: string[] = ["workspace", "list"];

        if (args.format)
        {
            cmdArgs.push(`--format=${args.format}`);
        }

        const output = await runCm(cmdArgs, args.workdir);
        return toStructuredResult(
            "workspace-list",
            outputFormat,
            output,
            {
                command: ["cm", ...cmdArgs],
                rawOutput: output,
                resultCount: normalizeFindOutputLines(output).length,
            },
            args.workdir,
        );
    },
});
