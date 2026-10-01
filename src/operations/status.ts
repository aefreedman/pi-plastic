import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { MACHINE_READABLE_STATUS_MAX_ITEMS, MACHINE_READABLE_STATUS_DEFAULT_MAX_ITEMS, STATUS_FIELD_SEPARATOR, diagnoseMachineReadablePendingItems, toMachineReadableStatusItems, toMachineReadableStatusSummary, summarizeShortStatus } from "../domain/pending";
import { outputFormatArg, toStructuredResult, formatStatusText } from "../presentation/results";
import { runStatusCommand, StatusCommandError } from "../execution/status-command";
import { getActiveAbortSignal } from "../execution/context";
import { analyzeMergeStatusOutput } from "../domain/merge-output";
import { parseStatusXml } from "../domain/status-xml";
import { runStatusXmlCommand } from "../execution/status-xml-command";

export class StatusOptionError extends Error {
    constructor() { super("Status source options are conflicting or unsupported. XML does not support short or base revision requests."); }
}
export const resolveStatusSource = (args: StatusObservationOptions): "text" | "machine" | "xml" => {
    const source = args.source ?? (args.machineReadable ? "machine" : "text");
    if (!["text", "machine", "xml"].includes(source) || (source === "machine" && args.machineReadable === false) || (source !== "machine" && args.machineReadable === true) || (source === "xml" && (args.short || args.includeRevId))) throw new StatusOptionError();
    return source;
};

export type StatusObservationOptions = {
    workdir?: string;
    short?: boolean;
    includeRevId?: boolean;
    machineReadable?: boolean;
    source?: "text" | "machine" | "xml";
};

// Internal observations precede presentation; no version lookup or rendered-text parsing.
export const assembleStatusObservation = async (args: StatusObservationOptions) =>
{
    const source = resolveStatusSource(args);
    if (source === "xml") {
        const bytes = await runStatusXmlCommand(args.workdir);
        if (getActiveAbortSignal()?.aborted) throw new StatusCommandError("aborted");
        const parsed = parseStatusXml(bytes);
        // Whole-document DOM parsing is synchronous; cancellation is checked at its boundaries.
        if (getActiveAbortSignal()?.aborted) throw new StatusCommandError("aborted");
        return { kind: "xml" as const, ...parsed, capture: "complete" as const, requestedShort: false as const };
    }
    const cmdArgs: string[] = ["status"];
    if (args.short) cmdArgs.push("--short");
    if (args.includeRevId) cmdArgs.push("--includeRevId");
    if (source === "machine")
    {
        // Package-owned separators make paths with whitespace unambiguous, and
        // revision IDs let agents safely identify the base of moved/deleted items.
        if (!cmdArgs.includes("--includeRevId")) cmdArgs.push("--includeRevId");
        cmdArgs.push("--machinereadable", `--fieldseparator=${STATUS_FIELD_SEPARATOR}`);
        const { output, capture } = await runStatusCommand(cmdArgs, args.workdir, true);
        const cwd = args.workdir ?? process.cwd();
        return { kind: "machine" as const, output, capture, cwd, ...diagnoseMachineReadablePendingItems(output, cwd), requestedShort: args.short ?? false };
    }
    const primary = await runStatusCommand(cmdArgs, args.workdir);
    const secondary = await runStatusCommand(["status", "--short"], args.workdir, true);
    const output = primary.output;
    const shortOutput = secondary.output;
    return {
        kind: "standard" as const,
        capture: secondary.capture,
        output,
        shortOutput,
        summary: summarizeShortStatus(shortOutput),
        mergeState: analyzeMergeStatusOutput(output),
        usedShortFlag: args.short ?? false,
    };
};
export type StatusObservation = Awaited<ReturnType<typeof assembleStatusObservation>>;

export const presentStatusObservation = async (observation: StatusObservation, args: { format?: "text" | "json"; maxItems?: number; includeRaw?: boolean; workdir?: string }) =>
{
        const format = args.format ?? "text";
        if (observation.kind === "xml") {
            const items = observation.items.slice(0, args.maxItems ?? MACHINE_READABLE_STATUS_DEFAULT_MAX_ITEMS);
            const source = { transport: "status_xml", encoding: "utf-8", pathBasis: "absolute", scope: "workspace", baseRevisionAvailability: "unavailable" };
            const warning = "Raw XML contains private workspace/repository/server metadata.";
            const text = [`Status XML (synthesized; workspace scope; base revisions unavailable): ${observation.items.length} records.`, ...items.map(row => `${row.statusCode} ${row.sourcePath ? `${row.sourcePath} -> ` : ""}${row.path}${row.isDirectory ? " [directory]" : ""}`), ...(items.length < observation.items.length ? [`${observation.items.length - items.length} records omitted.`] : [])].join("\n");
            if (format === "json") return JSON.stringify({ ok: true, action: "status", data: { mode: "xml", presentation: "synthesized", source, items, summary: observation.summary, itemCount: { parsed: observation.items.length, returned: items.length, omitted: observation.items.length - items.length }, ...(args.includeRaw ? { rawXml: observation.output, rawWarning: warning } : {}) } });
            return args.includeRaw ? `${text}\n\n${warning}\nRaw status_xml (utf-8):\n${observation.output}` : text;
        }
        if (observation.kind === "machine")
        {
            const { output: machineOutput, pendingItems, cwd } = observation;
            const maxItems = args.maxItems ?? MACHINE_READABLE_STATUS_DEFAULT_MAX_ITEMS;
            const returnedItems = pendingItems.slice(0, maxItems);
            return toStructuredResult(
                "status",
                format,
                machineOutput,
                {
                    machineReadable: true,
                    items: toMachineReadableStatusItems(returnedItems),
                    itemCount: {
                        total: pendingItems.length,
                        returned: returnedItems.length,
                        omitted: pendingItems.length - returnedItems.length,
                    },
                    summary: toMachineReadableStatusSummary(pendingItems, cwd),
                    ...(args.includeRaw ? { rawOutput: machineOutput } : {}),
                },
                args.workdir,
            );
        }
        const { output, shortOutput, summary, mergeState, usedShortFlag } = observation;
        const textOutput = formatStatusText(output, mergeState);
        return toStructuredResult(
            "status", format, textOutput,
            { rawOutput: output, shortOutput, summary, mergeState, usedShortFlag },
            args.workdir,
        );
};

export const status = tool({
    description: "Show Plastic SCM workspace status (cm status).",
    args: {
        workdir: workdirArg,
        includeRevId: tool.schema.boolean().optional().describe("Include revision IDs in the status output when supported."),
        machineReadable: tool.schema.boolean().optional().describe("Return parsed, machine-readable pending status records when supported."),
        source: tool.schema.enum(["text", "machine", "xml"]).optional().describe("Explicit status source; omitted preserves machineReadable. XML is UTF-8, workspace-scoped, absolute paths, no short/base revisions, with synthesized presentation."),
        maxItems: tool.schema.number().int().min(1).max(MACHINE_READABLE_STATUS_MAX_ITEMS).optional().describe(`Maximum parsed items in machine-readable JSON (default ${MACHINE_READABLE_STATUS_DEFAULT_MAX_ITEMS}, maximum ${MACHINE_READABLE_STATUS_MAX_ITEMS}).`),
        includeRaw: tool.schema.boolean().optional().describe("Include raw machine output in JSON diagnostics, or bounded XML with a private metadata warning. Never included in the compact native DTO."),
        short: tool.schema.boolean().optional().describe("Use short status output."),
        format: outputFormatArg,
    },
    async execute(args)
    {
        return presentStatusObservation(await assembleStatusObservation(args), args);
    },
});
