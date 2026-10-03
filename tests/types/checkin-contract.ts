import type { Static } from "typebox";
import { checkinOutputSchema } from "../../src/pi/checkin-output";
import type { CheckinReceipt } from "../../src/domain/checkin-contract";
function narrow(dto: Static<typeof checkinOutputSchema>): string | null {
    if (dto.ok && dto.outcome === "completed") {
        const effect: "changeset-created" = dto.data.effect;
        const id: string = dto.data.createdChangeset.id;
        // @ts-expect-error successful receipts have no error branch
        dto.error.code;
        return id + effect;
    }
    if (!dto.ok) return dto.error.code;
    const effect: "not-attempted" = dto.data.effect;
    // @ts-expect-error preflight cannot expose created identity
    dto.data.createdChangeset.id;
    return effect;
}
const parity = (dto: CheckinReceipt): Static<typeof checkinOutputSchema> => dto;
void narrow; void parity;
