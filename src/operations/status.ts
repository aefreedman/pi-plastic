import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { MACHINE_READABLE_STATUS_MAX_ITEMS, MACHINE_READABLE_STATUS_DEFAULT_MAX_ITEMS, STATUS_FIELD_SEPARATOR, diagnoseMachineReadablePendingItems, toMachineReadableStatusItems, toMachineReadableStatusSummary, summarizeShortStatus } from "../domain/pending";
import { outputFormatArg, toStructuredResult, formatStatusText } from "../presentation/results";
import { runStatusCommand } from "../execution/status-command";
import { analyzeMergeStatusOutput } from "../domain/merge-output";

export type StatusObservationOptions = {
    workdir?: string;
    short?: boolean;
    includeRevId?: boolean;
    machineReadable?: boolean;
};

// Internal observations precede presentation; no version lookup or rendered-text parsing.
export const assembleStatusObservation = async (args: StatusObservationOptions) =>
{
    const cmdArgs: string[] = ["status"];
    if (args.short) cmdArgs.push("--short");
    if (args.includeRevId) cmdArgs.push("--includeRevId");
    if (args.machineReadable)
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
        maxItems: tool.schema.number().int().min(1).max(MACHINE_READABLE_STATUS_MAX_ITEMS).optional().describe(`Maximum parsed items in machine-readable JSON (default ${MACHINE_READABLE_STATUS_DEFAULT_MAX_ITEMS}, maximum ${MACHINE_READABLE_STATUS_MAX_ITEMS}).`),
        includeRaw: tool.schema.boolean().optional().describe("Include unbounded raw machine-readable Plastic output in JSON diagnostics. Applies only when machineReadable=true."),
        short: tool.schema.boolean().optional().describe("Use short status output."),
        format: outputFormatArg,
    },
    async execute(args)
    {
        return presentStatusObservation(await assembleStatusObservation(args), args);
    },
});
