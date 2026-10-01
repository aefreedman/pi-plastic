import { normalizeFindOutputLines } from "../execution/cm";

export type MergeStatusSummary = {
    hasPendingMergeLinks: boolean;
    pendingMergeLinks: string[];
    mergeInProgressHints: string[];
    hasMergeInProgress: boolean;
};

export const analyzeMergeStatusOutput = (output: string): MergeStatusSummary =>
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

export type MergeMachineReadableRecord = {
    raw: string;
    fields: string[];
    operation: string;
};

export type MergeOutputSummary = {
    recordCount: number;
    conflictSignals: string[];
    unresolvedSignals: string[];
    warningSignals: string[];
    fileConflictSignals: string[];
    fileConflictPaths: string[];
};

export const MERGE_START_LINE_SEPARATOR = "__OC_MR_START__";
export const MERGE_END_LINE_SEPARATOR = "__OC_MR_END__";
export const MERGE_FIELD_SEPARATOR = "__OC_MR_FIELD__";

export const mergeConflictSignalPattern = /\b(conflict|eviltwin|changedelete|deletechange|movedelete|deletemove|loadedtwice|addmove|moveadd|divergentmove|cyclemove|movedeviltwin)\b/i;
export const mergeUnresolvedSignalPattern = /\b(unresolved|cannot\s+resolve|can't\s+resolve|manual\s+conflict|not\s+solved|failed\s+to\s+resolve)\b/i;
export const mergeWarningSignalPattern = /\bwarn(?:ing)?\b/i;
export const mergeFileConflictOperation = "FILE_CONFLICT";

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeErrorMessage = (error: unknown): string =>
{
    if (error instanceof Error)
    {
        return error.message;
    }

    return String(error ?? "Unknown error");
};

export const parseMergeMachineReadableRecords = (output: string): MergeMachineReadableRecord[] =>
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

export const summarizeMergeOutput = (output: string): MergeOutputSummary =>
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

export type ServerMergeRecord = {
    operation: string;
    fields: string[];
};

export type ServerMergeParse = {
    records: ServerMergeRecord[];
    malformed: boolean;
    unknownOperations: string[];
    changesets: Array<{ id: string; branch: string; repository: string; mount: string }>;
    isAlreadyConnected: boolean;
    hasConflict: boolean;
};

export const parseServerMergeOutput = (output: string, separators: { start: string; end: string; field: string }): ServerMergeParse =>
{
    const records: ServerMergeRecord[] = [];
    const unknownOperations = new Set<string>();
    let malformed = false;
    let cursor = 0;

    while (true)
    {
        const start = output.indexOf(separators.start, cursor);
        if (start < 0)
        {
            if (output.slice(cursor).includes(separators.end) || output.slice(cursor).includes(separators.field))
            {
                malformed = true;
            }
            break;
        }
        const prefix = output.slice(cursor, start);
        if (prefix.includes(separators.end) || prefix.includes(separators.field))
        {
            malformed = true;
        }
        const payloadStart = start + separators.start.length;
        const end = output.indexOf(separators.end, payloadStart);
        if (end < 0)
        {
            malformed = true;
            break;
        }
        const payload = output.slice(payloadStart, end);
        if (!payload || payload.includes(separators.start) || payload.includes(separators.end))
        {
            malformed = true;
        }
        else
        {
            const fields = payload.split(separators.field);
            const operation = fields[0] ?? "";
            if (!operation || fields.some((field) => field.length === 0))
            {
                malformed = true;
            }
            else
            {
                records.push({ operation, fields });
                if (!["FILE_SRC", "CHANGESET", "STATUS", "FILE_CONFLICT"].includes(operation))
                {
                    unknownOperations.add(operation);
                    malformed = true;
                }
            }
        }
        cursor = end + separators.end.length;
    }

    const changesets: Array<{ id: string; branch: string; repository: string; mount: string }> = [];
    let isAlreadyConnected = false;
    let hasConflict = false;
    for (const record of records)
    {
        switch (record.operation)
        {
            case "FILE_SRC":
                if (record.fields.length !== 5 || !record.fields[1]?.startsWith("/") || !record.fields.slice(2).every((field) => /^\d+$/.test(field)))
                {
                    malformed = true;
                }
                break;
            case "CHANGESET":
            {
                if (record.fields.length !== 2)
                {
                    malformed = true;
                    break;
                }
                const match = record.fields[1]?.match(/^cs:(\d+)@(?<branch>\/[^@]+)@(?<repository>[^@]+) \(mount:'(?<mount>[^']+)'\)$/);
                if (!match?.groups)
                {
                    malformed = true;
                    break;
                }
                changesets.push({
                    id: match[1]!,
                    branch: match.groups.branch!,
                    repository: match.groups.repository!,
                    mount: match.groups.mount!,
                });
                break;
            }
            case "STATUS":
                if (record.fields.length !== 3 || record.fields[1] !== "ALREADY_CONNECTED" || record.fields[2] !== "No merges detected" || isAlreadyConnected)
                {
                    malformed = true;
                }
                isAlreadyConnected = true;
                break;
            case "FILE_CONFLICT":
                if (record.fields.length !== 6 || !record.fields[1]?.startsWith("/") || !record.fields.slice(2).every((field) => /^\d+$/.test(field)))
                {
                    malformed = true;
                }
                hasConflict = true;
                break;
            default:
                // Unknown operations were recorded above and make the response uncertain.
                break;
        }
    }
    return { records, malformed, unknownOperations: [...unknownOperations], changesets, isAlreadyConnected, hasConflict };
};
