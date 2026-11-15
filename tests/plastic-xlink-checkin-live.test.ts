import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configuredLiveWorkspace, PlasticLiveHarness, parseLiveXml, xmlTexts } from "./plastic-live-harness.ts";

const workspace = configuredLiveWorkspace(true), linkedRepository = process.env.PI_PLASTIC_TEST_XLINK_REPOSITORY?.trim();
if (!workspace || !linkedRepository) { console.log("SKIP: configure an authorized disposable workspace and existing synthetic PI_PLASTIC_TEST_XLINK_REPOSITORY"); process.exit(0); }
assert(linkedRepository.length <= 4096 && !/[@\r\n\x00-\x1f]/.test(linkedRepository), "Supply only the exact existing synthetic repository name; the workspace supplies the server.");
const live = await PlasticLiveHarness.create(workspace);
try {
  const original = live.clean();
  const status = parseLiveXml(live.native(["status", "--xml", "--encoding=utf-8"]).stdout), server = xmlTexts(status, "Server")[0];
  assert.notEqual(linkedRepository, xmlTexts(status, "Name")[0], "A repository cannot be mounted inside itself.");
  const target = `${original.branch}/pi-xlink-checkin-${live.runId}`, directory = join(workspace, "fixtures", `pi-xlink-checkin-${live.runId}`);
  const mount = join(directory, "mount"), rootFile = join(directory, "root.txt"), linkedFile = join(mount, "linked.txt");
  live.createBranch(target); live.switch(target);
  mkdirSync(directory, { recursive: true }); writeFileSync(rootFile, "root baseline\n"); live.native(["add", rootFile]);
  // Reuse an existing empty synthetic /main baseline; never create accounts,
  // repositories or additional independently registered workspaces in this test.
  live.native(["xlink", "-w", mount, "/", `cs:0@${linkedRepository}@${server}`]);
  live.setupCheckin([directory], "pi-plastic Xlink mount setup");
  writeFileSync(rootFile, "root changed\n"); writeFileSync(linkedFile, "linked changed\n"); live.native(["add", linkedFile]);
  const start = live.toolCommands.length;
  const checked = await live.tool("plastic_checkin", { message: "pi-plastic native Xlink checkin", includeAll: true, applyChanged: true, format: "json" });
  assert.equal(checked.data.createdChangeset.mount, "/");
  assert.equal(checked.data.createdChangeset.branch, target);
  assert.equal(checked.data.linkedChangesets.length, 1);
  const linked = checked.data.linkedChangesets[0];
  assert.equal(linked.repository, linkedRepository); assert.equal(linked.server, server);
  assert(checked.data.identityObservation.complete, "Identity observation is separate from independently verified effects below.");
  assert.equal(live.toolCommands.slice(start).filter(c => c.args[0] === "checkin").length, 1, "No applying retry.");
  const rootLog = parseLiveXml(live.native(["log", `cs:${checked.data.createdChangeset.id}`, "--xml"]).stdout);
  assert.equal(xmlTexts(rootLog, "Branch")[0], target);
  const linkedLog = parseLiveXml(live.native(["log", `cs:${linked.id}@${linked.repository}@${linked.server}`, "--xml"]).stdout);
  assert.equal(xmlTexts(linkedLog, "ChangesetId")[0], linked.id);
  assert.equal(xmlTexts(linkedLog, "Branch")[0], linked.branch);
  assert(xmlTexts(rootLog, "DstCmPath").some(p => p.endsWith("root.txt")));
  assert(xmlTexts(linkedLog, "DstCmPath").some(p => p.endsWith("linked.txt")));
  assert.equal(readFileSync(rootFile, "utf8"), "root changed\n"); assert.equal(readFileSync(linkedFile, "utf8"), "linked changed\n");
  assert.equal(live.native(["cat", `${rootFile}#cs:${checked.data.createdChangeset.id}`]).stdout, "root changed\n");
  assert.equal(live.native(["cat", `${linkedFile}#cs:${linked.id}`]).stdout, "linked changed\n");
  live.clean(target); live.switch(original.branch);
  const final = live.clean(original.branch); assert.equal(final.changeset, original.changeset);
  live.saveSummary({ outcome: "passed", original, final, linkedRepository, target, mount });
  console.log(`PASS: registered Xlink checkin, exact root/linked emissions, independent both-repository history/content and clean restoration; private evidence: ${live.evidenceDirectory}`);
} catch (error) {
  live.saveSummary({ outcome: "failed", error: String(error) });
  console.error(`Xlink checkin failed; preserved state, private evidence: ${live.evidenceDirectory}`);
  throw error;
}
