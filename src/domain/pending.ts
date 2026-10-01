import { dirname } from "path";
import { runCmRaw, normalizeFindOutputLines } from "../execution/cm";
import { toNormalizedAbsolutePath, toPathComparisonKeyFromAbsolutePath, toPathComparisonKey, toCommandPath, isWithinPathScope, dedupeAndMinimizeAbsolutePaths } from "./paths";

export type PendingItemKind = "added" | "changed" | "moved" | "deleted" | "private" | "other";

export type PendingItem = {
    statusCode: string;
    workspacePath: string;
    normalizedPath: string;
    comparisonKey: string;
    isDirectory: boolean;
    kind: PendingItemKind;
    revisionId?: string;
    sourceWorkspacePath?: string;
    baseRepository?: string;
};

export type PendingItemSummary = {
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

export type MachineReadableStatusItem = {
    statusCode: string;
    kind: PendingItemKind;
    path: string;
    isDirectory: boolean;
    revisionId?: string;
    sourcePath?: string;
};

export type MachineReadableStatusSummary = Omit<PendingItemSummary, "privatePaths">;

export const MACHINE_READABLE_STATUS_DEFAULT_MAX_ITEMS = 100;
export const MACHINE_READABLE_STATUS_MAX_ITEMS = 500;

export type PrivateAutoAddSelection = {
    candidatePaths: string[];
    blockedPaths: Array<{ path: string; reason: string }>;
};

export type ResolvedCheckinPaths = {
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

export const inferPendingItemKind = (statusCode: string): PendingItemKind =>
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
export const STATUS_FIELD_SEPARATOR = "\x1f";

export const parseMachineReadablePendingItems = (output: string, cwd: string): PendingItem[] =>
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

export const getMachineReadablePendingItems = async (workdir?: string): Promise<PendingItem[]> =>
{
    const cwd = workdir ?? process.cwd();
    const output = await runCmRaw(["status", "--machinereadable", "--includeRevId", `--fieldseparator=${STATUS_FIELD_SEPARATOR}`], workdir);
    return parseMachineReadablePendingItems(output, cwd);
};

export const toMachineReadableStatusItems = (pendingItems: PendingItem[]): MachineReadableStatusItem[] =>
    pendingItems.map((item) => ({
        statusCode: item.statusCode,
        kind: item.kind,
        path: item.workspacePath,
        isDirectory: item.isDirectory,
        ...(item.revisionId ? { revisionId: item.revisionId } : {}),
        ...(item.sourceWorkspacePath ? { sourcePath: item.sourceWorkspacePath } : {}),
    }));

export const toMachineReadableStatusSummary = (pendingItems: PendingItem[], cwd: string): MachineReadableStatusSummary =>
{
    const { privatePaths: _privatePaths, ...summary } = summarizePendingItems(pendingItems, cwd);
    return summary;
};

export const summarizePendingItems = (pendingItems: PendingItem[], cwd?: string): PendingItemSummary =>
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

export const formatPendingPathPreview = (pendingItems: PendingItem[], cwd: string, limit = 5): string =>
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

export const SENSITIVE_PRIVATE_PATH_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
    { label: "dotenv", pattern: /(^|\/)\.env(\.|$)/i },
    { label: "private-key", pattern: /\.(pem|key|pfx|p12|jks|keystore|ppk)$/i },
    { label: "ssh-key", pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i },
    { label: "credentials-json", pattern: /(^|\/)(credentials|secrets?)\.json$/i },
    { label: "npmrc", pattern: /(^|\/)\.npmrc$/i },
];

export const getSensitivePrivatePathReason = (pathValue: string): string | null =>
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

export const selectPrivatePathsForAutoAdd = (
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

export const filterPendingItemsByScope = (pendingItems: PendingItem[], scopedAbsolutePaths: string[]): PendingItem[] =>
{
    if (scopedAbsolutePaths.length === 0)
    {
        return pendingItems;
    }

    const scopedComparisonKeys = scopedAbsolutePaths.map((path) => toPathComparisonKeyFromAbsolutePath(path));
    return pendingItems.filter((item) => scopedComparisonKeys.some((scopePath) => isWithinPathScope(item.comparisonKey, scopePath)));
};

export const resolveCheckinPaths = (requestedPaths: string[], pendingItems: PendingItem[], cwd: string): ResolvedCheckinPaths =>
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

export type PendingSummary = {
    totalPending: number;
    added: number;
    changed: number;
    moved: number;
    deleted: number;
    other: number;
};

export const summarizeShortStatus = (output: string): PendingSummary =>
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
