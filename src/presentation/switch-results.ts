import type { SwitchReceipt } from "../domain/switch-contract";
export function presentSwitchReceipt(dto: SwitchReceipt, format: "text" | "json" = "text"): string {
    const summary = dto.ok ? `Switch ${dto.outcome}. Strategy: ${dto.data.strategy}. Effect: ${dto.data.effect}.` : `Switch ${dto.outcome}. ${dto.error.message} Effect: ${dto.data.effect}.`;
    if (format === "text") return summary;
    // Core JSON compatibility is a view of the same observation, not a source for native data.
    return "```json\n" + JSON.stringify({ action: "switch-branch", ok: dto.ok, outcome: dto.outcome, data: { strategy: dto.data.strategy, branchBefore: dto.data.branchBefore?.branch ?? null, branchAfter: dto.data.branchAfter?.branch ?? null, branchTarget: dto.data.requestedTarget, pendingSummaryDetailed: dto.data.pendingBefore, pendingPolicy: dto.data.pendingPolicy, defaultedPolicy: dto.data.defaultedPolicy, usedNoChangesShelveRecovery: dto.data.usedNoChangesShelveRecovery, effect: dto.data.effect, wouldRun: dto.data.wouldRun }, ...(!dto.ok ? {error:dto.error} : {}) }, null, 2) + "\n```";
}
