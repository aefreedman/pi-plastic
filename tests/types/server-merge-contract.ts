import type { Static } from "typebox";
import { serverMergeOutputSchema } from "../../src/pi/server-merge-output";
import type { MergeReceipt } from "../../src/operations/server-merge";
function narrow(dto: Static<typeof serverMergeOutputSchema>): string | null {
    if (dto.ok && dto.outcome === "completed") {
        const effect: "changeset-created" = dto.data.effect;
        const id: string = dto.data.createdChangeset.id;
        const server: string = dto.data.createdChangeset.server;
        // @ts-expect-error successes have no error branch
        dto.error.code;
        return id + server + effect;
    }
    if (!dto.ok) { const error: string = dto.error.code; return error; }
    if (dto.outcome === "preflight" || dto.outcome === "analyzed") {
        const effect: "not-attempted" = dto.data.effect;
        // @ts-expect-error preflight has no created changeset
        dto.data.createdChangeset.id;
        return effect;
    }
    const effect: "not-proven" = dto.data.effect;
    return effect;
}
const parity = (dto: MergeReceipt): Static<typeof serverMergeOutputSchema> => dto;
void narrow; void parity;
