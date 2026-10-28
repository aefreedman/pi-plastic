import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configuredLiveWorkspace, parseLiveXml, PlasticLiveHarness, xmlTexts } from "./plastic-live-harness.ts";

const workspace = configuredLiveWorkspace(true);
if (!workspace) {
  console.log("SKIP: set exact disposable workspace, mutation permission and sandbox attestation for the replaced-checkout live test");
  process.exit(0);
}
const live = await PlasticLiveHarness.create(workspace);
let original: ReturnType<typeof live.clean> | undefined;
let branch = "", file = "";
try {
  original = live.clean();
  branch = `${original.branch}/pi-replaced-checkout-${live.runId}`;
  const root = join(workspace, "fixtures", `pi-replaced-checkout-${live.runId}`);
  assert(!existsSync(root));
  file = join(root, "replaced checkout.txt");
  live.createBranch(branch);
  live.switch(branch);
  mkdirSync(root, { recursive: true });
  const baselineBytes = "original revision with UTF-8 café λ\n";
  writeFileSync(file, baselineBytes);
  live.native(["add", root, "-R"]);
  const baseline = live.setupCheckin([root], "pi-plastic replaced-checkout baseline");
  writeFileSync(file, "later revision\n");
  live.setupCheckin([file], "pi-plastic replaced-checkout later revision");
  // Native revert marks this exact owned file checked-out/replaced itself.
  // It is setup, not a recovery/retry of the producer under test.
  live.native(["revert", `${file}#cs:${baseline}`]);
  const pending = live.native(["status", "--machinereadable", "--includeRevId", "--fieldseparator=\x1f"]).stdout;
  const fields = pending.split(/\r?\n/).find(line => line.startsWith("CO+RP\x1f"))?.split("\x1f");
  assert(fields && fields.length === 5, "Setup must actually produce CO+RP, not a substituted profile.");
  assert.equal(fields[1].toLowerCase(), file.toLowerCase());
  assert.equal(fields[2], "False");
  assert.match(fields[3], /^[1-9][0-9]*$/);
  assert.equal(fields[4], "NO_MERGES");
  const before = live.state();
  assert.equal(before.pendingPaths.length, 1);
  assert.match(before.standard, /Replaced \/ Checked-out \(unchanged\)/);
  assert.equal(readFileSync(file, "utf8"), baselineBytes);
  const previewStart = live.toolCommands.length;
  const preview = await live.tool("plastic_checkin", { message: "pi-plastic replaced-checkout preview", paths: [file], preflight: true });
  assert.equal(preview.outcome, "preflight");
  assert(preview.data.assessment.ready);
  assert(!live.toolCommands.slice(previewStart).some(command => command.args[0] === "checkin"));
  const applyStart = live.toolCommands.length;
  const receipt = await live.tool("plastic_checkin", { message: "pi-plastic replaced-checkout regression", paths: [file] });
  assert.equal(receipt.outcome, "completed");
  assert(receipt.data.createdChangeset?.id);
  assert.equal(live.toolCommands.slice(applyStart).filter(command => command.args[0] === "checkin").length, 1);
  assert.equal(readFileSync(file, "utf8"), baselineBytes);
  const history = parseLiveXml(live.native(["log", `cs:${receipt.data.createdChangeset.id}`, "--xml"]).stdout);
  assert.equal(xmlTexts(history, "Branch")[0], branch);
  assert(xmlTexts(history, "DstCmPath").some(path => path.endsWith("replaced checkout.txt")));
  live.clean(branch);
  live.switch(original.branch);
  const restored = live.clean(original.branch);
  assert.equal(restored.changeset, original.changeset);
  live.saveSummary({ outcome: "passed", original, restored, branch, file, createdChangeset: receipt.data.createdChangeset, cleanup: "Original clean branch restored; synthetic branch/history retained." });
  console.log(`PASS: real CO+RP preflight and single checkin, exact reverted bytes and native history; original clean branch restored; private evidence: ${live.evidenceDirectory}`);
} catch (error) {
  let observedState: unknown;
  try { observedState = live.state(); } catch (inspectionError) { observedState = { error: String(inspectionError) }; }
  live.saveSummary({ outcome: "failed", error: String(error), original, branch, file, observedState, cleanup: "No automatic undo, checkin workaround or dirty switch. Inspect owned state before recovery." });
  console.error(`Replaced-checkout regression stopped; sandbox state preserved. Private evidence: ${live.evidenceDirectory}`);
  throw error;
}
