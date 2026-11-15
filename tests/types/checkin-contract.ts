import type { Static } from "typebox";
import { checkinOutputSchema } from "../../src/pi/checkin-output";
import type { CheckinReceipt } from "../../src/domain/checkin-contract";
function narrow(dto: Static<typeof checkinOutputSchema>): string | null {
 if (!dto.ok) return dto.error.code;
 // Native completion does not require an emitted root identity.
 const completed: boolean = dto.data.commandCompleted;
 // @ts-expect-error successful receipts have no error branch
 dto.error.code;
 return dto.data.createdChangeset?.id ?? String(completed);
}
const parity = (dto: CheckinReceipt): Static<typeof checkinOutputSchema> => dto;
void narrow; void parity;
