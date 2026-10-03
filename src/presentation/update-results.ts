import type { UpdateReceipt } from "../domain/update-contract";
export function presentUpdateReceipt(dto: UpdateReceipt): string {
    return dto.ok ? "Update command completed. Workspace identity, changed items, preservation, cleanliness and merge readiness remain unverified." :
        `Update ${dto.outcome}: ${dto.error.message} Effects: ${dto.data.effect}. Do not retry automatically.`;
}
