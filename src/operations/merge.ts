import { MergeOutputSummary, MERGE_START_LINE_SEPARATOR, MERGE_END_LINE_SEPARATOR, MERGE_FIELD_SEPARATOR, normalizeErrorMessage, summarizeMergeOutput, analyzeMergeStatusOutput } from "../domain/merge-output";
import { tool } from "../tool-definition";
import { outputFormatArg, toStructuredResult, formatPreflightText } from "../presentation/results";
import { workdirArg } from "./arguments";
import { runCm, runCmRaw } from "../execution/cm";
import { summarizeShortStatus } from "../domain/pending";

export type MergeConflictStrategy = "auto" | "source" | "destination";

export const buildMergeAbortMessage = (
    source: string,
    strategy: MergeConflictStrategy,
    output: string,
    summary: MergeOutputSummary,
): string =>
{
    const lines: string[] = [
        "Merge requires resolution/finalization before checkin.",
        `Source: ${source}`,
        `Strategy: ${strategy}`,
        `Conflict signals: ${summary.conflictSignals.length}`,
        `File conflicts: ${summary.fileConflictPaths.length}`,
        `Unresolved signals: ${summary.unresolvedSignals.length}`,
    ];

    if (summary.fileConflictPaths.length > 0)
    {
        lines.push("File conflict paths:");
        for (const conflictPath of summary.fileConflictPaths.slice(0, 20))
        {
            lines.push(`- ${conflictPath}`);
        }
    }

    if (summary.conflictSignals.length > 0)
    {
        lines.push("Conflict details:");
        for (const signal of summary.conflictSignals.slice(0, 20))
        {
            lines.push(`- ${signal}`);
        }
    }

    if (summary.unresolvedSignals.length > 0)
    {
        lines.push("Unresolved details:");
        for (const signal of summary.unresolvedSignals.slice(0, 20))
        {
            lines.push(`- ${signal}`);
        }
    }

    if (output.trim().length > 0)
    {
        lines.push("Raw merge output:");
        lines.push(output.trim());
    }

    lines.push("Review and resolve the listed files, run validation, then run plastic_finalizeMerge(source=..., strategy=destination) or rerun plastic_merge(...) with an explicit source/destination strategy when that policy is intentional.");
    return lines.join("\n");
};

export const merge = tool({
    description: "Merge safely with explicit non-interactive conflict strategy (cm merge --merge --nointeractiveresolution).",
    args: {
        source: tool.schema.string().min(1).describe("Source branch/changeset/label/shelveset spec to merge from."),
        strategy: tool.schema.enum(["auto", "source", "destination"]).optional().describe("Conflict resolution strategy. auto tries non-destructive auto-resolution and aborts if manual conflict remains. source/destination are explicit overrides."),
        cherrypicking: tool.schema.boolean().optional().describe("Enable cherry-picking mode."),
        forced: tool.schema.boolean().optional().describe("Skip connected-branch checks when supported by the merge mode."),
        preflight: tool.schema.boolean().optional().describe("Preview command without executing merge."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const preflight = args.preflight ?? false;
        const strategy: MergeConflictStrategy = args.strategy ?? "auto";
        const cmdArgs: string[] = [
            "merge",
            args.source,
            "--merge",
            "--nointeractiveresolution",
            "--machinereadable",
            `--startlineseparator=${MERGE_START_LINE_SEPARATOR}`,
            `--endlineseparator=${MERGE_END_LINE_SEPARATOR}`,
            `--fieldseparator=${MERGE_FIELD_SEPARATOR}`,
        ];

        let conflictPolicyDescription = "auto-try-abort-on-unresolved";

        if (strategy === "auto")
        {
            cmdArgs.push("--mergetype=try");
        }
        else
        {
            const prefersSource = strategy === "source";
            const strategyFlag = prefersSource ? "--keepsource" : "--keepdestination";
            const strategySuffix = prefersSource ? "src" : "dst";
            cmdArgs.push("--mergetype=forced", strategyFlag, `--automaticresolution=all-${strategySuffix}`);
            conflictPolicyDescription = prefersSource
                ? "forced-prefer-source"
                : "forced-prefer-destination";
        }

        if (args.cherrypicking)
        {
            cmdArgs.push("--cherrypicking");
        }

        if (args.forced)
        {
            cmdArgs.push("--forced");
        }

        if (preflight)
        {
            return toStructuredResult(
                "merge-preflight",
                format,
                formatPreflightText("## Merge Preflight", [
                    "- Would run: yes",
                    "- Strategy: non-interactive",
                    `- Conflict strategy: ${strategy}`,
                    `- Conflict policy: ${conflictPolicyDescription}`,
                    `- Command: cm ${cmdArgs.join(" ")}`,
                ]),
                {
                    wouldRun: true,
                    strategy: "non-interactive",
                    conflictStrategy: strategy,
                    conflictPolicy: conflictPolicyDescription,
                    command: ["cm", ...cmdArgs],
                    source: args.source,
                },
                args.workdir,
            );
        }

        let output: string;
        try
        {
            output = await runCm(cmdArgs, args.workdir);
        }
        catch (error)
        {
            const errorOutput = normalizeErrorMessage(error);
            const summary = summarizeMergeOutput(errorOutput);
            throw new Error(buildMergeAbortMessage(args.source, strategy, errorOutput, summary));
        }

        const summary = summarizeMergeOutput(output);
        if (summary.unresolvedSignals.length > 0)
        {
            throw new Error(buildMergeAbortMessage(args.source, strategy, output, summary));
        }

        const shortStatusAfterMerge = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const fullStatusAfterMerge = await runCmRaw(["status"], args.workdir).catch(() => "");
        const pendingSummaryAfterMerge = summarizeShortStatus(shortStatusAfterMerge);
        const mergeStateAfterMerge = analyzeMergeStatusOutput(fullStatusAfterMerge);
        const reportLines: string[] = [
            "## Merge Result",
            "",
            `- Source: ${args.source}`,
            `- Conflict strategy: ${strategy}`,
            `- Conflict policy: ${conflictPolicyDescription}`,
            `- Merge conflict signals: ${summary.conflictSignals.length}`,
            `- File conflict paths: ${summary.fileConflictPaths.length}`,
            `- Merge warning signals: ${summary.warningSignals.length}`,
            `- Pending items after merge: ${pendingSummaryAfterMerge.totalPending}`,
            `- Pending merge links after merge: ${mergeStateAfterMerge.pendingMergeLinks.length}`,
            `- Merge-in-progress hints after merge: ${mergeStateAfterMerge.mergeInProgressHints.length}`,
        ];

        if (summary.conflictSignals.length > 0)
        {
            reportLines.push("", "Conflict signal details:");
            for (const signal of summary.conflictSignals.slice(0, 20))
            {
                reportLines.push(`- ${signal}`);
            }
        }

        if (summary.warningSignals.length > 0)
        {
            reportLines.push("", "Warning signal details:");
            for (const signal of summary.warningSignals.slice(0, 20))
            {
                reportLines.push(`- ${signal}`);
            }
        }

        if (output.trim().length > 0 && output.trim() !== "(no output)")
        {
            reportLines.push("", "Raw merge output:", output.trim());
        }

        const warnings: string[] = [
            `Merged conflict signals reported by Plastic: ${summary.conflictSignals.length}.`,
        ];

        return toStructuredResult(
            "merge",
            format,
            reportLines.join("\n"),
            {
                strategy: "non-interactive",
                conflictStrategy: strategy,
                conflictPolicy: conflictPolicyDescription,
                command: ["cm", ...cmdArgs],
                source: args.source,
                mergeSummary: summary,
                shortStatusAfterMerge,
                pendingSummaryAfterMerge,
                fullStatusAfterMerge,
                mergeStateAfterMerge,
                rawOutput: output,
            },
            args.workdir,
            warnings,
        );
    },
});

export const finalizeMerge = tool({
    description: "Finalize Plastic merge metadata after manual conflict resolution using an explicit non-interactive source/destination policy.",
    args: {
        source: tool.schema.string().min(1).describe("Original source branch/changeset/label/shelveset spec being merged."),
        strategy: tool.schema.enum(["source", "destination"]).optional().describe("Explicit finalization policy. destination preserves destination/manual workspace resolution in typical post-resolution flows; source accepts source where Plastic still needs a policy."),
        preflight: tool.schema.boolean().optional().describe("Preview finalization command without executing it."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const preflight = args.preflight ?? false;
        const strategy = args.strategy ?? "destination";
        const prefersSource = strategy === "source";
        const strategyFlag = prefersSource ? "--keepsource" : "--keepdestination";
        const strategySuffix = prefersSource ? "src" : "dst";
        const cmdArgs: string[] = [
            "merge",
            args.source,
            "--merge",
            "--nointeractiveresolution",
            "--mergetype=forced",
            strategyFlag,
            `--automaticresolution=all-${strategySuffix}`,
            "--machinereadable",
            `--startlineseparator=${MERGE_START_LINE_SEPARATOR}`,
            `--endlineseparator=${MERGE_END_LINE_SEPARATOR}`,
            `--fieldseparator=${MERGE_FIELD_SEPARATOR}`,
        ];

        if (preflight)
        {
            return toStructuredResult(
                "finalize-merge-preflight",
                format,
                formatPreflightText("## Merge Finalization Preflight", [
                    "- Would run: yes",
                    `- Source: ${args.source}`,
                    `- Strategy: ${strategy}`,
                    `- Command: cm ${cmdArgs.join(" ")}`,
                    "- Use this only after reviewing/resolving files and validating the workspace.",
                ]),
                {
                    wouldRun: true,
                    source: args.source,
                    strategy,
                    command: ["cm", ...cmdArgs],
                },
                args.workdir,
            );
        }

        const output = await runCm(cmdArgs, args.workdir);
        const summary = summarizeMergeOutput(output);
        const shortStatusAfterFinalize = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const fullStatusAfterFinalize = await runCmRaw(["status"], args.workdir).catch(() => "");
        const pendingSummaryAfterFinalize = summarizeShortStatus(shortStatusAfterFinalize);
        const mergeStateAfterFinalize = analyzeMergeStatusOutput(fullStatusAfterFinalize);
        const reportLines: string[] = [
            "## Merge Finalization Result",
            "",
            `- Source: ${args.source}`,
            `- Strategy: ${strategy}`,
            `- Conflict signals from finalization command: ${summary.conflictSignals.length}`,
            `- File conflict paths from finalization command: ${summary.fileConflictPaths.length}`,
            `- Pending items after finalization: ${pendingSummaryAfterFinalize.totalPending}`,
            `- Pending merge links after finalization: ${mergeStateAfterFinalize.pendingMergeLinks.length}`,
            `- Merge-in-progress hints after finalization: ${mergeStateAfterFinalize.mergeInProgressHints.length}`,
        ];

        if (summary.fileConflictPaths.length > 0)
        {
            reportLines.push("", "File conflict paths reported during finalization:");
            for (const conflictPath of summary.fileConflictPaths.slice(0, 20))
            {
                reportLines.push(`- ${conflictPath}`);
            }
        }

        if (output.trim().length > 0 && output.trim() !== "(no output)")
        {
            reportLines.push("", "Raw finalization output:", output.trim());
        }

        return toStructuredResult(
            "finalize-merge",
            format,
            reportLines.join("\n"),
            {
                source: args.source,
                strategy,
                command: ["cm", ...cmdArgs],
                mergeSummary: summary,
                shortStatusAfterFinalize,
                fullStatusAfterFinalize,
                pendingSummaryAfterFinalize,
                mergeStateAfterFinalize,
                rawOutput: output,
            },
            args.workdir,
            [
                "Review plastic_status() before checkin. Pending merge links are expected until the merge result is checked in; merge-in-progress hints are not.",
            ],
            mergeStateAfterFinalize.hasMergeInProgress
                ? "Resolve remaining merge-in-progress state before checkin."
                : "If validation passes, run plastic_checkin(...) to record the merge result.",
        );
    },
});
