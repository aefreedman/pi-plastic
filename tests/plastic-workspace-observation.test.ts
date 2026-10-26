import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { canonicalWorkspaceDirectory, observeWorkspacePending, observeWorkspaceStandard, assessWorkspaceState } from "../src/domain/workspace-observation";
import { parseCheckinPending } from "../src/domain/checkin-contract";
import { receiptPathApi, receiptPathKey } from "../src/domain/receipt-paths";
import { executeWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { executeCheckinOutput } from "../src/pi/checkin-output";
import { runWithAbortSignal } from "../src/execution/context";
import { syntheticClearMarkerRead } from "./synthetic-marker-read";
const cwd = "C:\\Example\\workspace", source = "/main/source", target = "/main/target", header = "STATUS\x1f42\x1fExample Repository\x1fexample@unity\r\n";
const row = (status: string, name: string, merge: string | null = "43", directory = false) => [status, cwd + "\\" + name, String(directory ? "True" : "False"), /^(PR|AD|CO)$/.test(status) ? "-1" : "17", merge ? "Merge from " + merge : "NO_MERGES"].join("\x1f") + "\r\n";
const machine = header + row("RP", "nested\\replaced.txt") + row("CO", "nested\\changed.txt") + row("CP", "nested\\new 日本.txt") + row("DE", "nested\\removed.txt") + row("PR", "unrelated-private.txt", null);
const branch = `${target}@Example Repository@example@unity (cs:42 - head)\r\n`;
const links = `Pending merge links\r\n    Merge from cs:43 at ${source}@Example Repository@example@unity\r\n`;
const changed = "Changed\r\n    Status  Size  Last Modified  Path\r\n    Replaced (Merge from 43)    2.2 GB    some opaque age    nested\\replaced.txt\r\n    Checked-out (changed) (Merge from 43)    opaque size    opaque age    nested\\changed.txt\r\n";
const added = "Added\r\n    Status  Size  Last Modified  Path\r\n    Copied (new) (Merge from 43)    anything size    anything age    nested\\new 日本.txt\r\n    Private    bytes not parsed    opaque age    unrelated-private.txt\r\n";
const deleted = "Deleted\r\n    Status  Size  Path\r\n    Removed (Merge from 43)    0 bytes    nested\\removed.txt\r\n";
const full = branch + links + changed + added + deleted;
for (const workdir of [cwd, cwd.replaceAll("\\", "/"), "c:/Example/workspace/"]) {
    const pending = observeWorkspacePending(machine, workdir);
    assert.equal(pending.issues.length, 0); assert.equal(pending.rows.length, 5);
    assert(parseCheckinPending(machine, workdir).admitted);
    for (const display of [full, branch + links + deleted + added + changed, full.replaceAll("opaque", "different").replaceAll("2.2 GB", "unknown-size")]) {
        const assessment = assessWorkspaceState(pending, observeWorkspaceStandard(display, pending), { source });
        assert(assessment.ready, JSON.stringify(assessment)); assert.equal(assessment.mergeRowCount, 4);
    }
}
// Relative user workdirs are resolved once; observed path spellings stay intact.
for (const workdir of [".", process.cwd()]) {
    const absolute = canonicalWorkspaceDirectory(workdir), path = receiptPathApi(absolute).join(absolute, "ordinary.txt");
    const pending = observeWorkspacePending(header + ["CH", path, "False", "17", "NO_MERGES"].join("\x1f") + "\r\n", workdir);
    assert.equal(pending.issues.length, 0); assert.equal(receiptPathKey(pending.cwd), receiptPathKey(process.cwd()));
}
const composed = observeWorkspacePending(machine + row("CH", "unrelated.txt", null), cwd);
assert.equal(composed.rows.length, 6, "Composition is observed rather than rejected by a merged-only parser");
const composedFull = full.replace("Changed\r\n", "Changed\r\n").replace("    Replaced", "    Changed    opaque size    opaque age    unrelated.txt\r\n    Replaced");
assert(!assessWorkspaceState(composed, observeWorkspaceStandard(composedFull, composed), { source }).ready);
assert(assessWorkspaceState(composed, observeWorkspaceStandard(composedFull, composed), { source, allowOrdinary: true }).ready);
for (const bad of [full + "Merge in progress\r\n", full + "Unresolved conflicts\r\n", full + "Unknown section\r\n", full.replace("at /main/source", "at /main/other"), full + links, full.replace("nested\\replaced.txt", "othernested\\replaced.txt"), full.replace("nested\\replaced.txt", "unrelated  nested\\replaced.txt"), full.replace("Removed (Merge from 43)", "Removed"), full.replace("Changed\r\n", "Other\r\n"), full.replace("    Replaced", "    Replaced (Unknown conflict)"), full.replace("cs:42 - head", "cs:41 - head")]) {
    const pending = observeWorkspacePending(machine, cwd), assessment = assessWorkspaceState(pending, observeWorkspaceStandard(bad, pending), { source });
    assert(!assessment.ready, bad); assert(assessment.blockers.length > 0);
}
for (const bad of [machine + row("UNKNOWN", "unknown.txt"), machine + row("CH", "..\\escape.txt", null), machine + row("CH", "nested\\replaced.txt", null), machine.replace("Merge from 43", "Merge from ???"), machine.replace("C:\\Example\\workspace\\nested", "C:\\Other\\nested")]) assert(observeWorkspacePending(bad, cwd).issues.length > 0);
const many = header + Array.from({ length: 129 }, (_, i) => row("RP", `file-${i}.txt`)).join("");
assert.equal(observeWorkspacePending(many, cwd).rows.length, 129, "Independent observation does not inherit the 128 apply-frame-pair budget");
assert(observeWorkspacePending(header + Array.from({ length: 500 }, (_, i) => row("RP", `file-${i}.txt`)).join(""), cwd).issues.some(i => i.code === "pending_observation_limit"));
const unknown = observeWorkspacePending(header + row("UNKNOWN", "unknown.txt"), cwd);
assert.equal(unknown.rows.length, 1); assert.equal(unknown.rows[0].status, "UNKNOWN"); assert(unknown.issues.length, "Unknown observations remain available but never authorize mutation");

// Exercise public producers with real collectors: no sibling fake tool receipts,
// no CLI mutation, one applying attempt, and exact selected-scope argv.
for (const mode of ["ready", "incomplete", "conflict", "scale", "suffix-drift", "unicode-blocker"] as const) {
    const calls: string[][] = [], unicodeName = "a".repeat(148) + "😀.txt";
    const unicodeMachine = machine + row("CH", unicodeName, null);
    const unicodeFull = full.replace("    Replaced", `    Changed    opaque size    opaque age    ${unicodeName}\r\n    Replaced`);
    const deps = { spawn: ((_: string, args: string[], options: any) => {
        assert.equal(options.cwd, cwd); const marker = syntheticClearMarkerRead(args); if (marker) return marker;
        calls.push([...args]); const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
        queueMicrotask(() => { child.emit("spawn"); let out = "", code = 0;
            if (args[0] === "merge") out = "Native display is not the readiness protocol";
            else if (args.includes("--machinereadable")) { out = mode === "scale" ? header + Array.from({ length: 129 }, (_, i) => row("CO", `scale-${i}.txt`)).join("") : mode === "unicode-blocker" ? unicodeMachine : machine; if (mode === "incomplete") code = 1; }
            else out = mode === "scale" ? branch + links + "Changed\r\n    Status  Size  Last Modified  Path\r\n" + Array.from({ length: 129 }, (_, i) => `    Checked-out (changed) (Merge from 43)    opaque size    opaque age    scale-${i}.txt\r\n`).join("") : mode === "unicode-blocker" ? unicodeFull : mode === "suffix-drift" ? full.replace("nested\\replaced.txt", "unrelated  nested\\replaced.txt") : full + (mode === "conflict" ? "Merge in progress\r\n" : "");
            child.stdout.end(out); child.stderr.end(); child.emit("close", code, null);
        }); return child;
    }) as any };
    const result = await runWithAbortSignal(undefined, () => executeWorkspaceMergeOutput("merge", { source, workdir: cwd.replaceAll("\\", "/") }), deps);
    assert.equal(result.structuredContent.ok, mode === "ready" || mode === "scale", JSON.stringify(result.structuredContent)); assert.equal(result.structuredContent.data.commandCompleted, true);
    assert.equal(calls.filter(a => a[0] === "merge").length, 1); assert(!calls.some(a => a[0] === "checkin"));
    if (mode === "conflict") assert.match(result.content[0].text, /merge_in_progress/);
    if (mode === "suffix-drift") assert.match(result.content[0].text, /standard_row_unmatched/);
    if (mode === "unicode-blocker") {
        const dto = result.structuredContent; assert(!dto.ok);
        assert.equal(dto.data.assessment?.blockers[0].code, "unrelated_controlled_pending");
        assert.equal(dto.data.assessment?.blockers[0].path, cwd + "\\" + unicodeName);
        assert.equal(Buffer.from(dto.error.message, "utf8").toString("utf8"), dto.error.message, "Diagnostic must not contain an unpaired surrogate");
        assert(dto.error.message.length <= 200); assert(dto.data.apply.capture?.complete);
    }
}
{
    const calls: string[][] = []; let after = false, mixed = false, drift = false;
    const deps = { spawn: ((_: string, args: string[]) => {
        const marker = syntheticClearMarkerRead(args); if (marker) return marker; calls.push([...args]);
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
        queueMicrotask(() => { child.emit("spawn"); let out: string;
            if (args[0] === "status") out = args.includes("--machinereadable") ? after ? header : mixed ? machine + row("CH", "unrelated.txt", null) : machine : drift ? full.replace("nested\\replaced.txt", "unrelated  nested\\replaced.txt") : mixed ? composedFull : full;
            else { after = true; const sep = (name: string) => args.find(a => a.startsWith(name + "="))!.slice(name.length + 1); const frame = (op: string, ...fields: string[]) => sep("--startlineseparator") + [op, ...fields].join(sep("--fieldseparator")) + sep("--endlineseparator") + "\r\n";
                out = frame("CI_START") + ["RP", "CO", "CP", "DE"].map((op, i) => frame(op, cwd + "\\" + ["nested\\replaced.txt", "nested\\changed.txt", "nested\\new 日本.txt", "nested\\removed.txt"][i])).join("") + frame("CHANGESET", `cs:44@br:${target}@Example Repository@example@unity (mount:'/')`); }
            child.stdout.end(out); child.stderr.end(); child.emit("close", 0, null);
        }); return child;
    }) as any };
    const selected = ["nested/replaced.txt", "nested/changed.txt", "nested/new 日本.txt", "nested/removed.txt"];
    const result = await runWithAbortSignal(undefined, () => executeCheckinOutput({ workdir: cwd.replaceAll("\\", "/"), message: "Selected merged scope", paths: selected, includeAll: true }), deps);
    assert(result.structuredContent.ok, JSON.stringify(result.structuredContent));
    const command = calls.find(a => a[0] === "checkin")!; assert(!command.includes("--all")); assert(!command.some(a => a.includes("unrelated")));
    calls.length = 0; after = false; drift = true;
    const pathDrift = await runWithAbortSignal(undefined, () => executeCheckinOutput({ workdir: cwd, message: "Reject different path cell", paths: selected }), deps);
    assert(!pathDrift.structuredContent.ok); assert(!calls.some(a => a[0] === "checkin"));
    assert.match(pathDrift.content[0].text, /standard_row_unmatched/);
    calls.length = 0; after = false; drift = false; mixed = true;
    const blocked = await runWithAbortSignal(undefined, () => executeCheckinOutput({ workdir: cwd, message: "No implicit unrelated inclusion", includeAll: true }), deps);
    assert(!blocked.structuredContent.ok); assert(!calls.some(a => a[0] === "checkin"));
    assert.equal(!blocked.structuredContent.ok && blocked.structuredContent.error.code, "mixed_merge_scope");
    const explicitMixed = await runWithAbortSignal(undefined, () => executeCheckinOutput({ workdir: cwd, message: "Still mixed merge scope", paths: selected }), deps);
    assert(!explicitMixed.structuredContent.ok); assert(!calls.some(a => a[0] === "checkin"));
}
console.log("PASS: shared workspace facts, slash/relative identity metamorphisms, compositional scope policy, semantic display tolerance, unknown/conflict/limits and public producer no-replay guards");
