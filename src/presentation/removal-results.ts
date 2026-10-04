import type { RemovalReceipt } from "../domain/removal-contract";
export function presentRemovalReceipt(dto: RemovalReceipt): string {
    if (dto.data.outputFormatRequested === "json") return `## resolve-delete-change-conflict\n\n\`\`\`json\n${JSON.stringify(dto, null, 2)}\n\`\`\``;
    if (!dto.ok) return `Removal ${dto.outcome}: ${dto.error.message} Effects: ${dto.data.effect}. Do not retry automatically.`;
    if (dto.outcome === "preflight") return `Removal command-only preview (not executed): ${JSON.stringify(dto.data.intendedArgv)}. Requested --nodisk: ${dto.data.keepOnDiskRequested}. No conflict or execution readiness analysis.`;
    return `Remove command completed for ${dto.data.requestedOperandCount} requested operands, not a verified resolved-item count. Conflict resolution, disk preservation, pending state, workspace identity and affected scope remain unverified.`;
}
