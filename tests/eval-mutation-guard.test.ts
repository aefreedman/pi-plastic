import assert from "node:assert/strict";
import guard, { MUTATING_PLASTIC_TOOLS } from "../evals/tool-loading/mutation-guard.ts";
import { PLASTIC_SEARCH_CATALOG } from "../src/plastic-tool-loading.ts";
import { PiToolHarness } from "./pi-tool-harness.ts";

const harness = new PiToolHarness();
await harness.load();
let handler: any;
guard({ on: (event: string, callback: any) => { assert.equal(event, "tool_call"); handler = callback; }, getAllTools: () => harness.api.getAllTools() } as any);
let executions = 0;
async function dispatch(toolName: string, input: Record<string, unknown> = {}) {
  assert(harness.registry.has(toolName), `${toolName} must really be registered`);
  const result = await handler({ toolName, input });
  if (!result?.block) executions++; // fake SCM dispatch, never run cm
  return Boolean(result?.block);
}
for (const entry of PLASTIC_SEARCH_CATALOG.filter((entry) => entry.tags.includes("mutation"))) {
  assert(MUTATING_PLASTIC_TOOLS.has(entry.name), `unguarded registered mutation: ${entry.name}`);
}
// Catalog tags alone are insufficient: update synchronizes disk, and merge/conflict
// workflows mutate despite not carrying a mutation tag. Keep an exhaustive read classification.
const reads = ["plastic_status", "plastic_currentBranch", "plastic_branchList", "plastic_branchExists", "plastic_shelvesetList", "plastic_codeReviewFind", "plastic_workspaceList", "plastic_diff", "plastic_tool_search"];
assert.deepEqual(new Set(harness.registry.keys()), new Set([...MUTATING_PLASTIC_TOOLS, "plastic_patch", ...reads]), "new registrations require effect classification");
for (const name of MUTATING_PLASTIC_TOOLS) {
  assert(await dispatch(name));
  assert(await dispatch(name, { preflight: "true" }));
  assert(await dispatch(name, { dryRun: true }));
}
for (const key of ["output", "output_file", "outputFile"]) assert(await dispatch("plastic_patch", { [key]: "review.patch", preflight: true }));
assert.equal(executions, 0, "blocked calls must never reach fake SCM dispatch");
const preflightTools = ["plastic_checkin", "plastic_resolveDeleteChangeConflict", "plastic_switchBranch", "plastic_merge", "plastic_mergeBranches", "plastic_mergeToBranch", "plastic_finalizeMerge", "plastic_branchDelete", "plastic_shelvesetDelete", "plastic_codeReviewDelete"];
for (const name of MUTATING_PLASTIC_TOOLS) {
  const schema = harness.registry.get(name)!.parameters as any;
  assert.equal(Object.hasOwn(schema.properties, "preflight"), preflightTools.includes(name), `${name}: actual supported preflight schema`);
  assert.equal(await dispatch(name, { preflight: true }), !preflightTools.includes(name));
}
assert.equal(await dispatch("plastic_patch", { source: "cs:1" }), false, "returning patch content uses cleaned-up temporary output, not a persistent artifact");
assert.equal(await dispatch("plastic_status"), false);
assert.equal(executions, preflightTools.length + 2);
console.log("PASS: Plastic eval guard classifies all registrations, preserves supported preflights, and prevents blocked execution");
