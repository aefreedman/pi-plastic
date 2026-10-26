import assert from "node:assert/strict";
import { configuredLiveWorkspace, PlasticLiveHarness } from "./plastic-live-harness.ts";

const workspace = configuredLiveWorkspace();
if (!workspace) {
  console.log("SKIP: set PI_PLASTIC_TEST_WORKSPACE to run opt-in Plastic live smoke tests");
  process.exit(0);
}
const live = await PlasticLiveHarness.create(workspace);
try {
  const initial = live.clean();
  const status = await live.tool("plastic_status", { source: "xml", maxItems: 500, format: "text" });
  assert.equal(status.completeness.read, "complete");
  assert.equal(status.completeness.capture, "complete");
  assert.equal(status.data.itemCount.parsed, 0);
  assert.equal(status.data.itemCount.omitted, 0);
  assert.equal(status.data.summary.totalPending, 0);
  const branch = await live.tool("plastic_currentBranch", { format: "text" });
  assert.equal(branch.data.branch, initial.branch, "Registered branch must agree with independent native observation.");
  const exists = await live.tool("plastic_branchExists", { branch: initial.branch, format: "text" });
  assert.equal(exists.data.exists, true);
  const markers = await live.tool("plastic_mergeListConflictMarkers", { format: "text" });
  assert.equal(markers.data.inspection.state, "clear");
  const final = live.clean(initial.branch);
  assert.equal(final.changeset, initial.changeset, "Read-only smoke must not create or load another changeset.");
  live.saveSummary({ outcome: "passed", initial, final });
  console.log(`PASS: registered structured outputs agree with independent native clean/branch/marker observations; private evidence: ${live.evidenceDirectory}`);
} catch (error) {
  live.saveSummary({ outcome: "failed", error: String(error) });
  console.error(`Live smoke failed; private evidence: ${live.evidenceDirectory}`);
  throw error;
}
