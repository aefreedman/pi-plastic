import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseMergedApply, parseMergedPending, correlateMergedApply, correlateMergedCheckin, admitMergedStandardStatus } from "../src/domain/merged-workspace";
import { admitWorkspaceMergeOutput } from "../src/domain/workspace-merge-contract";
import { parseCheckinPending, parseCheckinEvidence } from "../src/domain/checkin-contract";
import { runWithAbortSignal } from "../src/execution/context";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { executeCheckinOutput, validateCheckinOutput } from "../src/pi/checkin-output";
import { checkin } from "../src/operations/checkin";
import { loadRegisteredTools } from "./pi-tool-harness";
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/plastic-real-merged-profiles.json", import.meta.url), "utf8")).fixtures as Array<{ label: string; stdout: string }>;
const get = (label: string) => fixtures.find(f => f.label === label)!.stdout;
const cwd = "C:\\Example\\workspace", token = "__EV_";
const separators = { start: token + "S__", end: token + "E__", field: token + "F__" };
// All mutations below are synthetic adversarial derivatives of sanitized captures.
const frame=(op:string,...fields:string[])=>separators.start+[op,...fields].join(separators.field)+separators.end+"\r\n";
const repeatedNames=frame("FILE_SRC","/a.txt","1","2","3")+frame("FILE_SRC","/dir/a.txt","1","2","4")+frame("DO_COPIED",cwd+"\\a.txt")+frame("DO_COPIED",cwd+"\\dir\\a.txt");
const repeatedPending=parseMergedPending("STATUS\x1f42\x1fExample Repository\x1fexample@unity\r\n"+["\\a.txt","\\dir\\a.txt"].map((p,i)=>["RP",cwd+p,"False",String(100+i),"Merge from 43"].join("\x1f")+"\r\n").join(""),cwd)!;
const repeatedDeclarations=parseMergedApply(repeatedNames,token);assert(repeatedDeclarations,"nested repeated basenames must pair bijectively");assert(correlateMergedApply(repeatedDeclarations,repeatedPending,cwd));
const foreignDeclarations=parseMergedApply(repeatedNames.replace(cwd+"\\a.txt","C:\\Other\\a.txt"),token);assert(!foreignDeclarations||!correlateMergedApply(foreignDeclarations,repeatedPending,cwd));
assert(!parseMergedApply(repeatedNames+frame("DO_COPIED",cwd+"\\elsewhere\\a.txt"),token),"extra suffix-compatible action is not a pairing");
for (const [applyLabel, pendingLabel, fullLabel, checkinLabel, sourceLeaf] of [
    ["089-apply-files", "090-files-merged-machine", "090-files-merged-full", "091-files-merge-checkin", "files-source"],
    ["023-apply-mixed", "024-merged-machine", "024-merged-full", "027-merge-native-checkin", "source"],
]) {
    const apply = get(applyLabel), machine = get(pendingLabel), full = get(fullLabel), native = get(checkinLabel);
    const source = `/main/evidence/${sourceLeaf}@Example Repository@example@unity`;
    const declarations = parseMergedApply(apply, token)!, pending = parseMergedPending(machine, cwd)!;
    assert(declarations); assert(pending); assert(correlateMergedApply(declarations, pending, cwd));
    assert(admitMergedStandardStatus(full, pending, source, cwd));
    assert.equal(admitWorkspaceMergeOutput(apply, token).protocol, "merged-candidate");
    const checkinPending = parseCheckinPending(machine, cwd); assert(checkinPending.admitted);
    assert.deepEqual(checkinPending.items.map(i => i.kind), pending.rows.map(r => r.status === "CP" ? "added" : r.status === "DE" ? "deleted" : "changed"));
    const events = parseCheckinEvidence(native, separators).events;
    assert(parseCheckinEvidence(native, separators).admitted);
    assert(correlateMergedCheckin(events, pending, cwd));
    for (const path of [cwd, cwd + "\\foreign", pending.rows[0].path.replace("\\fixtures", "\\..\\fixtures"), "C:\\Other\\parent"]) {
        assert(!correlateMergedCheckin([...events, { operation: "CO", path }], pending, cwd));
    }
    assert(!correlateMergedCheckin(events.filter(e => e.path !== pending.rows[0].path), pending, cwd));
    if (pending.rows.length > 1) {
        assert.equal(parseMergedPending(machine.replace(/Merge from [0-9]+/, "Merge from 999"), cwd), null);
        const duplicatedCase = machine + machine.split("\r\n")[1].replace("added.txt", "ADDED.txt") + "\r\n";
        assert.equal(parseMergedPending(duplicatedCase, cwd), null);
    }
    for (const suffix of [".", " "]) assert.equal(parseMergedPending(machine.replace(".txt", ".txt" + suffix), cwd), null);
    assert(!correlateMergedApply(declarations, { ...pending, rows: pending.rows.slice(1) }, cwd));
    assert(!admitMergedStandardStatus(full, { ...pending, repository: "Other Repository" }, source, cwd));
    for (const bad of [apply + apply, "noise" + apply, apply.replace("DO_", "UNKNOWN_"), apply.replace("/fixtures/", "/../fixtures/"), apply.replace("C:\\Example", "C:\\Other"), apply.replace("__EV_F__43", "__EV_F__043"), apply.slice(0, -12)]) {
        if (bad !== apply) { const d = parseMergedApply(bad, token); assert(!d || !correlateMergedApply(d, pending, cwd)); }
    }
    for (const bad of [machine + machine.split("\r\n")[1] + "\r\n", machine.replace("Merge from ", "Unknown "), machine.replace("C:\\Example", "C:\\Other"), machine.replace("\\fixtures\\", "\\..\\fixtures\\"), machine.replace("Merge from ", "Merge from 0"), machine + "CO\x1fC:\\Example\\workspace\\local.txt\x1fFalse\x1f-1\x1fNO_MERGES\r\n"]) assert.equal(parseMergedPending(bad, cwd), null);
    const wrongDirectory = parseMergedPending(machine.replace("False", "True"), cwd);
    assert(!wrongDirectory || !admitMergedStandardStatus(full, wrongDirectory, source, cwd));
    for (const bad of [full + "Merge in progress\r\n", full + full, full.replace(" at /main/evidence/", " at /main/other/"), full.replace("example@unity", "example@cloud"), full.replace("Changed", "Unknown"), full.replace("Merge from cs:", "Merge from cs:0"), full.replace("(Merge from ", "(Merge from 0"), full.replace("fixtures\\evidence", "fixtures\\other"), full.replace("    Merge from cs:", "Pending merge links\r\n    Merge from cs:")]) assert(!admitMergedStandardStatus(bad, pending, source, cwd));
    assert(!admitMergedStandardStatus(full, pending, source.replace("@unity", "@cloud"), cwd));
    for (const bad of [native + native, native.replace("__EV_S__RP", "__EV_S__UNKNOWN"), native + "noise", native.replace("mount:'/'", "mount:'/xlink'")]) {
        // changed-only has no RP: do not call an unchanged payload a negative.
        if (bad !== native) assert(!parseCheckinEvidence(bad, separators).admitted);
    }
    if (process.platform === "win32") {
        for (const mode of ["success", "registered-text", "registered-json", "core-json", "foreign-repository", "foreign-server", "foreign-branch", "unknown-tail", "warning", "missing-event", "extra-event", "duplicate-event", "post-fail", "unresolved", "private"]) {
            if (mode === "private" && sourceLeaf !== "source") continue;
            const calls: string[][] = []; let checked = false;
            const deps = { spawn: ((_: string, args: string[]) => {
                calls.push([...args]); const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
                queueMicrotask(() => {
                    child.emit("spawn"); let out = checked ? machine.split("\r\n")[0] + "\r\n" : machine, err = "";
                    if (!checked && mode === "unresolved") out = get("048-unresolved-machine");
                    if (!checked && mode === "private") out = get("026-with-private-machine");
                    if (args[0] === "status" && !args.includes("--machinereadable")) out = mode === "unresolved" ? get("048-unresolved-full") : mode === "private" ? get("026-with-private-full") : full;
                    if (args[0] === "checkin") {
                        checked = true; out = native;
                        if (mode === "foreign-repository") out = out.replace("Example Repository", "Other Repository");
                        if (mode === "foreign-server") out = out.replaceAll("example@unity", "example@cloud");
                        if (mode === "foreign-branch") out = out.replace("@br:/main/evidence", "@br:/main/other");
                        const nl = String.fromCharCode(13, 10);
                        if (mode === "missing-event") out = out.split(nl).filter(l => !l.includes("__EV_S__RP")).join(nl);
                        if (mode === "extra-event") out = out.replace("__EV_S__CHANGESET", "__EV_S__CO__EV_F__" + cwd + String.fromCharCode(92) + "foreign.txt__EV_E__" + nl + "__EV_S__CHANGESET");
                        if (mode === "duplicate-event") out = out.replace("__EV_S__CHANGESET", out.split(nl).find(l => l.startsWith("__EV_S__RP")) + nl + "__EV_S__CHANGESET");
                        if (mode === "unknown-tail") out += "unknown";
                        for (const [key, old] of [["--startlineseparator", "__EV_S__"], ["--endlineseparator", "__EV_E__"], ["--fieldseparator", "__EV_F__"]]) out = out.replaceAll(old, args.find(a => a.startsWith(key + "="))!.slice(key.length + 1));
                        if (mode === "warning") err = "Synthetic warning";
                    }
                    child.stdout.end(out); child.stderr.end(err); child.emit("close", checked && args[0] === "status" && mode === "post-fail" ? 1 : 0, null);
                }); return child;
            }) as any };
            const args = { message: "Synthetic merged fixture", workdir: cwd, includeAll: true, applyChanged: true, format: mode === "registered-text" ? "text" as const : "json" as const };
            const tools = mode.startsWith("registered-") ? await loadRegisteredTools() : null;
            const output = await runWithAbortSignal(undefined, () => tools ? tools.get("plastic_checkin")!.execute("fixture", args) : mode === "core-json" ? checkin.execute(args) : executeCheckinOutput(args), deps);
            const r = typeof output === "string" ? { structuredContent: JSON.parse(output) } : output as Awaited<ReturnType<typeof executeCheckinOutput>>;
            assert(validateCheckinOutput(r.structuredContent)); assert.equal(r.structuredContent.ok, ["success", "registered-text", "registered-json", "core-json", "private", "post-fail"].includes(mode), mode);
            assert.equal(calls.filter(c => c[0] === "checkin").length, mode === "unresolved" ? 0 : 1);
            assert(!calls.some(c => c[0] === "add"));
            if (mode === "private") {
                const argv = calls.find(c => c[0] === "checkin")!;
                assert(!argv.includes("--private"));
                assert(!argv.some(a => a.includes("unrelated-private")));
                assert.equal(r.structuredContent.data.excludedPaths.length, 3);
                assert.equal(r.structuredContent.data.includedPaths.length, pending.rows.length);
                for (const path of r.structuredContent.data.includedPaths) assert(argv.includes(path));
            }
            if (mode === "success") {
                assert.deepEqual(r.structuredContent.data.itemEvents.map(e => e.operation), parseCheckinEvidence(native, separators).events.map(e => e.operation));
                for (const mutate of [(d: any) => d.data.steps[1].evidence = "unadmitted", (d: any) => d.data.steps[1].attempt.exitCode = 1, (d: any) => d.data.steps.push(d.data.steps[1])]) {
                    const forged = structuredClone(r.structuredContent); mutate(forged); assert(!validateCheckinOutput(forged));
                }
            }
        }
        for (const mode of ["success", "warning", "pending-fail", "full-fail", "nonzero", "truncated", "extra", "missing", "wrong-source", "duplicate-link", "unresolved"]) {
            const calls: string[][] = [];
            const deps = { spawn: ((_: string, args: string[]) => {
                calls.push([...args]); const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
                queueMicrotask(() => {
                    child.emit("spawn"); let out = "", err = "", code = 0;
                    if (args[0] === "merge") {
                        out = apply;
                        for (const [key, old] of [["--startlineseparator", "__EV_S__"], ["--endlineseparator", "__EV_E__"], ["--fieldseparator", "__EV_F__"]]) out = out.replaceAll(old, args.find(a => a.startsWith(key + "="))!.slice(key.length + 1));
                        if (mode === "warning") err = "Synthetic unknown warning";
                        if (mode === "nonzero") code = 1;
                        if (mode === "truncated") out = out.slice(0, -12);
                    } else if (args.includes("--machinereadable")) {
                        out = mode === "unresolved" ? get("048-unresolved-machine") : machine; if (mode === "pending-fail") code = 1;
                        if (mode === "extra") out += machine.split("\r\n")[1] + "\r\n";
                        if (mode === "missing") out = machine.split("\r\n")[0] + "\r\n";
                    } else { out = mode === "unresolved" ? get("048-unresolved-full") : full; if (mode === "full-fail") code = 1; if (mode === "wrong-source") out = full.replace(sourceLeaf, "other"); if (mode === "duplicate-link") out += full.split("\r\n")[3] + "\r\n"; }
                    child.stdout.end(out); child.stderr.end(err); child.emit("close", code, null);
                }); return child;
            }) as any };
            const r = await runWithAbortSignal(undefined, () => executeWorkspaceMergeOutput("merge", { source, workdir: cwd }), deps);
            assert(validateWorkspaceMergeOutput(r.structuredContent), mode); assert.equal(r.structuredContent.ok, mode === "success", mode);
            assert.equal(calls.filter(c => c[0] === "merge").length, 1); assert(!calls.some(c => c[0] === "checkin"));
            if (mode !== "success") { assert.equal(r.structuredContent.data.effect, "uncertain"); assert.equal(r.structuredContent.data.checkinReadiness, "unknown"); }
            else {
                for (const mutate of [(d: any) => d.data.pendingReadMode = "short", (d: any) => d.data.fileConflictCount = 129, (d: any) => d.data.shortStatus.admission = "unsupported", (d: any) => d.data.checkinReadiness = "blocked"]) {
                    const forged = structuredClone(r.structuredContent); mutate(forged); assert(!validateWorkspaceMergeOutput(forged));
                }
            }
        }
    }
}
const unresolvedApply = get("047-apply-unresolved"), unresolvedPending = get("048-unresolved-machine");
assert(parseMergedApply(unresolvedApply, token));
assert.equal(admitWorkspaceMergeOutput(unresolvedApply, token).protocol, "merged-candidate");
assert.equal(parseMergedPending(unresolvedPending, cwd), null, "exit0 and DO_MERGE do not prove resolution");
const resolved = parseMergedPending(get("090-files-merged-machine"), cwd)!;
assert(!admitMergedStandardStatus(get("048-unresolved-full"), resolved, "/main/evidence/files-source", cwd));
assert.equal(parseCheckinEvidence(get("049-unresolved-checkin-negative"), separators).changesets.length, 0);
console.log("PASS: observed merged replacement/changed/mixed correlation; mandatory unresolved control; synthetic malformed, cross-scope, incomplete and uncertainty variants");
// Explicit private exclusion and unsupported directory schema controls. These
// mutations are adversarial derivatives, not additional native receipts.
const privateMachine = get("026-with-private-machine"), privateFull = get("026-with-private-full");
const privatePending = parseMergedPending(privateMachine, cwd)!;
assert(privatePending); assert.equal(privatePending.privateRows.length, 3);
assert(admitMergedStandardStatus(privateFull, privatePending, "/main/evidence/source", cwd));
for (const bad of [
    privateMachine.replaceAll("unrelated-private", "fixtures\evidence\new\private"),
    privateMachine.replaceAll("unrelated-private", "fixtures"),
    privateMachine.replace("PR\x1f", "CH\x1f"),
    privateMachine.replace("True", "False"), // copied directory owning children
]) assert.equal(parseMergedPending(bad, cwd), null);
for (const bad of [
    privateFull.replace("Status                     Size        Path", "Status                     Size        Last Modified    Path"),
    privateFull.replace("1.54 MB", "1x54 MB"),
    privateFull.replace("1.54 MB", "1.54 GB"),
    privateFull.replace("Removed (Merge from 54)", "Removed"),
    privateFull.replace("Checked-out (changed) (Merge from 54)", "Checked-out (changed)"),
]) assert(!admitMergedStandardStatus(bad, privatePending, "/main/evidence/source", cwd));
const fileMachine = get("090-files-merged-machine"), fileApply = get("089-apply-files");
const co = fileMachine.split("\r\n").find(l => l.startsWith("CO\x1f") && l.includes("changed1.txt"))!;
const declaration = fileApply.split("\r\n").find(l => l.startsWith("__EV_S__FILE_CONFLICT") && l.includes("changed1.txt"))!;
const action = fileApply.split("\r\n").find(l => l.startsWith("__EV_S__DO_MERGE") && l.includes("changed1.txt"))!;
for (const count of [128, 129]) {
    const derive = (line: string, i: number) => line.replaceAll("changed1.txt", `boundary-${i}.txt`);
    const rows = Array.from({ length: count }, (_, i) => derive(co, i));
    const machine = [fileMachine.split("\r\n")[0], ...rows, ""].join("\r\n");
    const apply = [...Array.from({ length: count }, (_, i) => derive(declaration, i)), ...Array.from({ length: count }, (_, i) => derive(action, i)), ""].join("\r\n");
    assert.equal(!!parseMergedPending(machine, cwd), count === 128);
    assert.equal(!!parseMergedApply(apply, token), count === 128);
}
console.log("PASS: actual cm10484 multi-file and directory/deletion profiles; native structural parent events; explicit private exclusion; unresolved stop; bounded structural derivatives");
