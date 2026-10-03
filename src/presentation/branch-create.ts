import type { BranchCreateReceipt } from "../domain/branch-create-contract";
export function presentBranchCreateReceipt(dto: BranchCreateReceipt): string {
    const text = dto.ok
        ? "Branch create command completed. Created branch identity, repository and effects are unverified; no workspace switch was requested."
        : `Branch create ${dto.outcome}. ${dto.error.message} Effect: ${dto.data.effect}.`;
    return text.length <= 24000 ? text : "Branch create evidence is unavailable; inspect structuredContent and do not retry automatically.";
}
