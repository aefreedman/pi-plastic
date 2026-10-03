import { isSameBranchSpec, normalizeBranchSpecForComparison, assertWorkspaceOnBranch } from "../domain/branches";
import { toLegacyPendingSummary, buildSwitchPendingProfile, isSwitchBringBlockedForUnattended, canSwitchDirectWithPrivateOnlyPending } from "../domain/switch-policy";
export { toLegacyPendingSummary, createCanceledSwitchOutcome, buildSwitchPendingProfile, isSwitchBringBlockedForUnattended, canSwitchDirectWithPrivateOnlyPending } from "../domain/switch-policy";
export type { SwitchPendingProfile, CanceledSwitchOutcome } from "../domain/switch-policy";
import { assembleSwitchReceipt, presentSwitchReceipt } from "./switch-receipt";
import { tool } from "../tool-definition";
import { outputFormatArg } from "../presentation/results";
import { workdirArg } from "./arguments";
export const __plasticSwitchInternals = { toLegacyPendingSummary, normalizeBranchSpecForComparison, isSameBranchSpec, assertWorkspaceOnBranch, buildSwitchPendingProfile, isSwitchBringBlockedForUnattended, canSwitchDirectWithPrivateOnlyPending };
export const switchBranch = tool({
    description: "Switch the Plastic SCM workspace to a branch (cm switch), handling pending changes when needed.",
    args: {
        branch: tool.schema.string().min(1).describe("Branch name or spec selected from the current repository convention."),
        pendingChanges: tool.schema.enum(["shelve", "bring", "cancel"]).optional().describe("How to handle pending changes when switching branches. Defaults to cancel. In unattended mode, bring is blocked only when tracked pending changes exist."),
        preflight: tool.schema.boolean().optional().describe("Preview switch strategy without executing switch."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args) {
        const dto = await assembleSwitchReceipt(args);
        // Policy cancellation also rejects here: a compound caller must not continue into target-side mutations.
        if (!dto.ok && !args.preflight) throw new Error(dto.error.message);
        return presentSwitchReceipt(dto,args.format);
    },
});
