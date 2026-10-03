import type { PendingItemSummary, PendingSummary } from "./pending";
import { isSameBranchSpec } from "./branches";
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
