import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { configuredLiveWorkspace, PlasticLiveHarness, parseLiveXml, xmlTexts } from "./plastic-live-harness";
const workspace = configuredLiveWorkspace(true);
if (!workspace) { console.log("SKIP: explicitly authorize disposable sandbox mutations"); process.exit(0); }
const live = await PlasticLiveHarness.create(workspace);
try {
    const original = live.clean();
    for (const selector of ["label", "shelveset"] as const) {
        const target = `${original.branch}/pi-selector-${live.runId}-${selector}`, source = target + "/source";
        const directory = join(workspace, "fixtures", `pi-selector-${live.runId}-${selector}`), file = join(directory, "owned.txt");
        live.createBranch(target); live.switch(target); mkdirSync(directory, { recursive: true }); writeFileSync(file, "base\n"); live.native(["add", directory, "-R"]);
        const baseline = live.setupCheckin([directory], "pi-plastic selector baseline");
        live.createBranch(source); live.switch(source); writeFileSync(file, `${selector} source\n`);
        let operand: string;
        if (selector === "shelveset") {
            const output = live.native(["shelveset", "create", file, "--all", "--summaryformat", "-c=pi-plastic selector shelf"]).stdout;
            const emitted = /sh:[^\r\n]+/.exec(output)?.[0]; assert(emitted, "Native shelf must emit exact selector."); operand = emitted;
        } else operand = "";
        const incoming = live.setupCheckin([file], "pi-plastic selector source");
        if (selector === "label") { const name = `pi-selector-${live.runId}`; live.native(["label", "create", name, `cs:${incoming}`]); operand = `lb:${name}`; }
        live.switch(target);
        const start = live.toolCommands.length;
        const merged = await live.tool("plastic_merge", { source: operand!, format: "json" }); assert(merged.data.commandCompleted);
        assert.equal(readFileSync(file, "utf8"), `${selector} source\n`);
        const checked = await live.tool("plastic_checkin", { message: "pi-plastic native selector merge", includeAll: true, format: "json" });
        assert(checked.data.createdChangeset); const id = checked.data.createdChangeset.id;
        const history = parseLiveXml(live.native(["log", `cs:${id}`, "--xml"]).stdout); assert.equal(xmlTexts(history, "Branch")[0], target);
        assert.equal(live.native(["cat", `${file}#cs:${id}`]).stdout, `${selector} source\n`);
        if (selector === "label") live.verifyIntegration(id, target, incoming, baseline, [relative(workspace, file)]);
        assert.equal(live.toolCommands.slice(start).filter(c => c.args[0] === "merge").length, 1); assert.equal(live.toolCommands.slice(start).filter(c => c.args[0] === "checkin").length, 1);
        live.clean(target); live.switch(original.branch); live.record("scenario-passed", { selector, target, source, operand, incoming, root: checked.data.createdChangeset });
    }
    const final = live.clean(original.branch); assert.equal(final.changeset, original.changeset); live.saveSummary({ outcome: "passed", original, final });
    console.log(`PASS: native label/shelveset selectors, one applying command, exact historical bytes and clean restoration; ${live.evidenceDirectory}`);
} catch (error) { live.saveSummary({ outcome: "failed-preserved", error: String(error) }); console.error(`STOP: inspect preserved state; ${live.evidenceDirectory}`); throw error; }
