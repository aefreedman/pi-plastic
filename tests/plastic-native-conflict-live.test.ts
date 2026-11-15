import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configuredLiveWorkspace, PlasticLiveHarness, parseLiveXml, xmlTexts } from "./plastic-live-harness";
const workspace = configuredLiveWorkspace(true);
if (!workspace) { console.log("SKIP: authorize a disposable sandbox for native binary conflict validation"); process.exit(0); }
const live = await PlasticLiveHarness.create(workspace);
try {
    const original = live.clean(), target = `${original.branch}/pi-binary-${live.runId}`, source = target + "/source";
    const directory = join(workspace, "fixtures", `pi-binary-${live.runId}`), file = join(directory, "owned.png");
    live.createBranch(target); live.switch(target); mkdirSync(directory, { recursive: true }); writeFileSync(file, Buffer.from([0, 1, 2, 3, 4])); live.native(["add", directory, "-R"]);
    const baseline = live.setupCheckin([directory], "pi-plastic binary baseline");
    const metadata = parseLiveXml(live.native(["fileinfo", file, "--fields=ClientPath,Type", "--xml", "--encoding=utf-8"]).stdout); assert.equal(xmlTexts(metadata, "Type")[0], "bin", "Must be a genuine native binary fixture.");
    live.createBranch(source); live.switch(source); writeFileSync(file, Buffer.from([0, 10, 2, 3, 4])); const incoming = live.setupCheckin([file], "pi-plastic binary source");
    live.switch(target); writeFileSync(file, Buffer.from([0, 1, 20, 3, 4])); const targetId = live.setupCheckin([file], "pi-plastic binary target");
    const start = live.toolCommands.length;
    const receipt = await live.tool("plastic_mergeToBranch", { source, target, updateTarget: false, message: "pi-plastic binary conflict must stop" }, false);
    assert(!receipt.ok); assert(!receipt.data.stages.some((s: { name: string }) => s.name === "checkin"));
    const applied = receipt.data.stages.find((s: { name: string }) => s.name === "merge"); assert(applied); assert.notEqual(applied.result.data.attempt.exitCode, 0);
    assert.equal(live.toolCommands.slice(start).filter(c => c.args[0] === "merge" && c.args.includes("--merge")).length, 1);
    assert(!live.toolCommands.slice(start).some(c => c.args[0] === "checkin"));
    const state = live.state(); assert.equal(state.branch, target); assert.equal(state.changeset, targetId);
    live.saveSummary({ outcome: "passed-conflict-state-preserved", original, target, source, file, baseline, incoming, targetId, state, receipt, cleanup: "Expected unresolved binary fixture deliberately preserved; separate recovery authorization required." });
    console.log(`PASS: native binary conflict stops compound before checkin; state preserved for deliberate recovery; ${live.evidenceDirectory}`);
} catch (error) { live.saveSummary({ outcome: "failed-preserved", error: String(error) }); console.error(`STOP: inspect preserved binary fixture; ${live.evidenceDirectory}`); throw error; }
