import { OutputFormat, TOOL_VERSION } from "./results";
import { TextDiffResult } from "../diff/text";
import { getCmVersion } from "../execution/cli-version";

export const DIFF_RESPONSE_DEFAULT_MAX_CHARS = 8_000;

export const DIFF_RESPONSE_MAX_CHARS = 20_000;

export const DIFF_RESPONSE_MIN_CHARS = 500;

export const DIFF_RESPONSE_TOTAL_MAX_CHARS = 24_000;

export const normalizeDiffResponseMaxChars = (value: unknown): number =>
{
    if (typeof value !== "number" || !Number.isFinite(value))
    {
        return DIFF_RESPONSE_DEFAULT_MAX_CHARS;
    }
    return Math.min(DIFF_RESPONSE_MAX_CHARS, Math.max(DIFF_RESPONSE_MIN_CHARS, Math.trunc(value)));
};

export const formatTextDiff = async (
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

export const boundTextDiffResult = (result: TextDiffResult, maxChars: number): TextDiffResult =>
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

export const toBoundedDiffStructuredResult = async (
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

export const WORKSPACE_DIFF_DEFAULT_MAX_FILES = 3;

export const WORKSPACE_DIFF_MAX_FILES = 20;

export const WORKSPACE_DIFF_MAX_PATHS = 20;

export const WORKSPACE_DIFF_PATH_MAX_CHARS = 1_024;

export const WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS = 256;

export const WORKSPACE_DIFF_ERROR_MAX_CHARS = 1_024;

export const WORKSPACE_DIFF_DEFAULT_MAX_CHARS = 3_000;

export const WORKSPACE_DIFF_PER_FILE_MAX_CHARS = 8_000;

export const WORKSPACE_DIFF_MIN_CHARS = 500;
// This is a response bound, not just a diff-body bound. Reserve space for
// framing and an omission summary so both text and JSON remain useful.

export const WORKSPACE_DIFF_TOTAL_MAX_CHARS = 20_000;

export const WORKSPACE_DIFF_CONTENT_MAX_CHARS = 16_000;

export const boundWorkspaceValue = (value: string, maxChars: number): string =>
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

export const boundWorkspaceDiffResult = (result: TextDiffResult, maxChars: number): TextDiffResult =>
{
    if (result.output.length <= maxChars)
    {
        return result;
    }
    return { ...result, output: boundWorkspaceValue(result.output, maxChars), truncated: true };
};

export const workspacePathPreview = (paths: string[]): string[] => paths.map((path) => boundWorkspaceValue(path, WORKSPACE_DIFF_DISPLAY_PATH_MAX_CHARS));

export const appendBoundedWorkspaceText = (prefix: string, sections: string[], omitted: number): string =>
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

export const formatWorkspaceDiffResult = async (
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
