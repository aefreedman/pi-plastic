import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Eval-only defense in depth. Live trials may exercise only Plastic operations
 * that expose a preflight parameter and explicitly request that preview mode.
 */
const DESTRUCTIVE_PLASTIC_TOOLS = new Set([
  "plastic_add", "plastic_checkin", "plastic_undo", "plastic_resolveDeleteChangeConflict",
  "plastic_branchCreate", "plastic_switchBranch", "plastic_merge", "plastic_mergeToBranch",
  "plastic_finalizeMerge", "plastic_branchDelete", "plastic_shelvesetCreate", "plastic_shelvesetApply",
  "plastic_shelvesetDelete", "plastic_codeReviewCreate", "plastic_codeReviewUpdate", "plastic_codeReviewDelete",
  "plastic_workspaceCreate",
]);

function supportsPreflight(parameters: unknown): boolean {
  if (!parameters || typeof parameters !== "object") return false;
  const properties = (parameters as { properties?: unknown }).properties;
  return Boolean(properties && typeof properties === "object" && Object.prototype.hasOwnProperty.call(properties, "preflight"));
}

export default function evalMutationGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    if (!DESTRUCTIVE_PLASTIC_TOOLS.has(event.toolName)) return;
    const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
    if (supportsPreflight(tool?.parameters) && event.input.preflight === true) return;
    return {
      block: true,
      reason: `Eval mutation guard blocked ${event.toolName}: live evals allow destructive Plastic tools only when their schema supports preflight and the call includes preflight: true.`,
    };
  });
}
