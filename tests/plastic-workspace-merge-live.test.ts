import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { configuredLiveWorkspace, parseLiveXml, PlasticLiveHarness, xmlTexts } from "./plastic-live-harness.ts";

const configured = process.env.PI_PLASTIC_TEST_WORKSPACE?.trim();
if (!configured) {
  console.log("SKIP: set PI_PLASTIC_TEST_WORKSPACE plus explicit mutation and disposable-sandbox attestations to run live workspace merge tests");
  process.exit(0);
}
const workspace = configuredLiveWorkspace(true)!;
const live = await PlasticLiveHarness.create(workspace);
const selected = new Set((process.env.PI_PLASTIC_LIVE_SCENARIOS ?? "mixed-forward,mixed-native,mixed-relative,scope-private,merged-private,no-op,text-conflict").split(","));
const allowed = ["mixed-forward", "mixed-native", "mixed-relative", "scope-private", "merged-private", "merged-unrelated", "no-op", "large-merge", "text-conflict", "unicode-path"];
assert([...selected].every(name => allowed.includes(name)), "Unknown live scenario; do not silently run a different matrix.");
let original: ReturnType<typeof live.clean> | undefined;
let ownedRoot = "";
let runBranch = "";
let expectedPreservedState = false;
assert(!["large-merge", "unicode-path", "merged-unrelated"].some(name => selected.has(name)) || selected.size === 1, "Capacity, encoding and unsupported-scope probes run alone because expected pending state is preserved.");
const put = (path: string, contents: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents, "utf8"); };
const sourceText = "source first line\n" + Array.from({ length: 30 }, (_, n) => `unchanged middle ${n}\n`).join("") + "base last line\n";
const baseText = sourceText.replace("source first line", "base first line");
const expectedMixedFiles = ["existing plain.txt", "existing secondary.txt", "new space.txt", "new content.txt", "delete me.txt"];

function setup(name: string) {
  live.switch(runBranch);
  const target = `${runBranch}/${name}`;
  live.createBranch(target);
  live.switch(target);
  const root = join(ownedRoot, name, "nested project", "Assets", "Tests");
  for (const file of ["existing plain.txt", "existing secondary.txt", "delete me.txt", "unrelated.txt"]) put(join(root, file), baseText);
  live.native(["add", join(ownedRoot, name), "-R"]);
  const baseline = live.setupCheckin([join(ownedRoot, name)], `pi-plastic ${name} baseline`);
  return { target, root, baseline };
}
function createSource(target: string) {
  const source = `${target}/feature`;
  live.createBranch(source);
  live.switch(source);
  return source;
}
async function mixed(name: string, workdir: string) {
  const { target, root, baseline } = setup(name);
  const source = createSource(target);
  for (const file of ["existing plain.txt", "existing secondary.txt"]) put(join(root, file), sourceText);
  for (const file of ["new space.txt", "new content.txt"]) put(join(root, file), "source-added UTF-8 café λ\n");
  live.native(["add", join(root, "new space.txt"), join(root, "new content.txt")]);
  live.native(["remove", join(root, "delete me.txt")]);
  const sourceId = live.setupCheckin([join(ownedRoot, name)], `pi-plastic ${name} source`);
  // Target divergence is non-overlapping: native auto must preserve both ends.
  live.switch(target);
  put(join(root, "existing plain.txt"), baseText.replace("base last line", "target last line"));
  live.setupCheckin([join(root, "existing plain.txt")], `pi-plastic ${name} target divergence`);
  live.switch(source);
  const priorCwd = process.cwd();
  if (workdir === ".") process.chdir(workspace);
  let receipt;
  try { receipt = await live.tool("plastic_mergeToBranch", { source, target, message: `pi-plastic ${name} merge`, workdir, format: "text" }); }
  finally { process.chdir(priorCwd); }
  const created = receipt.data.createdChangeset?.id;
  assert(created, "Closeout must expose created target changeset.");
  assert.equal(readFileSync(join(root, "existing plain.txt"), "utf8"), sourceText.replace("base last line", "target last line"), "Auto-merged content must preserve source and target contributions.");
  assert.equal(readFileSync(join(root, "existing secondary.txt"), "utf8"), sourceText);
  for (const file of ["new space.txt", "new content.txt"]) assert.equal(readFileSync(join(root, file), "utf8"), "source-added UTF-8 café λ\n");
  assert(!existsSync(join(root, "delete me.txt")));
  live.verifyIntegration(created, target, sourceId, baseline, expectedMixedFiles.map(file => relative(workspace, join(root, file))));
  const sourceHistory = parseLiveXml(live.native(["log", `cs:${sourceId}`, "--xml"]).stdout);
  assert.equal(xmlTexts(sourceHistory, "Branch")[0], source);
}

try {
  original = live.clean();
  live.native(["version"]);
  runBranch = `${original.branch}/pi-merge-live-${live.runId}`;
  ownedRoot = join(workspace, "fixtures", `pi-merge-live-${live.runId}`);
  assert(!existsSync(ownedRoot), "Run-owned fixture directory must not exist.");
  live.createBranch(runBranch);
  live.switch(runBranch);
  for (const [name, workdir] of [["mixed-forward", workspace.replaceAll("\\", "/")], ["mixed-native", workspace], ["mixed-relative", "."]]) {
    if (selected.has(name)) await live.scenario(name, () => mixed(name, workdir));
  }
  if (selected.has("scope-private")) await live.scenario("scope-private", async () => {
    const { target, root } = setup("scope-private");
    const selectedFile = join(root, "existing plain.txt"), unrelated = join(root, "unrelated.txt"), privateFile = join(root, "leave private.txt");
    put(selectedFile, "selected standalone edit\n");
    put(unrelated, "unrelated controlled edit\n");
    put(privateFile, "private work must remain untouched\n");
    const receipt = await live.tool("plastic_checkin", { message: "pi-plastic selected scope", paths: [selectedFile], format: "text" });
    assert(receipt.data.createdChangeset?.id);
    const state = live.state();
    assert.equal(state.branch, target);
    assert(state.pendingPaths.some(path => path.endsWith("unrelated.txt")), "Unselected controlled change must survive.");
    assert.equal(readFileSync(privateFile, "utf8"), "private work must remain untouched\n");
    const history = parseLiveXml(live.native(["log", `cs:${receipt.data.createdChangeset.id}`, "--xml"]).stdout);
    assert(xmlTexts(history, "DstCmPath").some(path => path.endsWith("existing plain.txt")));
    assert(!xmlTexts(history, "DstCmPath").some(path => /unrelated\.txt|leave private\.txt/.test(path)), "Selected checkin must not silently include unrelated work.");
    // This is an explicit fixture teardown, not producer recovery: only exact
    // known run-owned private bytes are removed; controlled edits get their own
    // fixture checkin rather than a broad undo.
    unlinkSync(privateFile);
    live.setupCheckin([unrelated], "pi-plastic preserve unrelated owned fixture edit");
    live.clean(target);
  });
  for (const name of ["merged-private", "merged-unrelated"]) if (selected.has(name)) await live.scenario(name, async () => {
    const { target, root, baseline } = setup(name);
    const source = createSource(target);
    const changed = join(root, "existing plain.txt"), added = join(root, "source added.txt");
    put(changed, sourceText); put(added, "source addition with Unicode content café λ\n");
    live.native(["add", added]);
    const sourceId = live.setupCheckin([root], `pi-plastic ${name} source`);
    live.switch(target);
    await live.tool("plastic_merge", { source });
    const privateFile = join(ownedRoot, name, "private sibling.txt");
    put(privateFile, "disjoint private bytes must survive\n");
    if (name === "merged-unrelated") put(join(root, "unrelated.txt"), "unrelated controlled edit\n");
    const commandStart = live.toolCommands.length;
    const receipt = await live.tool("plastic_checkin", { message: `pi-plastic ${name} scope probe`, paths: [changed, added], includePrivate: false }, name === "merged-private");
    assert.equal(readFileSync(privateFile, "utf8"), "disjoint private bytes must survive\n");
    if (name === "merged-private") {
      assert(receipt.data.createdChangeset?.id);
      const state = live.state();
      assert.equal(state.pendingPaths.length, 1, "Only the explicitly excluded private sibling may remain pending.");
      assert(state.pendingPaths[0].endsWith("private sibling.txt"));
      unlinkSync(privateFile);
      live.verifyIntegration(receipt.data.createdChangeset.id, target, sourceId, baseline, [changed, added].map(file => relative(workspace, file)));
    } else {
      assert.equal(receipt.ok, false);
      assert.equal(receipt.data.createdChangeset, null);
      assert.notEqual(receipt.error?.code, "pending_source_unadmitted", "Valid mixed state must be parsed, then explicitly blocked by scope policy.");
      assert(/scope|unrelated|controlled/i.test(JSON.stringify(receipt.error)), "The blocked operation must identify its actual scope policy.");
      assert(!live.toolCommands.slice(commandStart).some(command => command.args[0] === "checkin"), "Unsupported mixed controlled scope must block before native checkin.");
      const state = live.state();
      assert(state.pendingPaths.some(path => path.endsWith("unrelated.txt")));
      assert(state.pendingPaths.some(path => path.endsWith("source added.txt")));
      assert(JSON.stringify(receipt.data).includes("unrelated.txt"), "Receipt must retain unrelated observed row, not erase it as parse failure.");
      expectedPreservedState = true;
    }
  });
  if (selected.has("no-op")) await live.scenario("no-op", async () => {
    const { target, root, baseline } = setup("no-op");
    const source = createSource(target);
    put(join(root, "existing plain.txt"), sourceText);
    const sourceId = live.setupCheckin([join(root, "existing plain.txt")], "pi-plastic no-op source");
    const first = await live.tool("plastic_mergeToBranch", { source, target, message: "pi-plastic no-op initial closeout" });
    live.verifyIntegration(first.data.createdChangeset.id, target, sourceId, baseline, [relative(workspace, join(root, "existing plain.txt"))]);
    const before = live.clean(target);
    const merge = await live.tool("plastic_merge", { source, workdir: workspace.replaceAll("\\", "/") });
    assert.equal(merge.data.commandCompleted, true);
    const after = live.clean(target);
    assert.equal(after.changeset, before.changeset, "No-op merge must not invent a changeset.");
  });
  if (selected.has("large-merge")) await live.scenario("large-merge", async () => {
    const { target, root, baseline } = setup("large-merge");
    const source = createSource(target);
    const files = Array.from({ length: 130 }, (_, n) => join(root, `bulk-${String(n).padStart(3, "0")}.txt`));
    for (const file of files) put(file, `owned bulk source ${file.split("bulk-").at(-1)}\n`);
    live.native(["add", root, "-R"]);
    const sourceId = live.setupCheckin([root], "pi-plastic large source");
    const receipt = await live.tool("plastic_mergeToBranch", { source, target, message: "pi-plastic >128-path closeout", workdir: workspace.replaceAll("\\", "/") }, false);
    const state = live.state();
    if (receipt.ok) {
      assert(receipt.data.createdChangeset?.id);
      for (const file of files) assert(readFileSync(file, "utf8").startsWith("owned bulk source "));
      live.verifyIntegration(receipt.data.createdChangeset.id, target, sourceId, baseline, files.map(file => relative(workspace, file)));
    } else {
      // Boundedness is a valid stop, never a silent successful prefix. Keep the
      // applied merge intact for inspection rather than silently checking it in.
      assert.equal(receipt.data.createdChangeset, null);
      assert.equal(state.branch, target);
      assert(state.pendingPaths.length >= 130, "Bounded failure must not hide native full pending scope.");
      const diagnostic = JSON.stringify(receipt.error) + JSON.stringify(receipt.data);
      assert(/limit|bound|omitt|truncat|incomplete|too.many|capacity/i.test(diagnostic), "A capacity stop must identify its actual bound, not generic profile rejection.");
      expectedPreservedState = true;
    }
  });
  if (selected.has("text-conflict")) await live.scenario("text-conflict", async () => {
    const { target, root } = setup("text-conflict");
    const source = createSource(target);
    const conflictFile = join(root, "existing plain.txt");
    put(conflictFile, "source conflicts on first line\n" + baseText.slice(baseText.indexOf("\n") + 1));
    const sourceId = live.setupCheckin([conflictFile], "pi-plastic conflict source");
    live.switch(target);
    put(conflictFile, "destination conflicts on first line\n" + baseText.slice(baseText.indexOf("\n") + 1));
    const targetId = live.setupCheckin([conflictFile], "pi-plastic conflict destination");
    const commandStart = live.toolCommands.length;
    const merged = await live.tool("plastic_mergeToBranch", { source, target, message: "pi-plastic unresolved conflict must not check in", workdir: workspace.replaceAll("\\", "/") }, false);
    assert.equal(merged.ok, false);
    assert.equal(merged.data.createdChangeset, null);
    assert(!merged.data.stages.some((stage: any) => stage.name === "checkin"), "Unresolved closeout must stop before checkin.");
    const state = live.state();
    assert.equal(state.branch, target);
    assert.equal(state.changeset, targetId, "Failure must not create/load a checkin.");
    assert(state.pendingPaths.some(path => path.endsWith("existing plain.txt")));
    const bytes = readFileSync(conflictFile, "utf8");
    assert(/<<<<<<<[\s\S]*=======[\s\S]*>>>>>>>/.test(bytes), "Actual diff3 markers establish a real conflict fixture.");
    const markerRead = await live.tool("plastic_mergeListConflictMarkers", {}, false);
    assert.notEqual(markerRead.data.inspection.state, "clear");
    const checked = await live.tool("plastic_checkin", { message: "pi-plastic unresolved checkin must be blocked", paths: [conflictFile] }, false);
    assert.equal(checked.ok, false);
    assert.equal(checked.data.createdChangeset, null);
    assert(!checked.data.steps.some((step: any) => step.operation === "checkin"), "Standalone checkin must not dispatch on unresolved markers.");
    assert.equal(live.state().changeset, targetId);
    const dispatched = live.toolCommands.slice(commandStart).map(command => command.args);
    assert.equal(dispatched.filter(args => args[0] === "merge" && args.includes("--merge")).length, 1, "Real process seam must observe exactly one applying merge, never a replay.");
    assert(!dispatched.some(args => args[0] === "checkin"), "No native checkin process may be launched for unresolved state.");
    assert(!dispatched.some(args => args.some(arg => /^(?:--forced|--keepsource|--keepdestination|--markresolved)(?:=|$)/i.test(arg))), "No implicit discard/force/marker bypass.");
    // Reconcile this exact owned synthetic conflict deliberately after testing
    // the negative control. No merge replay, force, or mark-resolved bypass.
    put(conflictFile, "source and destination deliberately reconciled\n" + baseText.slice(baseText.indexOf("\n") + 1));
    const markersAfterEdit = live.native(["merge", "--list-conflict-markers"], true);
    assert.equal(markersAfterEdit.status, 0, "Marker tracker must clear after actual content reconciliation.");
    assert.equal(markersAfterEdit.stdout, "");
    assert.equal(markersAfterEdit.stderr, "");
    const resolved = await live.tool("plastic_checkin", { message: "pi-plastic deliberate synthetic conflict reconciliation", includeAll: true });
    live.verifyIntegration(resolved.data.createdChangeset.id, target, sourceId, targetId, [relative(workspace, conflictFile)]);
  });
  if (selected.has("unicode-path")) await live.scenario("unicode-path", async () => {
    const { target, root, baseline } = setup("unicode-path");
    const source = createSource(target);
    const file = join(root, "unicode café λ.txt");
    put(file, "Unicode path and content café λ\n");
    live.native(["add", file]);
    const sourceId = live.setupCheckin([file], "pi-plastic unicode-path source");
    const receipt = await live.tool("plastic_mergeToBranch", { source, target, message: "pi-plastic unicode-path encoding probe" }, false);
    if (receipt.ok) {
      assert.equal(readFileSync(file, "utf8"), "Unicode path and content café λ\n");
      live.verifyIntegration(receipt.data.createdChangeset.id, target, sourceId, baseline, [relative(workspace, file)]);
    } else {
      assert.equal(receipt.data.createdChangeset, null);
      const state = live.state();
      assert.equal(state.branch, target);
      assert(state.pendingPaths.some(path => path.endsWith("unicode café λ.txt")), "Independent UTF-8 XML must retain original Unicode path.");
      assert(!receipt.data.stages.some((stage: any) => stage.name === "checkin"));
      assert(/utf|encod|capture|unicode|unsupported|unadmitted|child_failed/i.test(JSON.stringify(receipt)), "Unicode capture failure must be explicit, never empty-state success.");
      expectedPreservedState = true;
    }
  });
  if (expectedPreservedState) {
    live.saveSummary({ outcome: "passed-state-preserved", original, runBranch, ownedRoot, observedState: live.state(), cleanup: "Expected bounded/encoding stop; owned pending merge retained for explicit inspection, no automatic resolution or switch." });
    console.log(`PASS: negative/capacity probe preserved expected pending state; private evidence: ${live.evidenceDirectory}`);
    process.exit(0);
  }
  live.clean();
  live.switch(original.branch);
  const restored = live.clean(original.branch);
  assert.equal(restored.changeset, original.changeset, "Original branch head changed during isolated sandbox tests.");
  live.saveSummary({ outcome: "passed", original, restored, runBranch, retainedBranches: "Owned synthetic branches and changesets intentionally retained as evidence; no repository history deletion." });
  console.log(`PASS: ${live.outcomes.length} live workspace scenarios; original clean branch restored; private evidence: ${live.evidenceDirectory}`);
} catch (error) {
  // Never undo, delete branches, retry, reapply, force-finalize or switch a dirty
  // workspace in finally. Its exact partial state is valuable failure evidence.
  let observedState: unknown;
  try { observedState = live.state(); } catch (inspectionError) { observedState = { error: String(inspectionError) }; }
  live.saveSummary({ outcome: "failed", error: String(error), original, runBranch, ownedRoot, observedState, cleanup: "No automatic destructive cleanup. Inspect evidence and run-owned paths before an explicit recovery decision." });
  console.error(`Live regression stopped; sandbox state preserved. Private evidence: ${live.evidenceDirectory}`);
  throw error;
}
