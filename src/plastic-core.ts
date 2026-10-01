export { runWithAbortSignal } from "./execution/context";
export { status } from "./operations/status";
export { update, add, undo, resolveDeleteChangeConflict, workspaceCreate, workspaceList } from "./operations/workspace";
export { branchCreate, currentBranch, branchList, branchExists, branchDelete, __plasticBranchInternals } from "./operations/branches";
export { shelvesetCreate, shelvesetApply, shelvesetDelete, shelvesetList } from "./operations/shelvesets";
export { codeReviewCreate, codeReviewUpdate, codeReviewDelete, codeReviewFind } from "./operations/reviews";
import { PendingItemSummary, PendingSummary, inferPendingItemKind, parseMachineReadablePendingItems, summarizePendingItems, getSensitivePrivatePathReason, selectPrivatePathsForAutoAdd, filterPendingItemsByScope, resolveCheckinPaths, getMachineReadablePendingItems, PendingItem, formatPendingPathPreview, summarizeShortStatus } from "./domain/pending";
import { isSameBranchSpec, normalizeBranchSpecForComparison, assertWorkspaceOnBranch, listRecentBranchNames, resolveCurrentBranchName, resolveBranchParentName } from "./domain/branches";
import { spawnAndCollect, ExecutableEnvironment, resolveExecutable, getDiffExecutable, getCmExecutable } from "./execution/process";
import { tool } from "./tool-definition";
import { discoverPlasticWorkspace, parsePlasticSelector } from "./plastic-workspace";
import { promises as fs, realpathSync } from "node:fs";
import { join, dirname, basename, extname, resolve, isAbsolute } from "path";
import { runCm, runCmRaw, BLOCKED_CM_DIFF_MESSAGE } from "./execution/cm";
import { toPathComparisonKeyFromAbsolutePath, isSameFilesystemDevice, buildFallbackScopePaths, toNormalizedAbsolutePath, toCommandPath } from "./domain/paths";
import { isRevisionNotFoundError, normalizeDiffFileRevisionSpec, resolveDiffFileRevision, isUnscopedDiffRevisionSpec, extractBranchSelectorFromRevision, extractBranchNameFromSelector, PendingBaseIdentityResolver, createPendingBaseIdentityResolver } from "./domain/revisions";
import { isUtf8 } from "node:buffer";
import { getActiveAbortSignal, commandExecutionStorage } from "./execution/context";
import { tmpdir } from "os";
import { OutputFormat, TOOL_VERSION, outputFormatArg, toStructuredResult, formatPreflightText, formatServerMergeResult } from "./presentation/results";
import { update } from "./operations/workspace";
import { getCmVersion } from "./execution/cli-version";
import { MergeOutputSummary, analyzeMergeStatusOutput, normalizeErrorMessage, MERGE_START_LINE_SEPARATOR, MERGE_END_LINE_SEPARATOR, MERGE_FIELD_SEPARATOR, summarizeMergeOutput, parseServerMergeOutput } from "./domain/merge-output";
import { workdirArg } from "./operations/arguments";
import { randomBytes } from "node:crypto";

const PLASTIC_PATCH_EXECUTABLE_ENV = "PI_PLASTIC_PATCH_EXECUTABLE";

type PatchExecutableProbe = (command: string) => Promise<boolean>;
// Plastic's server/backend determines whether a moved item is encoded as a
// move or as delete/add records. Do not claim either without a live fixture.

const PATCH_MOVE_REPRESENTATION = "backend-determined" as const;

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

type CanceledSwitchOutcome = {
    kind: "canceled";
    strategy: "cancel-with-pending";
    branchBefore: string;
    branchTarget: string;
    pendingSummary: PendingSummary;
    pendingSummaryDetailed: PendingItemSummary;
    pendingPolicy: "cancel";
    defaultedPolicy: boolean;
    reason: string;
};

const createCanceledSwitchOutcome = (
    branchBefore: string,
    branchTarget: string,
    pendingSummary: PendingSummary,
    pendingSummaryDetailed: PendingItemSummary,
    pendingChoice: "shelve" | "bring" | "cancel",
    defaultedPolicy: boolean,
): CanceledSwitchOutcome | undefined =>
{
    if (pendingChoice !== "cancel" || pendingSummaryDetailed.totalPending === 0 || isSameBranchSpec(branchBefore, branchTarget))
    {
        return undefined;
    }

    return {
        kind: "canceled",
        strategy: "cancel-with-pending",
        branchBefore,
        branchTarget,
        pendingSummary,
        pendingSummaryDetailed,
        pendingPolicy: "cancel",
        defaultedPolicy,
        reason: defaultedPolicy
            ? "Switch canceled because pending changes were detected and the default policy is cancel unless pendingChanges is set."
            : "Switch canceled because pending changes were detected and pendingChanges was set to cancel.",
    };
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

const probePatchExecutable = async (command: string): Promise<boolean> =>
{
    try
    {
        // This establishes only that the configured executable can launch.
        // `cm patch` remains the authoritative verifier for its --binary contract.
        const result = await spawnAndCollect(command, ["--version"], process.cwd(), undefined, AbortSignal.timeout(3000), {
            abortKillDelayMs: 100,
            outputLimitChars: 1024,
        });
        return !result.aborted;
    }
    catch
    {
        return false;
    }
};

export const getPatchBackendCapabilityWarning = async (
    environment: ExecutableEnvironment = process.env,
    platform: NodeJS.Platform = process.platform,
    probe: PatchExecutableProbe = probePatchExecutable,
): Promise<string | undefined> =>
{
    const configuredPatchExecutable = environment[PLASTIC_PATCH_EXECUTABLE_ENV]?.trim();
    if (configuredPatchExecutable)
    {
        if (await probe(configuredPatchExecutable))
        {
            return undefined;
        }

        return "Pi Plastic capability warning: the configured PI_PLASTIC_PATCH_EXECUTABLE could not be launched. Set it to a verified patch-capable non-GUI diff executable, or remove the override to use this platform's documented fallback. The configured path is not shown for privacy.";
    }

    if (platform === "win32")
    {
        return "Pi Plastic capability warning: plastic_patch requires PI_PLASTIC_PATCH_EXECUTABLE on Windows. Set it to a verified patch-capable non-GUI diff executable (for example Git's diff.exe). PI_PLASTIC_DIFF_EXECUTABLE is only for text diffs.";
    }

    return undefined;
};

const resolvePatchToolPath = (
    toolPath?: string,
    environment: ExecutableEnvironment = process.env,
    platform: NodeJS.Platform = process.platform,
): string =>
{
    // A per-call path is deliberately the strongest override: callers may
    // select a known patch-capable executable without changing process policy.
    if (toolPath?.trim())
    {
        return toolPath.trim();
    }

    const configuredPatchExecutable = environment[PLASTIC_PATCH_EXECUTABLE_ENV]?.trim();
    if (configuredPatchExecutable)
    {
        return configuredPatchExecutable;
    }

    if (platform === "win32")
    {
        // GnuWin32 diff 2.8.7 is known to reject cm patch directory operands.
        // Do not inherit PI_PLASTIC_DIFF_EXECUTABLE here: that setting remains
        // for text diffs and may name the incompatible executable.
        throw new Error(
            "cm patch requires a patch-capable non-GUI diff executable on Windows. Set PI_PLASTIC_PATCH_EXECUTABLE to a verified tool (for example Git's diff.exe), or pass toolPath for this one call. PI_PLASTIC_DIFF_EXECUTABLE is used only for text diffs and is not a safe Windows patch default.",
        );
    }

    // Retain the pre-existing non-Windows fallback while keeping the patch-specific
    // environment variable authoritative. The caller must verify that the resolved
    // executable supports the local Plastic client's patch argument contract.
    return resolveExecutable(environment, "PI_PLASTIC_DIFF_EXECUTABLE", "diff");
};

type ResolvedPatchBranchSpecs = Pick<PatchCommandArgs, "source" | "destination">;

// Repository selectors are a single cm argv value, so spaces within a repository
// name are not shell separators. Require non-empty @-separated components without
// edge whitespace, while retaining Plastic's valid internal spaces and punctuation.

const isSafePatchRepositorySelector = (repository: string | undefined): repository is string =>
{
    if (!repository || repository !== repository.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(repository))
    {
        return false;
    }

    return repository.split("@").every((component) => /^[^@\s](?:[^@]*[^@\s])?$/.test(component));
};

const qualifyPatchBranchSpec = (branchSpec: string, repository?: string): string =>
{
    const normalizedBranchSpec = branchSpec.trim();
    if (!/^br:\/.+/i.test(normalizedBranchSpec) || normalizedBranchSpec.includes("@"))
    {
        return normalizedBranchSpec;
    }

    if (!isSafePatchRepositorySelector(repository))
    {
        throw new Error(
            `Cannot safely qualify unqualified branch selector '${normalizedBranchSpec}' against this workspace. Use the exact repository-qualified syntax 'br:/<branch>@<repository>@<server>'.`,
        );
    }

    return `${normalizedBranchSpec}@${repository}`;
};

const resolvePatchBranchSpecs = async (args: PatchCommandArgs, cwd: string): Promise<ResolvedPatchBranchSpecs> =>
{
    const branchSpecs = [args.source, args.destination].filter((value): value is string => Boolean(value && /^br:\/.+/i.test(value.trim())));
    const needsQualification = branchSpecs.some((value) => !value.includes("@"));
    if (!needsQualification)
    {
        return { source: args.source.trim(), ...(args.destination ? { destination: args.destination.trim() } : {}) };
    }

    const workspace = await discoverPlasticWorkspace(cwd);
    if (workspace.kind !== "found")
    {
        throw new Error("Cannot safely qualify an unqualified branch selector because the current Plastic workspace repository is unavailable. Use exact repository-qualified syntax 'br:/<branch>@<repository>@<server>'.");
    }

    const selectorText = await fs.readFile(join(workspace.value.plasticDir, "plastic.selector"), "utf8").catch(() => undefined);
    const selector = selectorText === undefined ? { kind: "not_found" as const } : parsePlasticSelector(selectorText);
    const repository = selector.kind === "found" ? selector.value.repository : undefined;
    return {
        source: qualifyPatchBranchSpec(args.source, repository),
        ...(args.destination ? { destination: qualifyPatchBranchSpec(args.destination, repository) } : {}),
    };
};

type PatchOutputStaging = {
    requestedOutput: string;
    stagingOutput: string;
    cleanup: () => Promise<void>;
};

const ensurePatchOutputDoesNotExist = async (requestedOutput: string): Promise<void> =>
{
    const existing = await fs.lstat(requestedOutput).catch((error: unknown) =>
    {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    });
    if (existing)
    {
        throw new Error(`Refusing to overwrite existing patch output '${requestedOutput}'. Choose a new output path.`);
    }
};

const createPatchOutputStaging = async (requestedOutput: string): Promise<PatchOutputStaging> =>
{
    await ensurePatchOutputDoesNotExist(requestedOutput);
    let stagingDirectory: string;
    try
    {
        stagingDirectory = await fs.mkdtemp(join(dirname(requestedOutput), ".pi-plastic-patch-"));
    }
    catch (error)
    {
        throw new Error(`Cannot create package-owned patch staging beside '${requestedOutput}'. Ensure its parent directory exists and is writable. ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
        requestedOutput,
        stagingOutput: join(stagingDirectory, "patch-output"),
        cleanup: async () => fs.rm(stagingDirectory, { recursive: true, force: true }),
    };
};

const validatePatchStagingOutput = async (stagingOutput: string, requireContent = false): Promise<void> =>
{
    const patchStat = await fs.lstat(stagingOutput).catch(() => null);
    if (!patchStat?.isFile())
    {
        throw new Error("Plastic reported patch generation success but did not create package-owned staging output.");
    }
    if (requireContent && patchStat.size === 0)
    {
        // An omitted output may intentionally report an empty patch. A caller
        // who requested a file, however, must never receive a zero-byte file
        // that is indistinguishable from a failed/truncated backend outcome.
        throw new Error("Refusing to publish an empty patch output. Plastic produced no patch bytes; rerun without output to inspect the empty result or verify the patch backend.");
    }
};

// Creating a hard link is atomic and fails if the requested path appeared
// after our preflight. Unlike rename(), it can never replace an existing file.

const publishPatchOutput = async (stagingOutput: string, requestedOutput: string): Promise<void> =>
{
    await validatePatchStagingOutput(stagingOutput, true);
    try
    {
        await fs.link(stagingOutput, requestedOutput);
    }
    catch (error)
    {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST")
        {
            throw new Error(`Refusing to overwrite existing patch output '${requestedOutput}'. Choose a new output path.`);
        }
        throw new Error(`Could not atomically publish patch output '${requestedOutput}'. ${error instanceof Error ? error.message : String(error)}`);
    }
};

const runPatchOutputTransaction = async (requestedOutput: string, generate: (stagingOutput: string) => Promise<void>): Promise<void> =>
{
    const staging = await createPatchOutputStaging(requestedOutput);
    try
    {
        await generate(staging.stagingOutput);
        await publishPatchOutput(staging.stagingOutput, staging.requestedOutput);
    }
    finally
    {
        await staging.cleanup();
    }
};

const redactPatchStagingOutput = (message: string, stagingOutput: string): string =>
{
    const stagingPaths = new Set([stagingOutput]);
    try
    {
        // macOS commonly exposes /var through the canonical /private/var path.
        // cm may report the latter even though it received the former.
        stagingPaths.add(join(realpathSync.native(dirname(stagingOutput)), basename(stagingOutput)));
    }
    catch
    {
        // The staging parent normally exists; retain raw-path redaction if it does not.
    }

    return Array.from(stagingPaths)
        .sort((left, right) => right.length - left.length)
        .reduce((redacted, path) => redacted.split(path).join("<package-owned-staging-file>"), message);
};

const withPatchBackendContractDiagnostic = (error: unknown, toolPath: string, stagingOutput: string): Error =>
{
    const message = redactPatchStagingOutput(error instanceof Error ? error.message : String(error), stagingOutput);
    // Plastic 11 on macOS invokes its patch backend with --binary. Apple's BSD
    // /usr/bin/diff rejects that flag, while GNU diffutils accepts it. Detect
    // the observed contract failure instead of guessing from a path or OS.
    if (/unrecognized option [`']?--binary/i.test(message))
    {
        return new Error(
            `${message}\n\nPlastic patch requires a diff executable that accepts --binary. '${toolPath}' rejected that argument. Configure PI_PLASTIC_PATCH_EXECUTABLE (or this call's toolPath) to a verified GNU diffutils-compatible non-GUI diff executable. Text diff configuration is independent; Apple BSD diff may still be used for text-only diffs.`,
        );
    }
    return new Error(message);
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
    getPatchBackendCapabilityWarning,
    qualifyPatchBranchSpec,
    resolvePatchBranchSpecs,
    createPatchOutputStaging,
    publishPatchOutput,
    runPatchOutputTransaction,
    withPatchBackendContractDiagnostic,
    PATCH_MOVE_REPRESENTATION,
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
    assertWorkspaceOnBranch,
    buildSwitchPendingProfile,
    isSwitchBringBlockedForUnattended,
    canSwitchDirectWithPrivateOnlyPending,
};

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
    _cwd: string,
    leftLabel: string,
    rightLabel: string,
): Promise<TextDiffResult> =>
{
    const [leftContent, rightContent] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
    if (isBinaryContent(leftContent) || isBinaryContent(rightContent))
    {
        return { backend: "diff", changed: !leftContent.equals(rightContent), binary: true, output: "", truncated: false, totalChars: 0 };
    }

    // Do not pass either workspace or historical source paths to diff: a
    // Unicode workspace path reproduces an Invalid argument failure in the
    // configured Windows GnuWin32 backend. Labels intentionally stay out of
    // argv and are restored by stableDiffHeaders below.
    const materializationDir = await createAsciiTempDirectory("pi-plastic-diff-");
    const materializedLeftPath = join(materializationDir, `left${safeTempExtension(leftPath)}`);
    const materializedRightPath = join(materializationDir, `right${safeTempExtension(rightPath)}`);
    try
    {
        await Promise.all([
            fs.writeFile(materializedLeftPath, leftContent),
            fs.writeFile(materializedRightPath, rightContent),
        ]);
        const { stdout, stderr, exitCode, aborted, stdoutTruncated, stdoutTotalChars } = await spawnAndCollect(
            getDiffExecutable(),
            ["-u", materializedLeftPath, materializedRightPath],
            materializationDir,
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
                .split(materializedLeftPath).join(leftLabel)
                .split(materializedRightPath).join(rightLabel);
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
    }
    finally
    {
        await fs.rm(materializationDir, { recursive: true, force: true });
    }
};

const safeTempExtension = (pathValue: string): string =>
{
    const extension = extname(pathValue);
    return /^\.[A-Za-z0-9]{1,12}$/.test(extension) ? extension : ".tmp";
};

const isAsciiPath = (pathValue: string): boolean => /^[\x20-\x7e]*$/.test(pathValue);

// GnuWin32 diff cannot reliably accept Unicode operands. Keep every package
// materialization path ASCII-only; labels are restored after the backend exits.

const createAsciiTempDirectory = async (prefix: string): Promise<string> =>
{
    const temporaryRoot = tmpdir();
    if (!isAsciiPath(temporaryRoot))
    {
        throw new Error("Text diff requires an ASCII-safe temporary directory because the configured backend cannot reliably accept Unicode paths. Set TEMP and TMP to a writable ASCII-only path.");
    }
    return fs.mkdtemp(join(temporaryRoot, prefix));
};

const materializeRevision = async (revision: string, destination: string, workdir?: string): Promise<void> =>
{
    // --file keeps historical bytes out of the decoded stdout path. This is
    // required for both reliable binary detection and Unity YAML text handling.
    try
    {
        await runCm(["cat", revision, `--file=${destination}`], workdir);
        const destinationStat = await fs.stat(destination).catch(() => null);
        if (!destinationStat?.isFile())
        {
            throw new Error("Plastic did not materialize the requested historical file content.");
        }
    }
    catch (error)
    {
        // cm cat --file can leave a zero-byte output on failure. The destination
        // is package-owned, so remove it before surfacing a sanitized diagnostic.
        await fs.rm(destination, { force: true }).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.split(destination).join("<package-owned-temp-file>"));
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
    const status = result.binary ? (result.changed ? "binary-different" : "unchanged") : (result.changed ? "changed" : (comparisonKind === "workspace-added" ? "added-empty" : "unchanged"));
    const text = result.binary
        ? (result.changed ? "Binary content differs; a text diff is unavailable." : "No differences.")
        : (result.changed ? result.output : (status === "added-empty" ? "Added file is empty; no text diff hunks." : "No differences."));
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
    isAsciiPath,
    createAsciiTempDirectory,
    materializeRevision,
    isNoDataError,
    withWorkspaceBaseUnavailableDiagnostic,
    boundTextDiffResult,
    resolveDiffFileRevision,
    isUnscopedDiffRevisionSpec,
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
    description: "Generate a Plastic SCM review patch with a patch-specific non-GUI diff backend; branch selectors are qualified to the current workspace repository and requested outputs publish atomically without overwrite (cm patch).",
    args: {
        source: tool.schema.string().min(1).describe("Source changeset or branch spec. Unqualified br:/ selectors are qualified only from the exact current workspace repository."),
        destination: tool.schema.string().optional().describe("Optional second changeset or branch spec for two-spec patch generation."),
        output: tool.schema.string().optional().describe("Optional new output file path. The package stages then atomically publishes it and refuses any existing path. If omitted, patch content is returned."),
        toolPath: tool.schema.string().optional().describe("Optional patch-capable non-GUI diff executable for this call (highest priority). Otherwise use PI_PLASTIC_PATCH_EXECUTABLE; non-Windows falls back to PI_PLASTIC_DIFF_EXECUTABLE/diff, which must support the local Plastic patch argument contract."),
        clean: tool.schema.boolean().optional().describe("Exclude content that arrived via merges and include only direct checkins."),
        integration: tool.schema.boolean().optional().describe("Show branch changes pending integration into the parent branch."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        // Validate before staging or launching any process, including direct
        // callers that bypass the TypeBox schema layer.
        assertRequiredPatchValue("source", args.source);
        assertNonBlankPatchValue("destination", args.destination);
        assertNonBlankPatchValue("output", args.output);
        assertNonBlankPatchValue("toolPath", args.toolPath);

        const cwd = args.workdir ?? process.cwd();
        const toolPath = resolvePatchToolPath(args.toolPath);
        const branchSpecs = await resolvePatchBranchSpecs(args, cwd);
        const temporaryOutputDirectory = args.output ? null : await fs.mkdtemp(join(tmpdir(), "plastic-patch-"));
        const requestedOutput = args.output
            ? (isAbsolute(args.output) ? args.output : resolve(cwd, args.output))
            : join(temporaryOutputDirectory!, "review.patch");
        let commandOutput = "";

        const generate = async (stagingOutput: string): Promise<void> =>
        {
            const cmdArgs = buildPatchCommandArgs({
                ...args,
                ...branchSpecs,
                output: stagingOutput,
                toolPath,
            });
            try
            {
                commandOutput = await runCm(cmdArgs, args.workdir);
            }
            catch (error)
            {
                throw withPatchBackendContractDiagnostic(error, toolPath, stagingOutput);
            }
            await validatePatchStagingOutput(stagingOutput);
        };

        try
        {
            if (args.output)
            {
                await runPatchOutputTransaction(requestedOutput, generate);
            }
            else
            {
                await generate(requestedOutput);
            }

            const patchBytes = await fs.readFile(requestedOutput);
            const isText = isUtf8(patchBytes);
            const patchText = isText ? patchBytes.toString("utf8") : "";
            const bounded = boundDiffOutput(patchText);
            const binaryLimited = /Binary files? .* differ|cannot diff|binary (?:content|file) (?:is )?not supported/i.test(`${patchText}\n${commandOutput}`);
            const metadata = {
                status: patchBytes.length === 0 ? "empty" : (binaryLimited ? "generated-with-binary-warning" : "generated"),
                output: args.output ? args.output : null,
                bytes: patchBytes.length,
                empty: patchBytes.length === 0,
                binaryLimited: !isText || binaryLimited,
                moveRepresentation: PATCH_MOVE_REPRESENTATION,
                truncated: !args.output && bounded.truncated,
                content: args.output ? null : bounded.output,
            };
            return JSON.stringify(metadata, null, 2);
        }
        finally
        {
            if (temporaryOutputDirectory)
            {
                await fs.rm(temporaryOutputDirectory, { recursive: true, force: true });
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
        const tempDir = await createAsciiTempDirectory("plastic-core-");
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
    baseIdentityResolver?: PendingBaseIdentityResolver,
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
    if (isDeleted && !pendingItem?.revisionId)
    {
        throw new Error(`Plastic status identified '${args.path}' as deleted but did not provide its base revision ID.`);
    }
    let materializeSpec = workspaceBase.resolved;
    if (pendingItem?.revisionId && !isAdded && !isPrivate)
    {
        if (!baseIdentityResolver)
        {
            throw new Error(`Plastic cannot resolve the owning repository for '${args.path}'.`);
        }
        materializeSpec = await baseIdentityResolver.resolve(pendingItem);
    }

    const tempDir = await createAsciiTempDirectory("plastic-core-");
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
            const tempDir = await createAsciiTempDirectory("plastic-core-");
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
        const compared = await diffPendingWorkspaceFile(args, pendingItem, createPendingBaseIdentityResolver(cwd, args.workdir));
        return formatTextDiff(
            "diffFile",
            args.format,
            compared.comparisonKind,
            compared.result,
            args.workdir,
            { pendingKind: compared.pendingKind, isNew: compared.pendingKind === "private" || compared.pendingKind === "added", statusRevisionId: pendingItem?.revisionId, baseRepositoryResolved: Boolean(pendingItem?.baseRepository) },
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

        const baseIdentityResolver = createPendingBaseIdentityResolver(cwd, args.workdir);
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
                const compared = await diffPendingWorkspaceFile({ path, workdir: args.workdir }, item, baseIdentityResolver);
                const remaining = Math.max(0, WORKSPACE_DIFF_CONTENT_MAX_CHARS - totalOutputChars);
                const perFile = boundWorkspaceDiffResult(compared.result, maxChars);
                const bounded = boundWorkspaceDiffResult(perFile, remaining);
                const status = bounded.binary ? (bounded.changed ? "binary-different" : "unchanged") : (bounded.changed ? "changed" : (compared.comparisonKind === "workspace-added" ? "added-empty" : "unchanged"));
                const diffOutput = bounded.changed && !bounded.binary ? bounded.output : undefined;
                outcomes.push({ path: displayPath, kind: item.kind, comparisonKind: compared.comparisonKind, status, changed: bounded.changed, binary: bounded.binary, truncated: bounded.truncated, totalChars: bounded.totalChars, baseRepositoryResolved: Boolean(item.baseRepository), ...(diffOutput ? { diff: diffOutput } : {}) });
                const body = bounded.binary ? (bounded.changed ? "Binary content differs; a text diff is unavailable." : "No differences.") : (bounded.changed ? bounded.output : (status === "added-empty" ? "Added file is empty; no text diff hunks." : "No differences."));
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
            assertWorkspaceOnBranch(branchAfter, args.branch, "cm switch");
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
            assertWorkspaceOnBranch(branchAfter, args.branch, "cm switch with private-only pending items");
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

        const canceledOutcome = createCanceledSwitchOutcome(
            branchBefore,
            args.branch,
            pendingSummary,
            pendingSummaryDetailed,
            pendingChoice,
            defaulted,
        );
        if (canceledOutcome)
        {
            const reason = canceledOutcome.reason;
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
        assertWorkspaceOnBranch(branchAfter, args.branch, "cm switch after shelving");

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

type QualifiedServerBranch = {
    raw: string;
    branch: string;
    repository: string;
    server: string;
};

const SERVER_MERGE_OUTPUT_LIMIT = 16_384;

const SERVER_MERGE_HELP_TIMEOUT_MS = 3_000;

const SERVER_MERGE_COMMAND_TIMEOUT_MS = 30_000;

const serverMergeControlPattern = /[\u0000-\u001f\u007f-\u009f]/;

const serverMergeCapabilityTokens = ["--to", "--merge", "--nointeractiveresolution", "--machinereadable", "--startlineseparator", "--endlineseparator", "--fieldseparator"];

const assertSafeServerMergeValue = (name: string, value: string): string =>
{
    const trimmed = value.trim();
    if (!trimmed || serverMergeControlPattern.test(value))
    {
        throw new Error(`${name} must be non-empty and must not contain control characters.`);
    }

    return trimmed;
};

const parseQualifiedServerBranch = (name: string, value: string): QualifiedServerBranch =>
{
    const raw = assertSafeServerMergeValue(name, value);
    if (!raw.startsWith("br:/"))
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    const lastAt = raw.lastIndexOf("@");
    const previousAt = raw.lastIndexOf("@", lastAt - 1);
    if (previousAt <= 3 || lastAt <= previousAt + 1 || lastAt === raw.length - 1)
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    const branch = raw.slice(3, previousAt);
    const repository = raw.slice(previousAt + 1, lastAt);
    const server = raw.slice(lastAt + 1);
    if (!branch.startsWith("/") || branch.endsWith("/") || [branch, repository, server].some((part) => !part || part !== part.trim() || serverMergeControlPattern.test(part)))
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    return { raw, branch, repository, server };
};

const createServerMergeSeparators = (): { start: string; end: string; field: string } =>
{
    const nonce = randomBytes(16).toString("hex");
    return {
        start: `__PI_PLASTIC_MERGE_START_${nonce}__`,
        end: `__PI_PLASTIC_MERGE_END_${nonce}__`,
        field: `__PI_PLASTIC_MERGE_FIELD_${nonce}__`,
    };
};

const getServerMergeCapability = async (): Promise<{ supported: boolean; diagnostics: string }> =>
{
    const result = await spawnAndCollect(getCmExecutable(), ["help", "merge"], process.cwd(), undefined, getActiveAbortSignal(), {
        ...(commandExecutionStorage.getStore() ?? {}),
        timeoutMs: SERVER_MERGE_HELP_TIMEOUT_MS,
        outputLimitChars: SERVER_MERGE_OUTPUT_LIMIT,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const missing = serverMergeCapabilityTokens.filter((token) => !output.includes(token));
    if (result.aborted || result.timedOut || result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated || missing.length > 0)
    {
        return { supported: false, diagnostics: `Local cm help merge capability check did not prove required syntax${missing.length > 0 ? `: missing ${missing.join(", ")}` : "."}` };
    }
    return { supported: true, diagnostics: "Local cm help merge advertised the required merge-to and machine-readable syntax. Server capability remains unverified until dispatch." };
};

export const mergeBranches = tool({
    description: "Perform one bounded workspace-free server-side merge between explicitly qualified branches; merge-link and xlink effects remain unverified.",
    args: {
        source: tool.schema.string().min(1).describe("Fully qualified source branch: br:/<branch>@<repository>@<server>."),
        target: tool.schema.string().min(1).describe("Fully qualified target branch in the same repository/server as source."),
        message: tool.schema.string().min(1).describe("Non-empty changeset comment; no editor fallback is allowed."),
        preflight: tool.schema.boolean().optional().describe("Render the exact command only; does not contact Plastic or analyze remote conflicts."),
        format: outputFormatArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const source = parseQualifiedServerBranch("source", args.source);
        const target = parseQualifiedServerBranch("target", args.target);
        const message = assertSafeServerMergeValue("message", args.message);
        if (source.repository !== target.repository || source.server !== target.server)
        {
            throw new Error("source and target must identify the same exact repository and server.");
        }
        if (source.branch === target.branch)
        {
            throw new Error("source and target must identify different branches.");
        }

        const separators = createServerMergeSeparators();
        const command = [
            "merge", source.raw, `--to=${target.raw}`, "--merge", `-c=${message}`, "--nointeractiveresolution", "--machinereadable",
            `--startlineseparator=${separators.start}`, `--endlineseparator=${separators.end}`, `--fieldseparator=${separators.field}`,
        ];
        const requestedIdentity = { source: source.raw, target: target.raw, repository: source.repository, server: source.server };
        if (args.preflight)
        {
            return formatServerMergeResult(format, "preflight", [
                "## Server Merge Preflight",
                "",
                "- Would run: yes",
                "- Remote analysis: not performed",
                `- Command: cm ${command.join(" ")}`,
            ].join("\n"), { wouldRun: true, requestedIdentity, command: ["cm", ...command] });
        }

        const capability = await getServerMergeCapability();
        if (!capability.supported)
        {
            return formatServerMergeResult(format, "unsupported", "## Server Merge Unsupported\n\n- No merge command was dispatched because local client syntax could not be proven.", {
                requestedIdentity,
                capability,
                dispatched: false,
            });
        }

        const attempt = await spawnAndCollect(getCmExecutable(), command, process.cwd(), undefined, getActiveAbortSignal(), {
            ...(commandExecutionStorage.getStore() ?? {}),
            timeoutMs: SERVER_MERGE_COMMAND_TIMEOUT_MS,
            outputLimitChars: SERVER_MERGE_OUTPUT_LIMIT,
        });
        const output = [attempt.stdout, attempt.stderr].filter(Boolean).join("\n");
        const parsed = parseServerMergeOutput(output, separators);
        const matchingChangesets = parsed.changesets.filter((changeset) => changeset.branch === target.branch && changeset.repository === target.repository && changeset.mount === "/");
        const effect = "not-proven";
        const diagnostics = output.slice(0, 4_000);
        const baseData = {
            requestedIdentity,
            capability,
            command: ["cm", ...command],
            dispatched: true,
            exitCode: attempt.exitCode,
            aborted: attempt.aborted,
            timedOut: attempt.timedOut,
            outputTruncated: Boolean(attempt.stdoutTruncated || attempt.stderrTruncated),
            records: parsed.records,
            observedChangesets: parsed.changesets,
            diagnostics,
            mergeLinkIdentity: "unverified",
            xlinkEffects: "unverified",
            effect,
        };

        const ambiguous = attempt.aborted || attempt.timedOut || attempt.stdoutTruncated || attempt.stderrTruncated || parsed.malformed
            || parsed.unknownOperations.length > 0 || parsed.changesets.length > 1
            || (parsed.changesets.length > 0 && matchingChangesets.length !== 1)
            || (parsed.hasConflict && parsed.changesets.length > 0)
            || (parsed.isAlreadyConnected && (parsed.changesets.length > 0 || parsed.hasConflict));
        if (!ambiguous && attempt.exitCode === 0 && matchingChangesets.length === 1 && !parsed.hasConflict && !parsed.isAlreadyConnected)
        {
            const changeset = matchingChangesets[0]!;
            return formatServerMergeResult(format, "completed", `## Server Merge Completed\n\n- Created target changeset: cs:${changeset.id}\n- Merge-link identity: unverified\n- Xlink effects: unverified`, {
                ...baseData,
                createdChangeset: changeset,
                effect: "changeset-created",
            });
        }
        if (!ambiguous && attempt.exitCode === 0 && parsed.isAlreadyConnected && parsed.changesets.length === 0 && !parsed.hasConflict)
        {
            return formatServerMergeResult(format, "no-op", "## Server Merge No-op\n\n- Plastic reported ALREADY_CONNECTED.\n- Effect: not independently verified.", baseData);
        }
        if (!ambiguous && attempt.exitCode !== 0 && parsed.hasConflict && parsed.changesets.length === 0)
        {
            return formatServerMergeResult(format, "conflict", "## Server Merge Conflict\n\n- Plastic reported a file conflict.\n- Effect: uncertain; inspect the server before any retry.", { ...baseData, effect: "uncertain" });
        }
        return formatServerMergeResult(format, "uncertain", "## Server Merge Uncertain\n\n- The command may have had an effect, but its bounded output does not prove a safe classification.\n- Do not retry automatically; inspect server state first.", {
            ...baseData,
            effect: "uncertain",
            parseWarnings: {
                malformed: parsed.malformed,
                unknownOperations: parsed.unknownOperations,
                matchingChangesetCount: matchingChangesets.length,
            },
        });
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
        const parentLookup = args.target ? undefined : await resolveBranchParentName(sourceBranch, args.workdir);
        if (!args.target && parentLookup?.kind !== "resolved")
        {
            const details = parentLookup?.kind === "command-failed"
                ? ` Plastic lookup failed: ${parentLookup.diagnostics.join(" | ")}`
                : parentLookup?.kind === "malformed-output"
                    ? ` Plastic lookup returned unusable output: ${parentLookup.diagnostics.join(" | ")}`
                    : parentLookup?.kind === "root"
                        ? ` ${parentLookup.matchedBranch} is a root branch with no parent.`
                        : " Plastic found no matching branch row.";
            throw new Error(`Unable to resolve the parent branch for ${sourceBranch}. Pass target explicitly.${details}`);
        }
        const resolvedParentBranch = parentLookup?.kind === "resolved" ? parentLookup.parent : undefined;
        const targetBranch = args.target ?? resolvedParentBranch!;
        const strategy: MergeConflictStrategy = args.strategy ?? "auto";
        const updateTarget = args.updateTarget ?? true;
        const includePrivate = args.includePrivate ?? false;
        const cardLine = args.cardRef?.trim() ? `\n\n${args.cardRef.trim()}` : "";
        const checkinMessage = args.message?.trim()
            ? args.message.trim()
            : `Merge ${sourceBranch} into ${targetBranch}${cardLine}`;

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

        // Inspect the cancel policy as typed data before any target-side mutation.
        const pendingBeforeSwitchItems = await getMachineReadablePendingItems(args.workdir);
        const pendingBeforeSwitchDetailed = summarizePendingItems(pendingBeforeSwitchItems, args.workdir ?? process.cwd());
        const canceledSwitchOutcome = createCanceledSwitchOutcome(
            startingBranch,
            targetBranch,
            toLegacyPendingSummary(pendingBeforeSwitchDetailed),
            pendingBeforeSwitchDetailed,
            "cancel",
            false,
        );
        if (canceledSwitchOutcome)
        {
            return toStructuredResult(
                "merge-to-branch",
                format,
                [
                    "## Merge To Branch Blocked",
                    "",
                    `- Source branch: ${sourceBranch}`,
                    `- Target branch: ${targetBranch}`,
                    `- ${canceledSwitchOutcome.reason}`,
                    "- No switch, update, merge, checkin, or shelveset command was run.",
                ].join("\n"),
                {
                    sourceBranch,
                    targetBranch,
                    switchOutcome: canceledSwitchOutcome,
                    checkedIn: false,
                },
                args.workdir,
                [canceledSwitchOutcome.reason],
                "Resolve or shelve pending changes before retrying the merge closeout.",
            );
        }

        const switchResult = await switchBranch.execute({
            branch: targetBranch,
            pendingChanges: "cancel",
            format: "json",
            workdir: args.workdir,
        });
        const branchAfterSwitch = await resolveCurrentBranchName(args.workdir);
        assertWorkspaceOnBranch(branchAfterSwitch, targetBranch, "branch switch and before target update");
        const updateResult = updateTarget ? await update.execute({ workdir: args.workdir }) : "(skipped)";
        const branchBeforeMerge = await resolveCurrentBranchName(args.workdir);
        assertWorkspaceOnBranch(branchBeforeMerge, targetBranch, "target update and before merge");
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

        const branchBeforeCheckin = await resolveCurrentBranchName(args.workdir);
        assertWorkspaceOnBranch(branchBeforeCheckin, targetBranch, "merge and before checkin");

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
        assertWorkspaceOnBranch(finalBranch, targetBranch, "merge checkin");
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
