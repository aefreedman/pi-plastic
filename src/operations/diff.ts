import { DIFF_OUTPUT_MAX_CHARS, isBinaryContent, stableDiffHeaders, boundDiffOutput, runPortableTextDiff, safeTempExtension, isAsciiPath, createAsciiTempDirectory, materializeRevision, isNoDataError, withWorkspaceBaseUnavailableDiagnostic, TextDiffResult } from "../diff/text";
import { DIFF_RESPONSE_DEFAULT_MAX_CHARS, DIFF_RESPONSE_MAX_CHARS, DIFF_RESPONSE_MIN_CHARS, DIFF_RESPONSE_TOTAL_MAX_CHARS, normalizeDiffResponseMaxChars, boundTextDiffResult, formatTextDiff, WORKSPACE_DIFF_PATH_MAX_CHARS, WORKSPACE_DIFF_MAX_PATHS, WORKSPACE_DIFF_MAX_FILES, WORKSPACE_DIFF_DEFAULT_MAX_FILES, WORKSPACE_DIFF_MIN_CHARS, WORKSPACE_DIFF_PER_FILE_MAX_CHARS, WORKSPACE_DIFF_DEFAULT_MAX_CHARS, boundWorkspaceValue, WORKSPACE_DIFF_CONTENT_MAX_CHARS, WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS, boundWorkspaceDiffResult, WORKSPACE_DIFF_ERROR_MAX_CHARS, workspacePathPreview, WORKSPACE_DIFF_TOTAL_MAX_CHARS, formatWorkspaceDiffResult } from "../presentation/diff-results";
import { resolveDiffFileRevision, isUnscopedDiffRevisionSpec, extractBranchSelectorFromRevision, extractBranchNameFromSelector, PendingBaseIdentityResolver, isRevisionNotFoundError, createPendingBaseIdentityResolver } from "../domain/revisions";
import { listRecentBranchNames } from "../domain/branches";
import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { BLOCKED_CM_DIFF_MESSAGE } from "../execution/cm";
import { outputFormatArg } from "../presentation/results";
import { join, isAbsolute } from "path";
import { promises as fs } from "node:fs";
import { PendingItem, getMachineReadablePendingItems, filterPendingItemsByScope } from "../domain/pending";
import { toNormalizedAbsolutePath, toCommandPath, toPathComparisonKeyFromAbsolutePath } from "../domain/paths";

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

export const buildRevisionNotFoundGuidance = async (resolvedRevision: string, path: string, workdir?: string): Promise<string | null> =>
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

export type WorkspacePendingDiff = {
    item?: PendingItem;
    workspacePath: string;
    displayPath: string;
    revisionPath: string;
    pendingKind: "added" | "changed" | "moved" | "deleted" | "private" | "other";
    result: TextDiffResult;
    comparisonKind: string;
};

export const diffPendingWorkspaceFile = async (
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
