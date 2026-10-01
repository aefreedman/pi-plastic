export { runWithAbortSignal } from "./execution/context";
export { status } from "./operations/status";
export { update, add, undo, resolveDeleteChangeConflict, workspaceCreate, workspaceList } from "./operations/workspace";
export { branchCreate, currentBranch, branchList, branchExists, branchDelete, __plasticBranchInternals } from "./operations/branches";
export { shelvesetCreate, shelvesetApply, shelvesetDelete, shelvesetList } from "./operations/shelvesets";
export { codeReviewCreate, codeReviewUpdate, codeReviewDelete, codeReviewFind } from "./operations/reviews";
export { checkin, __plasticCheckinInternals } from "./operations/checkin";
export { switchBranch, __plasticSwitchInternals } from "./operations/switch";
export { getPatchBackendCapabilityWarning, __plasticPatchInternals, patch } from "./operations/patch";
export { __plasticDiffInternals, diff, diffRevisions, diffFile, workspaceDiff } from "./operations/diff";
export { __plasticProcessInternals } from "./execution/test-seams";
import { MergeOutputSummary, MERGE_START_LINE_SEPARATOR, MERGE_END_LINE_SEPARATOR, MERGE_FIELD_SEPARATOR, normalizeErrorMessage, summarizeMergeOutput, analyzeMergeStatusOutput, parseServerMergeOutput } from "./domain/merge-output";
import { checkin } from "./operations/checkin";
import { tool } from "./tool-definition";
import { outputFormatArg, toStructuredResult, formatPreflightText, formatServerMergeResult } from "./presentation/results";
import { workdirArg } from "./operations/arguments";
import { runCm, runCmRaw } from "./execution/cm";
import { summarizeShortStatus, getMachineReadablePendingItems, summarizePendingItems } from "./domain/pending";
import { randomBytes } from "node:crypto";
import { spawnAndCollect, getCmExecutable } from "./execution/process";
import { getActiveAbortSignal, commandExecutionStorage } from "./execution/context";
import { update } from "./operations/workspace";
import { resolveCurrentBranchName, resolveBranchParentName, isSameBranchSpec, assertWorkspaceOnBranch } from "./domain/branches";
import { createCanceledSwitchOutcome, toLegacyPendingSummary, switchBranch } from "./operations/switch";

type MergeConflictStrategy = "auto" | "source" | "destination";

const buildMergeAbortMessage = (
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

type QualifiedServerBranch = {
    raw: string;
    branch: string;
    repository: string;
    server: string;
};

const SERVER_MERGE_OUTPUT_LIMIT = 16_384;

const SERVER_MERGE_HELP_TIMEOUT_MS = 3_000;

const SERVER_MERGE_COMMAND_TIMEOUT_MS = 30_000;

const serverMergeControlPattern = /[\u0000-\u001f\u007f-\u009f]/;

const serverMergeCapabilityTokens = ["--to", "--merge", "--nointeractiveresolution", "--machinereadable", "--startlineseparator", "--endlineseparator", "--fieldseparator"];

const assertSafeServerMergeValue = (name: string, value: string): string =>
{
    const trimmed = value.trim();
    if (!trimmed || serverMergeControlPattern.test(value))
    {
        throw new Error(`${name} must be non-empty and must not contain control characters.`);
    }

    return trimmed;
};

const parseQualifiedServerBranch = (name: string, value: string): QualifiedServerBranch =>
{
    const raw = assertSafeServerMergeValue(name, value);
    if (!raw.startsWith("br:/"))
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    const lastAt = raw.lastIndexOf("@");
    const previousAt = raw.lastIndexOf("@", lastAt - 1);
    if (previousAt <= 3 || lastAt <= previousAt + 1 || lastAt === raw.length - 1)
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    const branch = raw.slice(3, previousAt);
    const repository = raw.slice(previousAt + 1, lastAt);
    const server = raw.slice(lastAt + 1);
    if (!branch.startsWith("/") || branch.endsWith("/") || [branch, repository, server].some((part) => !part || part !== part.trim() || serverMergeControlPattern.test(part)))
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    return { raw, branch, repository, server };
};

const createServerMergeSeparators = (): { start: string; end: string; field: string } =>
{
    const nonce = randomBytes(16).toString("hex");
    return {
        start: `__PI_PLASTIC_MERGE_START_${nonce}__`,
        end: `__PI_PLASTIC_MERGE_END_${nonce}__`,
        field: `__PI_PLASTIC_MERGE_FIELD_${nonce}__`,
    };
};

const getServerMergeCapability = async (): Promise<{ supported: boolean; diagnostics: string }> =>
{
    const result = await spawnAndCollect(getCmExecutable(), ["help", "merge"], process.cwd(), undefined, getActiveAbortSignal(), {
        ...(commandExecutionStorage.getStore() ?? {}),
        timeoutMs: SERVER_MERGE_HELP_TIMEOUT_MS,
        outputLimitChars: SERVER_MERGE_OUTPUT_LIMIT,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const missing = serverMergeCapabilityTokens.filter((token) => !output.includes(token));
    if (result.aborted || result.timedOut || result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated || missing.length > 0)
    {
        return { supported: false, diagnostics: `Local cm help merge capability check did not prove required syntax${missing.length > 0 ? `: missing ${missing.join(", ")}` : "."}` };
    }
    return { supported: true, diagnostics: "Local cm help merge advertised the required merge-to and machine-readable syntax. Server capability remains unverified until dispatch." };
};

export const mergeBranches = tool({
    description: "Perform one bounded workspace-free server-side merge between explicitly qualified branches; merge-link and xlink effects remain unverified.",
    args: {
        source: tool.schema.string().min(1).describe("Fully qualified source branch: br:/<branch>@<repository>@<server>."),
        target: tool.schema.string().min(1).describe("Fully qualified target branch in the same repository/server as source."),
        message: tool.schema.string().min(1).describe("Non-empty changeset comment; no editor fallback is allowed."),
        preflight: tool.schema.boolean().optional().describe("Render the exact command only; does not contact Plastic or analyze remote conflicts."),
        format: outputFormatArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const source = parseQualifiedServerBranch("source", args.source);
        const target = parseQualifiedServerBranch("target", args.target);
        const message = assertSafeServerMergeValue("message", args.message);
        if (source.repository !== target.repository || source.server !== target.server)
        {
            throw new Error("source and target must identify the same exact repository and server.");
        }
        if (source.branch === target.branch)
        {
            throw new Error("source and target must identify different branches.");
        }

        const separators = createServerMergeSeparators();
        const command = [
            "merge", source.raw, `--to=${target.raw}`, "--merge", `-c=${message}`, "--nointeractiveresolution", "--machinereadable",
            `--startlineseparator=${separators.start}`, `--endlineseparator=${separators.end}`, `--fieldseparator=${separators.field}`,
        ];
        const requestedIdentity = { source: source.raw, target: target.raw, repository: source.repository, server: source.server };
        if (args.preflight)
        {
            return formatServerMergeResult(format, "preflight", [
                "## Server Merge Preflight",
                "",
                "- Would run: yes",
                "- Remote analysis: not performed",
                `- Command: cm ${command.join(" ")}`,
            ].join("\n"), { wouldRun: true, requestedIdentity, command: ["cm", ...command] });
        }

        const capability = await getServerMergeCapability();
        if (!capability.supported)
        {
            return formatServerMergeResult(format, "unsupported", "## Server Merge Unsupported\n\n- No merge command was dispatched because local client syntax could not be proven.", {
                requestedIdentity,
                capability,
                dispatched: false,
            });
        }

        const attempt = await spawnAndCollect(getCmExecutable(), command, process.cwd(), undefined, getActiveAbortSignal(), {
            ...(commandExecutionStorage.getStore() ?? {}),
            timeoutMs: SERVER_MERGE_COMMAND_TIMEOUT_MS,
            outputLimitChars: SERVER_MERGE_OUTPUT_LIMIT,
        });
        const output = [attempt.stdout, attempt.stderr].filter(Boolean).join("\n");
        const parsed = parseServerMergeOutput(output, separators);
        const matchingChangesets = parsed.changesets.filter((changeset) => changeset.branch === target.branch && changeset.repository === target.repository && changeset.mount === "/");
        const effect = "not-proven";
        const diagnostics = output.slice(0, 4_000);
        const baseData = {
            requestedIdentity,
            capability,
            command: ["cm", ...command],
            dispatched: true,
            exitCode: attempt.exitCode,
            aborted: attempt.aborted,
            timedOut: attempt.timedOut,
            outputTruncated: Boolean(attempt.stdoutTruncated || attempt.stderrTruncated),
            records: parsed.records,
            observedChangesets: parsed.changesets,
            diagnostics,
            mergeLinkIdentity: "unverified",
            xlinkEffects: "unverified",
            effect,
        };

        const ambiguous = attempt.aborted || attempt.timedOut || attempt.stdoutTruncated || attempt.stderrTruncated || parsed.malformed
            || parsed.unknownOperations.length > 0 || parsed.changesets.length > 1
            || (parsed.changesets.length > 0 && matchingChangesets.length !== 1)
            || (parsed.hasConflict && parsed.changesets.length > 0)
            || (parsed.isAlreadyConnected && (parsed.changesets.length > 0 || parsed.hasConflict));
        if (!ambiguous && attempt.exitCode === 0 && matchingChangesets.length === 1 && !parsed.hasConflict && !parsed.isAlreadyConnected)
        {
            const changeset = matchingChangesets[0]!;
            return formatServerMergeResult(format, "completed", `## Server Merge Completed\n\n- Created target changeset: cs:${changeset.id}\n- Merge-link identity: unverified\n- Xlink effects: unverified`, {
                ...baseData,
                createdChangeset: changeset,
                effect: "changeset-created",
            });
        }
        if (!ambiguous && attempt.exitCode === 0 && parsed.isAlreadyConnected && parsed.changesets.length === 0 && !parsed.hasConflict)
        {
            return formatServerMergeResult(format, "no-op", "## Server Merge No-op\n\n- Plastic reported ALREADY_CONNECTED.\n- Effect: not independently verified.", baseData);
        }
        if (!ambiguous && attempt.exitCode !== 0 && parsed.hasConflict && parsed.changesets.length === 0)
        {
            return formatServerMergeResult(format, "conflict", "## Server Merge Conflict\n\n- Plastic reported a file conflict.\n- Effect: uncertain; inspect the server before any retry.", { ...baseData, effect: "uncertain" });
        }
        return formatServerMergeResult(format, "uncertain", "## Server Merge Uncertain\n\n- The command may have had an effect, but its bounded output does not prove a safe classification.\n- Do not retry automatically; inspect server state first.", {
            ...baseData,
            effect: "uncertain",
            parseWarnings: {
                malformed: parsed.malformed,
                unknownOperations: parsed.unknownOperations,
                matchingChangesetCount: matchingChangesets.length,
            },
        });
    },
});

export const mergeToBranch = tool({
    description: "Merge a source branch into a target branch using safe Plastic update, switch, merge, and checkin steps.",
    args: {
        source: tool.schema.string().optional().describe("Source branch to merge. Defaults to the currently loaded branch."),
        target: tool.schema.string().optional().describe("Target branch to merge into. Defaults to the source branch's Plastic parent branch."),
        cardRef: tool.schema.string().optional().describe("Optional tracker card reference to include in the merge checkin message, for example $4re."),
        message: tool.schema.string().optional().describe("Optional checkin message. Defaults to Merge <source> into <target>."),
        strategy: tool.schema.enum(["auto", "source", "destination"]).optional().describe("Merge conflict strategy. Defaults to auto."),
        updateTarget: tool.schema.boolean().optional().describe("Run plastic_update on the target branch before merging. Defaults to true."),
        includePrivate: tool.schema.boolean().optional().describe("Include private items in the merge checkin. Defaults to false."),
        preflight: tool.schema.boolean().optional().describe("Preview the planned closeout merge steps without executing them."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const startingBranch = await resolveCurrentBranchName(args.workdir);
        const sourceBranch = args.source ?? startingBranch;
        const parentLookup = args.target ? undefined : await resolveBranchParentName(sourceBranch, args.workdir);
        if (!args.target && parentLookup?.kind !== "resolved")
        {
            const details = parentLookup?.kind === "command-failed"
                ? ` Plastic lookup failed: ${parentLookup.diagnostics.join(" | ")}`
                : parentLookup?.kind === "malformed-output"
                    ? ` Plastic lookup returned unusable output: ${parentLookup.diagnostics.join(" | ")}`
                    : parentLookup?.kind === "root"
                        ? ` ${parentLookup.matchedBranch} is a root branch with no parent.`
                        : " Plastic found no matching branch row.";
            throw new Error(`Unable to resolve the parent branch for ${sourceBranch}. Pass target explicitly.${details}`);
        }
        const resolvedParentBranch = parentLookup?.kind === "resolved" ? parentLookup.parent : undefined;
        const targetBranch = args.target ?? resolvedParentBranch!;
        const strategy: MergeConflictStrategy = args.strategy ?? "auto";
        const updateTarget = args.updateTarget ?? true;
        const includePrivate = args.includePrivate ?? false;
        const cardLine = args.cardRef?.trim() ? `\n\n${args.cardRef.trim()}` : "";
        const checkinMessage = args.message?.trim()
            ? args.message.trim()
            : `Merge ${sourceBranch} into ${targetBranch}${cardLine}`;

        if (isSameBranchSpec(sourceBranch, targetBranch))
        {
            throw new Error(`Refusing to merge ${sourceBranch} into itself.`);
        }

        const plannedSteps = [
            `Resolve source branch: ${sourceBranch}`,
            `Switch to target branch: ${targetBranch}`,
            ...(updateTarget ? [`Update target branch safely: ${targetBranch}`] : []),
            `Merge source into target with strategy=${strategy}: ${sourceBranch}`,
            "Inspect merge status for unresolved hints.",
            "Check in merge result.",
        ];

        if (args.preflight)
        {
            const pendingItems = await getMachineReadablePendingItems(args.workdir);
            const pendingSummary = summarizePendingItems(pendingItems, args.workdir ?? process.cwd());
            return toStructuredResult(
                "merge-to-branch-preflight",
                format,
                formatPreflightText("## Merge To Branch Preflight", [
                    `- Starting branch: ${startingBranch}`,
                    `- Source branch: ${sourceBranch}`,
                    `- Target branch: ${targetBranch}`,
                    `- Target source: ${args.target ? "explicit argument" : "source branch parent"}`,
                    `- Update target: ${updateTarget ? "yes" : "no"}`,
                    `- Conflict strategy: ${strategy}`,
                    `- Include private: ${includePrivate ? "yes" : "no"}`,
                    `- Pending items before switch: ${pendingSummary.totalPending}`,
                    "",
                    "Planned steps:",
                    ...plannedSteps.map((step) => `- ${step}`),
                    "",
                    "Checkin message:",
                    checkinMessage,
                ]),
                {
                    wouldRun: true,
                    startingBranch,
                    sourceBranch,
                    targetBranch,
                    targetSource: args.target ? "explicit" : "parent",
                    resolvedParentBranch: resolvedParentBranch ?? null,
                    updateTarget,
                    conflictStrategy: strategy,
                    includePrivate,
                    pendingSummary,
                    checkinMessage,
                    plannedSteps,
                },
                args.workdir,
            );
        }

        // Inspect the cancel policy as typed data before any target-side mutation.
        const pendingBeforeSwitchItems = await getMachineReadablePendingItems(args.workdir);
        const pendingBeforeSwitchDetailed = summarizePendingItems(pendingBeforeSwitchItems, args.workdir ?? process.cwd());
        const canceledSwitchOutcome = createCanceledSwitchOutcome(
            startingBranch,
            targetBranch,
            toLegacyPendingSummary(pendingBeforeSwitchDetailed),
            pendingBeforeSwitchDetailed,
            "cancel",
            false,
        );
        if (canceledSwitchOutcome)
        {
            return toStructuredResult(
                "merge-to-branch",
                format,
                [
                    "## Merge To Branch Blocked",
                    "",
                    `- Source branch: ${sourceBranch}`,
                    `- Target branch: ${targetBranch}`,
                    `- ${canceledSwitchOutcome.reason}`,
                    "- No switch, update, merge, checkin, or shelveset command was run.",
                ].join("\n"),
                {
                    sourceBranch,
                    targetBranch,
                    switchOutcome: canceledSwitchOutcome,
                    checkedIn: false,
                },
                args.workdir,
                [canceledSwitchOutcome.reason],
                "Resolve or shelve pending changes before retrying the merge closeout.",
            );
        }

        const switchResult = await switchBranch.execute({
            branch: targetBranch,
            pendingChanges: "cancel",
            format: "json",
            workdir: args.workdir,
        });
        const branchAfterSwitch = await resolveCurrentBranchName(args.workdir);
        assertWorkspaceOnBranch(branchAfterSwitch, targetBranch, "branch switch and before target update");
        const updateResult = updateTarget ? await update.execute({ workdir: args.workdir }) : "(skipped)";
        const branchBeforeMerge = await resolveCurrentBranchName(args.workdir);
        assertWorkspaceOnBranch(branchBeforeMerge, targetBranch, "target update and before merge");
        const mergeResult = await merge.execute({
            source: sourceBranch,
            strategy,
            format: "json",
            workdir: args.workdir,
        });

        const fullStatusAfterMerge = await runCmRaw(["status"], args.workdir).catch(() => "");
        const mergeStateAfterMerge = analyzeMergeStatusOutput(fullStatusAfterMerge);
        if (mergeStateAfterMerge.hasMergeInProgress)
        {
            return toStructuredResult(
                "merge-to-branch",
                format,
                [
                    "## Merge To Branch Paused",
                    "",
                    `- Source branch: ${sourceBranch}`,
                    `- Target branch: ${targetBranch}`,
                    "- Merge completed, but merge-in-progress hints remain.",
                    "- Do not check in until merge metadata is resolved/finalized.",
                ].join("\n"),
                {
                    sourceBranch,
                    targetBranch,
                    switchResult,
                    updateResult,
                    mergeResult,
                    fullStatusAfterMerge,
                    mergeStateAfterMerge,
                    checkedIn: false,
                },
                args.workdir,
                ["Merge-in-progress hints remain after merge; checkin skipped."],
                "Resolve/finalize the merge metadata, validate, then run plastic_checkin for the merge result.",
            );
        }

        const branchBeforeCheckin = await resolveCurrentBranchName(args.workdir);
        assertWorkspaceOnBranch(branchBeforeCheckin, targetBranch, "merge and before checkin");

        const preflightResult = await checkin.execute({
            message: checkinMessage,
            includeAll: true,
            includePrivate,
            preflight: true,
            format: "json",
            workdir: args.workdir,
        });
        const checkinResult = await checkin.execute({
            message: checkinMessage,
            includeAll: true,
            includePrivate,
            format: "json",
            workdir: args.workdir,
        });
        const finalBranch = await resolveCurrentBranchName(args.workdir);
        assertWorkspaceOnBranch(finalBranch, targetBranch, "merge checkin");
        const finalShortStatus = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const finalPendingSummary = summarizeShortStatus(finalShortStatus);

        return toStructuredResult(
            "merge-to-branch",
            format,
            [
                "## Merge To Branch Complete",
                "",
                `- Source branch: ${sourceBranch}`,
                `- Target branch: ${targetBranch}`,
                `- Final branch: ${finalBranch}`,
                `- Update target: ${updateTarget ? "yes" : "no"}`,
                `- Conflict strategy: ${strategy}`,
                `- Merge checkin completed: yes`,
                `- Pending items after checkin: ${finalPendingSummary.totalPending}`,
            ].join("\n"),
            {
                sourceBranch,
                targetBranch,
                targetSource: args.target ? "explicit" : "parent",
                resolvedParentBranch: resolvedParentBranch ?? null,
                finalBranch,
                updateTarget,
                conflictStrategy: strategy,
                includePrivate,
                checkinMessage,
                switchResult,
                updateResult,
                mergeResult,
                preflightResult,
                checkinResult,
                finalShortStatus,
                finalPendingSummary,
                checkedIn: true,
            },
            args.workdir,
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
