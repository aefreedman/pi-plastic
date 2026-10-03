import { assembleCheckinReceipt } from "./checkin-receipt";
import { presentCheckinReceipt } from "../presentation/checkin-results";
import { toPathComparisonKeyFromAbsolutePath, isSameFilesystemDevice, buildFallbackScopePaths } from "../domain/paths";
import { inferPendingItemKind, parseMachineReadablePendingItems, summarizePendingItems, getSensitivePrivatePathReason, selectPrivatePathsForAutoAdd, filterPendingItemsByScope, resolveCheckinPaths } from "../domain/pending";
import { isRevisionNotFoundError, normalizeDiffFileRevisionSpec, resolveDiffFileRevision, isUnscopedDiffRevisionSpec, extractBranchSelectorFromRevision, extractBranchNameFromSelector } from "../domain/revisions";
import { runCmRaw } from "../execution/cm";
import { analyzeMergeStatusOutput } from "../domain/merge-output";
import { tool } from "../tool-definition";
import { outputFormatArg } from "../presentation/results";
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
        const dto = await assembleCheckinReceipt(args);
        if (!dto.ok && !args.preflight) throw new Error(dto.error.message);
        return presentCheckinReceipt(dto, args.format);
    },
});
