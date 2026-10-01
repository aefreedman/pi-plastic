import { PendingItemSummary, PendingSummary, getMachineReadablePendingItems, summarizePendingItems } from "../domain/pending";
import { isSameBranchSpec, normalizeBranchSpecForComparison, assertWorkspaceOnBranch, resolveCurrentBranchName } from "../domain/branches";
import { tool } from "../tool-definition";
import { outputFormatArg, toStructuredResult, formatPreflightText } from "../presentation/results";
import { workdirArg } from "./arguments";
import { runCm } from "../execution/cm";
import { normalizeErrorMessage } from "../domain/merge-output";
import { isNoChangesWorkspaceCheckinError } from "./checkin";

export type SwitchPendingProfile = {
    hasPendingChanges: boolean;
    hasTrackedPendingChanges: boolean;
    hasPrivatePendingChanges: boolean;
    hasPrivateOnlyPendingChanges: boolean;
};

export const toLegacyPendingSummary = (summary: PendingItemSummary): PendingSummary =>
{
    return {
        totalPending: summary.totalPending,
        added: summary.added,
        changed: summary.changed,
        moved: summary.moved,
        deleted: summary.deleted,
        other: summary.other + summary.private,
    };
};

export const buildSwitchPendingProfile = (summary: PendingItemSummary): SwitchPendingProfile =>
{
    return {
        hasPendingChanges: summary.totalPending > 0,
        hasTrackedPendingChanges: summary.tracked > 0,
        hasPrivatePendingChanges: summary.private > 0,
        hasPrivateOnlyPendingChanges: summary.private > 0 && summary.tracked === 0,
    };
};

export const isSwitchBringBlockedForUnattended = (pendingChoice: "shelve" | "bring" | "cancel", profile: SwitchPendingProfile): boolean =>
{
    return pendingChoice === "bring" && profile.hasTrackedPendingChanges;
};

export type CanceledSwitchOutcome = {
    kind: "canceled";
    strategy: "cancel-with-pending";
    branchBefore: string;
    branchTarget: string;
    pendingSummary: PendingSummary;
    pendingSummaryDetailed: PendingItemSummary;
    pendingPolicy: "cancel";
    defaultedPolicy: boolean;
    reason: string;
};

export const createCanceledSwitchOutcome = (
    branchBefore: string,
    branchTarget: string,
    pendingSummary: PendingSummary,
    pendingSummaryDetailed: PendingItemSummary,
    pendingChoice: "shelve" | "bring" | "cancel",
    defaultedPolicy: boolean,
): CanceledSwitchOutcome | undefined =>
{
    if (pendingChoice !== "cancel" || pendingSummaryDetailed.totalPending === 0 || isSameBranchSpec(branchBefore, branchTarget))
    {
        return undefined;
    }

    return {
        kind: "canceled",
        strategy: "cancel-with-pending",
        branchBefore,
        branchTarget,
        pendingSummary,
        pendingSummaryDetailed,
        pendingPolicy: "cancel",
        defaultedPolicy,
        reason: defaultedPolicy
            ? "Switch canceled because pending changes were detected and the default policy is cancel unless pendingChanges is set."
            : "Switch canceled because pending changes were detected and pendingChanges was set to cancel.",
    };
};

export const canSwitchDirectWithPrivateOnlyPending = (
    pendingChoice: "shelve" | "bring" | "cancel",
    defaultedPolicy: boolean,
    profile: SwitchPendingProfile,
): boolean =>
{
    if (!profile.hasPrivateOnlyPendingChanges)
    {
        return false;
    }

    if (pendingChoice === "shelve" || pendingChoice === "bring")
    {
        return true;
    }

    return defaultedPolicy;
};

export const __plasticSwitchInternals = {
    toLegacyPendingSummary,
    normalizeBranchSpecForComparison,
    isSameBranchSpec,
    assertWorkspaceOnBranch,
    buildSwitchPendingProfile,
    isSwitchBringBlockedForUnattended,
    canSwitchDirectWithPrivateOnlyPending,
};

export const switchBranch = tool({
    description: "Switch the Plastic SCM workspace to a branch (cm switch), handling pending changes when needed.",
    args: {
        branch: tool.schema.string().min(1).describe("Branch name or spec selected from the current repository convention."),
        pendingChanges: tool.schema.enum(["shelve", "bring", "cancel"]).optional().describe("How to handle pending changes when switching branches. Defaults to cancel. In unattended mode, bring is blocked only when tracked pending changes exist."),
        preflight: tool.schema.boolean().optional().describe("Preview switch strategy without executing switch."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const preflight = args.preflight ?? false;
        const cwd = args.workdir ?? process.cwd();
        const branchBefore = await resolveCurrentBranchName(args.workdir);
        const pendingItems = await getMachineReadablePendingItems(args.workdir);
        const pendingSummaryDetailed = summarizePendingItems(pendingItems, cwd);
        const pendingSummary = toLegacyPendingSummary(pendingSummaryDetailed);
        const pendingProfile = buildSwitchPendingProfile(pendingSummaryDetailed);
        const targetAlreadyLoaded = isSameBranchSpec(branchBefore, args.branch);
        const switchCmd = ["switch", "--silent", "--noinput", args.branch];

        if (targetAlreadyLoaded)
        {
            const message = "Branch switch skipped: workspace is already on the target branch.";
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: no",
                        "- Strategy: already-on-target-branch",
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Reason: ${message}`,
                    ]),
                    {
                        wouldRun: false,
                        strategy: "already-on-target-branch",
                        branchBefore,
                        branchAfter: branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                    },
                    args.workdir,
                    [message],
                );
            }

            return toStructuredResult(
                "switch-branch",
                format,
                message,
                {
                    strategy: "already-on-target-branch",
                    branchBefore,
                    branchAfter: branchBefore,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    rawOutput: message,
                },
                args.workdir,
                [message],
            );
        }

        if (!pendingProfile.hasPendingChanges)
        {
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: yes",
                        `- Strategy: silent-noinput`,
                        `- Command: cm ${switchCmd.join(" ")}`,
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                    ]),
                    {
                        wouldRun: true,
                        strategy: "silent-noinput",
                        command: ["cm", ...switchCmd],
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                    },
                    args.workdir,
                );
            }

            const output = await runCm(switchCmd, args.workdir);
            const branchAfter = await resolveCurrentBranchName(args.workdir);
            assertWorkspaceOnBranch(branchAfter, args.branch, "cm switch");
            return toStructuredResult(
                "switch-branch",
                format,
                output,
                {
                    strategy: "silent-noinput",
                    command: ["cm", ...switchCmd],
                    branchBefore,
                    branchAfter,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    rawOutput: output,
                },
                args.workdir,
            );
        }

        const pendingChoice = args.pendingChanges ?? "cancel";
        const defaulted = args.pendingChanges === undefined;

        if (canSwitchDirectWithPrivateOnlyPending(pendingChoice, defaulted, pendingProfile))
        {
            const reason = pendingChoice === "bring"
                ? "pendingChanges=bring requested with private-only pending changes. Running non-interactive switch directly because no tracked changes require interactive bring prompts."
                : pendingChoice === "shelve"
                    ? "pendingChanges=shelve requested with private-only pending changes. Skipping shelveset creation because there are no tracked changes to shelve."
                    : "Pending changes are private-only and pendingChanges was defaulted to cancel. Running non-interactive switch directly for unattended safety.";
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: yes",
                        "- Strategy: direct-switch-private-only",
                        `- Command: cm ${switchCmd.join(" ")}`,
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Pending policy: ${pendingChoice}`,
                        `- Reason: ${reason}`,
                    ]),
                    {
                        wouldRun: true,
                        strategy: "direct-switch-private-only",
                        command: ["cm", ...switchCmd],
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                        pendingPolicy: pendingChoice,
                        defaultedPolicy: defaulted,
                    },
                    args.workdir,
                    [reason],
                );
            }

            const output = await runCm(switchCmd, args.workdir);
            const branchAfter = await resolveCurrentBranchName(args.workdir);
            assertWorkspaceOnBranch(branchAfter, args.branch, "cm switch with private-only pending items");
            return toStructuredResult(
                "switch-branch",
                format,
                output,
                {
                    strategy: "direct-switch-private-only",
                    command: ["cm", ...switchCmd],
                    branchBefore,
                    branchAfter,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    pendingPolicy: pendingChoice,
                    defaultedPolicy: defaulted,
                    rawOutput: output,
                },
                args.workdir,
                [reason],
            );
        }

        if (isSwitchBringBlockedForUnattended(pendingChoice, pendingProfile))
        {
            const reason = "pendingChanges=bring is blocked for unattended runs when tracked pending changes exist because cm switch requires interactive prompts for bring mode. Use pendingChanges=shelve or resolve/shelve tracked changes first.";
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: no",
                        "- Strategy: blocked-bring-tracked-pending",
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Reason: ${reason}`,
                    ]),
                    {
                        wouldRun: false,
                        strategy: "blocked-bring-tracked-pending",
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                        pendingPolicy: pendingChoice,
                        defaultedPolicy: defaulted,
                    },
                    args.workdir,
                    [reason],
                    "Set pendingChanges to shelve, or shelve/clean tracked changes before switching.",
                );
            }

            throw new Error(reason);
        }

        const canceledOutcome = createCanceledSwitchOutcome(
            branchBefore,
            args.branch,
            pendingSummary,
            pendingSummaryDetailed,
            pendingChoice,
            defaulted,
        );
        if (canceledOutcome)
        {
            const reason = canceledOutcome.reason;
            if (preflight)
            {
                return toStructuredResult(
                    "switch-branch-preflight",
                    format,
                    formatPreflightText("## Branch Switch Preflight", [
                        "- Would run: no",
                        "- Strategy: cancel-with-pending",
                        `- Branch before: ${branchBefore}`,
                        `- Branch target: ${args.branch}`,
                        `- Reason: ${reason}`,
                    ]),
                    {
                        wouldRun: false,
                        strategy: "cancel-with-pending",
                        branchBefore,
                        branchTarget: args.branch,
                        pendingSummary,
                        pendingSummaryDetailed,
                        pendingPolicy: pendingChoice,
                        defaultedPolicy: defaulted,
                    },
                    args.workdir,
                    [reason],
                    "Set pendingChanges to shelve if you want to continue switching with pending changes.",
                );
            }

            return toStructuredResult(
                "switch-branch",
                format,
                reason,
                {
                    strategy: "cancel-with-pending",
                    branchBefore,
                    branchAfter: branchBefore,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    pendingPolicy: pendingChoice,
                    defaultedPolicy: defaulted,
                    rawOutput: reason,
                },
                args.workdir,
                [reason],
                "Set pendingChanges to shelve if you want to continue switching with pending changes.",
            );
        }

        const shelveComment = `Auto-shelve before switch to ${args.branch}`;
        const shelveCmd = ["shelveset", "create", "--all", `-c=${shelveComment}`];

        if (preflight)
        {
            return toStructuredResult(
                "switch-branch-preflight",
                format,
                formatPreflightText("## Branch Switch Preflight", [
                    "- Would run: yes",
                    "- Strategy: shelve-then-switch-noinput",
                    `- Shelve command: cm ${shelveCmd.join(" ")}`,
                    `- Switch command: cm ${switchCmd.join(" ")}`,
                    `- Branch before: ${branchBefore}`,
                    `- Branch target: ${args.branch}`,
                ]),
                {
                    wouldRun: true,
                    strategy: "shelve-then-switch-noinput",
                    commands: [
                        ["cm", ...shelveCmd],
                        ["cm", ...switchCmd],
                    ],
                    branchBefore,
                    branchTarget: args.branch,
                    pendingSummary,
                    pendingSummaryDetailed,
                    pendingPolicy: pendingChoice,
                    defaultedPolicy: defaulted,
                },
                args.workdir,
            );
        }

        let shelveOutput = "";
        let usedNoChangesShelveRecovery = false;
        try
        {
            shelveOutput = await runCm(shelveCmd, args.workdir);
        }
        catch (error)
        {
            const errorMessage = normalizeErrorMessage(error);
            if (!isNoChangesWorkspaceCheckinError(errorMessage))
            {
                throw error;
            }

            const pendingAfterShelveAttempt = await getMachineReadablePendingItems(args.workdir).catch(() => []);
            const pendingSummaryAfterShelveAttempt = summarizePendingItems(pendingAfterShelveAttempt, cwd);
            const profileAfterShelveAttempt = buildSwitchPendingProfile(pendingSummaryAfterShelveAttempt);
            if (profileAfterShelveAttempt.hasTrackedPendingChanges)
            {
                throw error;
            }

            usedNoChangesShelveRecovery = true;
            shelveOutput = "Skipped shelveset creation because no tracked pending changes were detected after recovery check.";
        }

        const switchOutput = await runCm(switchCmd, args.workdir);
        const branchAfter = await resolveCurrentBranchName(args.workdir).catch(() => branchBefore);
        assertWorkspaceOnBranch(branchAfter, args.branch, "cm switch after shelving");

        return toStructuredResult(
            "switch-branch",
            format,
            `${shelveOutput}\n${switchOutput}`,
            {
                strategy: "shelve-then-switch-noinput",
                commands: [
                    ["cm", ...shelveCmd],
                    ["cm", ...switchCmd],
                ],
                branchBefore,
                branchAfter,
                branchTarget: args.branch,
                pendingSummary,
                pendingSummaryDetailed,
                pendingPolicy: pendingChoice,
                defaultedPolicy: defaulted,
                usedNoChangesShelveRecovery,
                rawOutput: {
                    shelve: shelveOutput,
                    switch: switchOutput,
                },
            },
            args.workdir,
            [
                ...(usedNoChangesShelveRecovery ? ["Recovered from shelveset no-changes error and switched directly because tracked pending changes were no longer present."] : []),
            ],
        );
    },
});
