import { DIFF_OUTPUT_MAX_CHARS, isBinaryContent, stableDiffHeaders, boundDiffOutput, runPortableTextDiff, safeTempExtension, isAsciiPath, createAsciiTempDirectory, materializeRevision, isNoDataError, withWorkspaceBaseUnavailableDiagnostic, TextDiffResult } from "../diff/text";
import { DIFF_RESPONSE_DEFAULT_MAX_CHARS, DIFF_RESPONSE_MAX_CHARS, DIFF_RESPONSE_MIN_CHARS, DIFF_RESPONSE_TOTAL_MAX_CHARS, normalizeDiffResponseMaxChars, boundTextDiffResult, formatTextDiff, WORKSPACE_DIFF_PATH_MAX_CHARS, WORKSPACE_DIFF_MAX_PATHS, WORKSPACE_DIFF_MAX_FILES, WORKSPACE_DIFF_DEFAULT_MAX_FILES, WORKSPACE_DIFF_MIN_CHARS, WORKSPACE_DIFF_PER_FILE_MAX_CHARS, WORKSPACE_DIFF_DEFAULT_MAX_CHARS, boundWorkspaceValue, WORKSPACE_DIFF_CONTENT_MAX_CHARS, WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS, boundWorkspaceDiffResult, WORKSPACE_DIFF_ERROR_MAX_CHARS, workspacePathPreview, WORKSPACE_DIFF_TOTAL_MAX_CHARS, formatWorkspaceDiffResult } from "../presentation/diff-results";
import { resolveDiffFileRevision, isUnscopedDiffRevisionSpec, extractBranchSelectorFromRevision, extractBranchNameFromSelector, PendingBaseIdentityResolver, isRevisionNotFoundError, createPendingBaseIdentityResolver } from "../domain/revisions";
import { listRecentBranchNames } from "../domain/branches";
import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { outputFormatArg } from "../presentation/results";
import { join, isAbsolute } from "path";
import { promises as fs } from "node:fs";
import { PendingItem, getMachineReadablePendingItems, filterPendingItemsByScope } from "../domain/pending";
import { toNormalizedAbsolutePath, toCommandPath, toPathComparisonKeyFromAbsolutePath } from "../domain/paths";
import { assembleConsolidatedDiff } from "./consolidated-diff";

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

export const diff = tool({
    description: "Bounded non-GUI comparison. Require mode=file (one local file versus loaded base or revision), revisions (two historical selectors), or workspace (explicit pending paths or allPending=true). No implicit whole-workspace review.",
    args: {
        mode: tool.schema.enum(["file","revisions","workspace"]),
        path: tool.schema.string().optional(),
        revision: tool.schema.string().optional(),
        leftRevision: tool.schema.string().optional(),
        rightRevision: tool.schema.string().optional(),
        paths: tool.schema.array(tool.schema.string()).optional(),
        allPending: tool.schema.boolean().optional(),
        includePrivate: tool.schema.boolean().optional(),
        maxFiles: tool.schema.number().optional(),
        maxChars: tool.schema.number().optional(),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    execute: async args => assembleConsolidatedDiff(args),
});
