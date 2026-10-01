import { toPathComparisonKeyFromAbsolutePath, isSameFilesystemDevice, buildFallbackScopePaths } from "../domain/paths";
import { inferPendingItemKind, parseMachineReadablePendingItems, summarizePendingItems, getSensitivePrivatePathReason, selectPrivatePathsForAutoAdd, filterPendingItemsByScope, resolveCheckinPaths, getMachineReadablePendingItems, PendingItem, PendingItemSummary, formatPendingPathPreview } from "../domain/pending";
import { isRevisionNotFoundError, normalizeDiffFileRevisionSpec, resolveDiffFileRevision, isUnscopedDiffRevisionSpec, extractBranchSelectorFromRevision, extractBranchNameFromSelector } from "../domain/revisions";
import { runCmRaw, runCm } from "../execution/cm";
import { analyzeMergeStatusOutput, normalizeErrorMessage } from "../domain/merge-output";
import { tool } from "../tool-definition";
import { outputFormatArg, toStructuredResult, formatPreflightText } from "../presentation/results";
import { workdirArg } from "./arguments";

export const shouldRetryCheckinWithFallbackScope = (errorMessage: string): boolean =>
{
    const normalized = errorMessage.toLowerCase();
    return normalized.includes("is not changed in current workspace")
        || normalized.includes("none of the provided checkin paths have pending changes")
        || normalized.includes("is not changed in current workspace.")
        || normalized.includes("none of the provided checkin paths");
};

export const isNoChangesWorkspaceCheckinError = (errorMessage: string): boolean =>
{
    const normalized = errorMessage.toLowerCase();
    return normalized.includes("there are no changes in the workspace")
        || normalized.includes("no changes in the workspace");
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

export const isMergeInProgressCheckinError = (message: string): boolean =>
{
    return /checkin operation cannot be started because there is a merge in progress|finish it before checkin|in progress merge/i.test(message);
};

export const buildMergeInProgressCheckinMessage = async (originalMessage: string, workdir?: string): Promise<string> =>
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
