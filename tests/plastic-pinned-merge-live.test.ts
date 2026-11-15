import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { configuredLiveWorkspace, PlasticLiveHarness, parseLiveXml, xmlTexts } from "./plastic-live-harness.ts";

const workspace = configuredLiveWorkspace(true);
if (!workspace) { console.log("SKIP: configure an explicitly authorized disposable Plastic workspace"); process.exit(0); }
const live = await PlasticLiveHarness.create(workspace);
try {
  const original = live.clean();
  const status = parseLiveXml(live.native(["status", "--xml", "--encoding=utf-8"]).stdout);
  const repository = xmlTexts(status, "Name")[0], server = xmlTexts(status, "Server")[0];
  const target = `${original.branch}/pi-pinned-${live.runId}`, source = `${target}/source`;
  const directory = join(workspace, "fixtures", `pi-pinned-${live.runId}`), file = join(directory, "owned.txt");
  live.createBranch(target); live.switch(target);
  mkdirSync(directory, { recursive: true }); writeFileSync(file, "base first\nbase last\n");
  live.native(["add", directory, "-R"]);
  const baseline = live.setupCheckin([directory], "pi-plastic pinned baseline");
  live.createBranch(source); live.switch(source);
  writeFileSync(file, "source first\nbase last\n");
  const sourceId = live.setupCheckin([file], "pi-plastic pinned source");
  live.switch(target);
  // A loaded-base diff uses actual current-client XML, not a synthetic profile.
  const unchanged = await live.tool("plastic_diff", { mode: "file", path: relative(workspace, file), format: "json" });
  assert.equal(unchanged.data.changed, false);
  writeFileSync(file, "base first\ntarget last\n");
  const changed = await live.tool("plastic_diff", { mode: "file", path: relative(workspace, file), format: "json" });
  assert.equal(changed.data.changed, true);
  live.setupCheckin([file], "pi-plastic pinned target");
  const start = live.toolCommands.length;
  const merged = await live.tool("plastic_merge", { source: `cs:${sourceId}@rep:${repository}@repserver:${server}`, format: "json" });
  assert.equal(merged.data.assessment.ready, true);
  assert.equal(readFileSync(file, "utf8"), "source first\ntarget last\n");
  const checked = await live.tool("plastic_checkin", { message: "pi-plastic pinned merge", includeAll: true, format: "json" });
  live.verifyIntegration(checked.data.createdChangeset.id, target, sourceId, baseline, [relative(workspace, file)]);
  const noop = await live.tool("plastic_merge", { source: `cs:${sourceId}`, format: "json" });
  assert.equal(noop.data.commandCompleted, true);
  assert.equal(live.toolCommands.slice(start).filter(c => c.args[0] === "merge" && c.args.includes("--merge")).length, 2, "Exactly the initial and explicit no-op merge, never a replay.");
  live.switch(original.branch);
  const final = live.clean(original.branch);
  assert.equal(final.changeset, original.changeset);
  live.saveSummary({ outcome: "passed", original, final });
  console.log(`PASS: pinned merge, independent ancestry/content, current-client loaded-base diff and no-op; private evidence: ${live.evidenceDirectory}`);
} catch (error) {
  live.saveSummary({ outcome: "failed", error: String(error) });
  console.error(`Pinned merge failed; preserved sandbox, private evidence: ${live.evidenceDirectory}`);
  throw error;
}
