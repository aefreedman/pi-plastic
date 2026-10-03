import type { AddReceipt } from "../domain/add-contract";
export function presentAddReceipt(dto: AddReceipt): string {
    return dto.ok ? `Add command completed for ${dto.data.requestedOperandCount} requested operands, not a verified added-item count. Workspace identity, added items, expanded scope and preservation remain unverified.` :
        `Add ${dto.outcome}: ${dto.error.message} Effects: ${dto.data.effect}. Do not retry automatically.`;
}
