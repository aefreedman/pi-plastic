import type { CheckinReceipt } from "../domain/checkin-contract";
export function presentCheckinReceipt(dto: CheckinReceipt, format: "text" | "json" = "text"): string {
    const text = format === "json" ? JSON.stringify(dto) : [
        `## Checkin ${dto.outcome}`,
        `- Effect: ${dto.data.effect}`,
        ...(dto.outcome === "preflight" ? [`- Would run: ${dto.data.wouldRun ? "yes" : "no"}`, `- Command argv: ${JSON.stringify(dto.data.command)}`] : []),
        ...(dto.data.createdChangeset ? [`- Observed root changeset: cs:${dto.data.createdChangeset.id}@br:${dto.data.createdChangeset.branch}@${dto.data.createdChangeset.repository}@${dto.data.createdChangeset.server}`] : []),
        `- Steps: ${dto.data.steps.map(s => `${s.name} (${s.effect})`).join(", ") || "none"}`,
        `- Pending after: ${dto.data.pendingAfter ? dto.data.pendingAfter.totalPending : "not verified"}`,
        "- Requested scope exhaustion, branch head, alias equivalence, merge links and Xlink effects: unverified",
        ...(!dto.ok ? [dto.error.message] : []),
    ].join("\n");
    return Buffer.byteLength(text, "utf8") <= 24000 ? text : JSON.stringify({ action: dto.action, outcome: dto.outcome, ok: dto.ok, note: "Presentation omitted; inspect structuredContent for the bounded receipt." });
}
