import type { CloseoutReceipt } from "../domain/closeout-contract";
export function presentCloseoutReceipt(dto: CloseoutReceipt, format?: "text" | "json"): string {
    if (format === "json") return JSON.stringify(dto);
    return [`Merge to branch: ${dto.outcome}.`, `Source: ${dto.data.sourceBranch ?? "unresolved"}; target: ${dto.data.targetBranch ?? "unresolved"}.`, ...(dto.outcome === "preflight" ? dto.data.plan : dto.data.stages.map(s => `${s.name}: ${s.kind === "read" || s.kind === "command" ? s.result.commandCompleted ? "command-completed" : "not completed" : s.result.outcome}`)), `Observed root changeset: ${dto.data.createdChangeset?.id ?? "unobserved"}; linked emissions: ${dto.data.linkedChangesets.length}.`, ...(!dto.ok ? [`Stopped at ${dto.error.stage}: ${dto.error.message}`] : []), "Clean start is point-in-time only, not concurrency isolation or an atomic transaction. Earlier effects remain; no automatic replay or compensation."].join("\n");
}
