import { syntheticClearMarkerRead } from "./synthetic-marker-read";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseMergedApply, parseMergedPending, correlateMergedApply, admitMergedStandardStatus } from "../src/domain/merged-workspace";
import { admitWorkspaceMergeOutput } from "../src/domain/workspace-merge-contract";
import { parseCheckinPending, parseCheckinEvidence } from "../src/domain/checkin-contract";
import { runWithAbortSignal } from "../src/execution/context";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { executeCheckinOutput, validateCheckinOutput } from "../src/pi/checkin-output";
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/plastic-merged-protocol.json", import.meta.url), "utf8")).fixtures as Array<{ label: string; stdout: string }>;
const get = (label: string) => fixtures.find(f => f.label === label)!.stdout;
const cwd = "C:\\Example\\workspace", token = "__EV_";
const separators = { start: token + "S__", end: token + "E__", field: token + "F__" };
// All mutations below are synthetic adversarial derivatives of sanitized captures.
for (const [applyLabel, pendingLabel, fullLabel, checkinLabel, sourceLeaf] of [
    ["18-apply-replaced", "19-merged-replaced-machine", "19-merged-replaced-standard", "20-replaced-merge-checkin", "replace-source"],
    ["28-apply-mixed", "29-merged-mixed-machine", "29-merged-mixed-standard", "30-mixed-merge-checkin", "mixed-source"],
    ["38-apply-changed", "39-merged-changed-machine", "39-merged-changed-standard", "40-changed-merge-checkin", "changed-source"],
]) {
    const apply = get(applyLabel), machine = get(pendingLabel), full = get(fullLabel), native = get(checkinLabel);
    const source = `/main/evidence/${sourceLeaf}@Example Repository@example@unity`;
    const declarations = parseMergedApply(apply, token)!, pending = parseMergedPending(machine, cwd)!;
    assert(declarations); assert(pending); assert(correlateMergedApply(declarations, pending, cwd));
    assert(admitMergedStandardStatus(full, pending, source, cwd));
    assert.equal(admitWorkspaceMergeOutput(apply, token).protocol, "merged-candidate");
    const checkinPending = parseCheckinPending(machine, cwd); assert(checkinPending.admitted);
    assert.deepEqual(checkinPending.items.map(i => i.kind), pending.rows.map(r => r.status === "CP" ? "added" : "changed"));
    assert(parseCheckinEvidence(native, separators).admitted);
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
        for (const mode of ["success", "foreign-repository", "unknown-tail", "warning"]) {
            const calls: string[][] = []; let checked = false;
            const deps = { spawn: ((_: string, args: string[]) => {
                const markerRead=syntheticClearMarkerRead(args);if(markerRead)return markerRead;calls.push([...args]); const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
                queueMicrotask(() => {
                    child.emit("spawn"); let out = checked ? machine.split("\r\n")[0] + "\r\n" : machine, err = "";
                    if (args[0] === "status" && !args.includes("--machinereadable")) out = full;
                    if (args[0] === "checkin") {
                        checked = true; out = native;
                        for (const [key, old] of [["--startlineseparator", "__EV_S__"], ["--endlineseparator", "__EV_E__"], ["--fieldseparator", "__EV_F__"]]) out = out.replaceAll(old, args.find(a => a.startsWith(key + "="))!.slice(key.length + 1));
                        if (mode === "foreign-repository") out = out.replace("Example Repository", "Other Repository");
                        if (mode === "unknown-tail") out += "unknown";
                        if (mode === "warning") err = "Synthetic warning";
                    }
                    child.stdout.end(out); child.stderr.end(err); child.emit("close", 0, null);
                }); return child;
            }) as any };
            const r = await runWithAbortSignal(undefined, () => executeCheckinOutput({ message: "Synthetic merged fixture", workdir: cwd, includeAll: true, applyChanged: true }), deps);
            assert(validateCheckinOutput(r.structuredContent)); assert.equal(r.structuredContent.ok, ["success", "truncated"].includes(mode), mode);
            assert.equal(calls.filter(c => c[0] === "checkin").length, 1);
            if (mode === "success") assert.deepEqual(r.structuredContent.data.itemEvents.map(e => e.operation), parseCheckinEvidence(native, separators).events.map(e => e.operation));
        }
        for (const mode of ["success", "warning", "pending-fail", "full-fail", "nonzero", "truncated", "extra", "missing", "wrong-source", "duplicate-link", "unresolved"]) {
            const calls: string[][] = [];
            const deps = { spawn: ((_: string, args: string[]) => {
                const markerRead=syntheticClearMarkerRead(args);if(markerRead)return markerRead;calls.push([...args]); const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
                queueMicrotask(() => {
                    child.emit("spawn"); let out = "", err = "", code = 0;
                    if (args[0] === "merge") {
                        out = apply;
                        for (const [key, old] of [["--startlineseparator", "__EV_S__"], ["--endlineseparator", "__EV_E__"], ["--fieldseparator", "__EV_F__"]]) out = out.replaceAll(old, args.find(a => a.startsWith(key + "="))!.slice(key.length + 1));
                        if (mode === "warning") err = "Synthetic unknown warning";
                        if (mode === "nonzero") code = 1;
                        // Complete transport with unfamiliar apply text is NOT a truncated capture.
                        if (mode === "truncated") out = out.slice(0, -12);
                    } else if (args.includes("--machinereadable")) {
                        out = mode === "unresolved" ? get("54-unresolved-machine") : machine; if (mode === "pending-fail") code = 1;
                        if (mode === "extra") out += machine.split("\r\n")[1] + "\r\n";
                        if (mode === "missing") out = machine.split("\r\n")[0] + "\r\n";
                    } else { out = mode === "unresolved" ? get("54-unresolved-standard") : full; if (mode === "full-fail") code = 1; if (mode === "wrong-source") out = full.replace(sourceLeaf, "other"); if (mode === "duplicate-link") out += full.split("\r\n")[3] + "\r\n"; }
                    child.stdout.end(out); child.stderr.end(err); child.emit("close", code, null);
                }); return child;
            }) as any };
            const r = await runWithAbortSignal(undefined, () => executeWorkspaceMergeOutput("merge", { source, workdir: cwd }), deps);
            assert(validateWorkspaceMergeOutput(r.structuredContent), mode); assert.equal(r.structuredContent.ok, ["success", "truncated"].includes(mode), mode);
            assert.equal(calls.filter(c => c[0] === "merge").length, 1); assert(!calls.some(c => c[0] === "checkin"));
            if (!["success", "truncated"].includes(mode)) { assert.equal(r.structuredContent.data.effect, "uncertain"); assert.equal(r.structuredContent.data.checkinReadiness, "unknown"); }
            else {
                for (const mutate of [(d: any) => d.data.pendingReadMode = "short", (d: any) => d.data.fileConflictCount = 129, (d: any) => d.data.shortStatus.admission = "unsupported", (d: any) => d.data.checkinReadiness = "blocked"]) {
                    const forged = structuredClone(r.structuredContent); mutate(forged); assert(!validateWorkspaceMergeOutput(forged));
                }
            }
        }
    }
}
const unresolvedApply = get("53-apply-unresolved"), unresolvedPending = get("54-unresolved-machine");
assert(parseMergedApply(unresolvedApply, token));
assert.equal(admitWorkspaceMergeOutput(unresolvedApply, token).protocol, "merged-candidate");
assert.equal(parseMergedPending(unresolvedPending, cwd), null, "exit0 and DO_MERGE do not prove resolution");
const resolved = parseMergedPending(get("39-merged-changed-machine"), cwd)!;
assert(!admitMergedStandardStatus(get("54-unresolved-standard"), resolved, "/main/evidence/changed-source", cwd));
assert.equal(parseCheckinEvidence(get("62-native-unresolved-checkin"), separators).changesets.length, 0);
console.log("PASS: observed merged replacement/changed/mixed correlation; mandatory unresolved control; synthetic malformed, cross-scope, incomplete and uncertainty variants");
