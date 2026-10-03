import type { SwitchReceipt } from "../../src/operations/switch-receipt";
export function narrowSwitch(dto: SwitchReceipt): string {
    if (!dto.ok) return dto.error.message;
    // @ts-expect-error successful variants do not carry native failure diagnostics
    dto.error;
    if (dto.outcome === "switched") return dto.data.targetVerification;
    return dto.outcome;
}
