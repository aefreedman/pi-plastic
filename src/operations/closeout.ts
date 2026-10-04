import { tool } from "../tool-definition";
import { update } from "./workspace";
import { merge, MergeConflictStrategy } from "./merge";
import { checkin } from "./checkin";
import { outputFormatArg, toStructuredResult, formatPreflightText } from "../presentation/results";
import { workdirArg } from "./arguments";
import { resolveCurrentBranchName, resolveBranchParentName, isSameBranchSpec, assertWorkspaceOnBranch } from "../domain/branches";
import { getMachineReadablePendingItems, summarizePendingItems, summarizeShortStatus } from "../domain/pending";
import { createCanceledSwitchOutcome, toLegacyPendingSummary, switchBranch } from "./switch";
import { runCmRaw } from "../execution/cm";
import { analyzeMergeStatusOutput } from "../domain/merge-output";
import { admitCleanStandardStatus } from "../domain/workspace-merge-contract";

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

        const fullStatusAfterMerge = await runCmRaw(["status"], args.workdir);
        if (!admitCleanStandardStatus(fullStatusAfterMerge)) throw new Error("Closeout paused: post-merge status/readiness outside admitted profile; no checkin permitted. Prior effects remain possible.");
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
