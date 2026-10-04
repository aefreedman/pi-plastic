import type { UndoReceipt } from "../domain/undo-contract";
export function presentUndoReceipt(dto: UndoReceipt): string {
    return dto.ok ? `Undo command completed for ${dto.data.requestedOperandCount} requested operands, not a verified undone-item count. Workspace identity, undone items, restored content, expanded scope and preservation remain unverified.` :
        `Undo ${dto.outcome}: ${dto.error.message} Effects: ${dto.data.effect}. Do not retry automatically.`;
}
