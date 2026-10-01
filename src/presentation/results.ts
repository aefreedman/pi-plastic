import { tool } from "../tool-definition";
import { getCmVersion } from "../execution/cli-version";

export const TOOL_VERSION = "v2.0.0";

export type OutputFormat = "text" | "json";

export const outputFormatArg = tool.schema.enum(["text", "json"]).optional().describe("Output format. Defaults to text.");

export const formatPreflightText = (title: string, lines: string[]): string =>
{
    return [title, "", ...lines].join("\n");
};

export const toStructuredResult = async (
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

export const formatServerMergeResult = async (
    format: OutputFormat,
    outcome: "preflight" | "completed" | "no-op" | "conflict" | "uncertain" | "unsupported",
    text: string,
    data: Record<string, unknown>,
): Promise<string> =>
{
    if (format === "text")
    {
        return text;
    }
    return `## merge-branches\n\n\`\`\`json\n${JSON.stringify({
        ok: outcome === "completed" || outcome === "preflight" || outcome === "no-op",
        action: "merge-branches",
        outcome,
        toolVersion: TOOL_VERSION,
        data,
    }, null, 2)}\n\`\`\``;
};
