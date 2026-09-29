import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Eval-only defense in depth. Mutating calls require a supported explicit
 * preflight. Patch content may be returned, but persistent output is prohibited.
 */
export const MUTATING_PLASTIC_TOOLS = new Set([
  "plastic_update", "plastic_mergeBranches",
  "plastic_add", "plastic_checkin", "plastic_undo", "plastic_resolveDeleteChangeConflict",
  "plastic_branchCreate", "plastic_switchBranch", "plastic_merge", "plastic_mergeToBranch",
  "plastic_finalizeMerge", "plastic_branchDelete", "plastic_shelvesetCreate", "plastic_shelvesetApply",
  "plastic_shelvesetDelete", "plastic_codeReviewCreate", "plastic_codeReviewUpdate", "plastic_codeReviewDelete",
]);

function supportsPreflight(parameters: unknown): boolean {
  if (!parameters || typeof parameters !== "object") return false;
  const properties = (parameters as { properties?: unknown }).properties;
  return Boolean(properties && typeof properties === "object" && Object.prototype.hasOwnProperty.call(properties, "preflight"));
}

export default function evalMutationGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName === "plastic_patch") {
      if (["output", "output_file", "outputFile"].every((key) => event.input[key] === undefined)) return;
      return { block: true, reason: "Eval mutation guard blocked plastic_patch: persistent patch artifacts are not authorized by this eval." };
    }
    if (!MUTATING_PLASTIC_TOOLS.has(event.toolName)) return;
    const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
    if (supportsPreflight(tool?.parameters) && event.input.preflight === true) return;
    return {
      block: true,
      reason: `Eval mutation guard blocked ${event.toolName}: live evals allow mutating Plastic tools only when their schema supports preflight and the call includes preflight: true.`,
    };
  });
}
