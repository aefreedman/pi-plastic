import assert from "node:assert/strict";
import { invokeRegisteredTool } from "./pi-tool-harness.ts";

type ToolEnvelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
};

const parseToolEnvelope = (text: string): ToolEnvelope => {
  const fencedJson = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(fencedJson, "Expected a structured JSON tool result.");
  return JSON.parse(fencedJson[1]) as ToolEnvelope;
};

const workspace = process.env.PI_PLASTIC_TEST_WORKSPACE?.trim();
const mutationAllowed = process.env.PI_PLASTIC_ALLOW_MUTATION_TESTS?.trim().toLowerCase() === "true";

if (!workspace || !mutationAllowed) {
  console.log("SKIP: set PI_PLASTIC_TEST_WORKSPACE and PI_PLASTIC_ALLOW_MUTATION_TESTS=true to run branch mutation tests");
  process.exit(0);
}

const status = parseToolEnvelope(await invokeRegisteredTool("plastic_status", { short: true, format: "json" }, workspace));
assert.equal(status.ok, true, "Expected Plastic status to succeed.");
const summary = status.data?.summary as Record<string, unknown> | undefined;
const mergeState = status.data?.mergeState as Record<string, unknown> | undefined;
assert.equal(summary?.totalPending, 0, "Live branch tests require a clean workspace.");
assert.equal(mergeState?.hasMergeInProgress, false, "Live branch tests require no merge in progress.");

const currentResult = parseToolEnvelope(await invokeRegisteredTool("plastic_currentBranch", { format: "json" }, workspace));
const loadedBranch = currentResult.data?.branch;
assert.equal(typeof loadedBranch, "string", "Expected a loaded Plastic branch.");

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const parent = `${loadedBranch}/pi-live-parent-${suffix}`;
const childLeaf = `child-${suffix}`;
const child = `${parent}/${childLeaf}`;
const blockedRoot = `/pi-live-root-${suffix}`;

const exists = async (branch: string): Promise<boolean> =>
  (await invokeRegisteredTool("plastic_branchExists", { branch }, workspace)).trim() === "true";

assert.equal(await exists(parent), false, `Temporary parent already exists: ${parent}`);
assert.equal(await exists(child), false, `Temporary child already exists: ${child}`);
assert.equal(await exists(blockedRoot), false, `Temporary root already exists: ${blockedRoot}`);

try {
  await invokeRegisteredTool("plastic_branchCreate", { branch: parent, comment: "pi-plastic live parent test" }, workspace);
  assert.equal(await exists(parent), true, "Expected full hierarchical branch creation to succeed.");

  await invokeRegisteredTool("plastic_branchCreate", {
    branch: childLeaf,
    parent,
    comment: "pi-plastic explicit-parent live test",
  }, workspace);
  assert.equal(await exists(child), true, "Expected creation beneath an explicit non-loaded parent to succeed.");

  let rootGuarded = false;
  try {
    const output = await invokeRegisteredTool("plastic_branchCreate", { branch: blockedRoot }, workspace);
    rootGuarded = /Refusing to create top-level branch/.test(output);
  } catch (error) {
    rootGuarded = /Refusing to create top-level branch/.test(error instanceof Error ? error.message : String(error));
  }
  assert.equal(rootGuarded, true, "Expected top-level creation to be rejected without allowRootBranch.");
  assert.equal(await exists(blockedRoot), false, "Rejected top-level branch must not be created.");

  const branchAfter = parseToolEnvelope(await invokeRegisteredTool("plastic_currentBranch", { format: "json" }, workspace));
  assert.equal(branchAfter.data?.branch, loadedBranch, "Branch creation must not switch the workspace.");
} finally {
  if (await exists(child)) await invokeRegisteredTool("plastic_branchDelete", { branch: child }, workspace);
  if (await exists(parent)) await invokeRegisteredTool("plastic_branchDelete", { branch: parent }, workspace);
}

assert.equal(await exists(child), false, "Temporary child branch cleanup failed.");
assert.equal(await exists(parent), false, "Temporary parent branch cleanup failed.");
assert.equal(await exists(blockedRoot), false, "Top-level guard cleanup invariant failed.");
console.log("PASS: live hierarchical branch creation, explicit-parent behavior, top-level guard, and cleanup");
