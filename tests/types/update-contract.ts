import type { UpdateReceipt } from "../../src/operations/update-receipt";
function consume(dto: UpdateReceipt) {
    const identity: null = dto.data.observedWorkspaceIdentity;
    const changes: null = dto.data.observedChanges;
    if (!dto.ok) { const code: string = dto.error.code; void code; }
    else { const outcome: "command-completed" = dto.outcome; void outcome; }
    // @ts-expect-error Update never supplies a verified changeset.
    const changeset: string = dto.data.observedChanges;
    // @ts-expect-error Opaque progress is not a typed file count.
    const count: number = dto.data.observedChanges;
    void [identity,changes,changeset,count];
}
void consume;
