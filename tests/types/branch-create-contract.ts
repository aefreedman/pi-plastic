import type { Static } from "typebox";
import { branchCreateOutputSchema } from "../../src/pi/branch-create-output";
import type { BranchCreateReceipt } from "../../src/domain/branch-create-contract";
function narrow(dto: Static<typeof branchCreateOutputSchema>): string {
    if (dto.ok) {
        const effect: "not-proven" = dto.data.effect;
        const outcome: "command-completed" = dto.outcome;
        const identity: null = dto.data.observedCreatedIdentity;
        // @ts-expect-error command completion has no error field
        dto.error.code;
        // @ts-expect-error completion is not verified branch creation
        const created: "branch-created" = dto.data.effect;
        void identity; void created; return outcome + effect;
    }
    const error: string = dto.error.code;
    if (dto.outcome === "uncertain") { const effect: "uncertain" = dto.data.effect; return effect + error; }
    const effect: "not-attempted" = dto.data.effect;
    return effect + error;
}
const parity = (dto: BranchCreateReceipt): Static<typeof branchCreateOutputSchema> => dto;
void parity; void narrow;
