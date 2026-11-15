import type { WorkspaceMergeReceipt } from "../domain/workspace-merge-contract";
export function presentWorkspaceMergeReceipt(dto: WorkspaceMergeReceipt): string {
    if (dto.data.requested?.format === "json") return JSON.stringify(dto);
    return [`Workspace merge: ${dto.outcome}.`, `Native command completed: ${dto.data.commandCompleted}; exit: ${dto.data.attempt.exitCode ?? "unobserved"}.`, ...(dto.outcome === "preflight" ? [`Command argv: ${JSON.stringify(dto.data.command)}`] : [dto.data.commandOutput?.stdout ?? "", dto.data.commandOutput?.stderr ?? ""]), ...(!dto.completeness.projection ? ["Diagnostic output truncated; native execution was not stopped by the presentation budget."] : []), ...(!dto.ok ? [dto.error.message] : []), "Command completion is not semantic merge correctness. No automatic retry."].filter(Boolean).join("\n");
}
