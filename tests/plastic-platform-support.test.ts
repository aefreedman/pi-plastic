import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { runWithAbortSignal } from "../src/execution/context";
import { assembleCheckinReceipt } from "../src/operations/checkin-receipt";
import { assembleBranchCreateReceipt } from "../src/operations/branch-create";
import { assembleSwitchReceipt } from "../src/operations/switch-receipt";
import { assembleCloseoutReceipt } from "../src/operations/closeout-receipt";
import { assembleWorkspaceMergeReceipt } from "../src/operations/workspace-merge-receipt";
import { parseCheckinPending, parseCheckinEvidence } from "../src/domain/checkin-contract";
import { parseSwitchPending, admittedSwitchNoChanges } from "../src/domain/switch-contract";
import { parseMergedPending, parseMergedApply, correlateMergedApply, correlateMergedCheckin, admitMergedStandardStatus } from "../src/domain/merged-workspace";
import { parseCopiedPending, admitCopiedStandardStatus } from "../src/domain/copied-merge";
import { receiptPathKey, receiptPathWithin } from "../src/domain/receipt-paths";
import { classifyMarkerInspection } from "../src/domain/marker-lifecycle";
import { markerInspectionFromObservation } from "../src/domain/marker-lifecycle";
import { captureWorkspaceMergeCommand } from "../src/execution/workspace-merge-command";

const cwd = process.cwd(), file = join(cwd, "fixture.txt"), us = "\x1f";
const pending = (path: string, status = "CH", metadata = "NO_MERGES") => `STATUS${us}16${us}repo${us}server\n${[status, path, "False", status === "CO" ? "-1" : "17", metadata].join(us)}\n`;
const header = `STATUS${us}16${us}repo${us}server\n`;
let calls: string[][] = [], dirty = true;
const deps = { spawn: ((_: string, args: string[]) => {
    calls.push([...args]);
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
    queueMicrotask(() => {
        child.emit("spawn"); let out = "", code = 0;
        if (args.includes("--list-conflict-markers")) { /* clear */ }
        else if (args[0] === "status") out = args.includes("--machinereadable") ? dirty ? pending(file) : header : "/main@repo@server (cs:16 - head)\n";
        else if (args[0] === "checkin") {
            const sep = (key: string) => args.find(a => a.startsWith(key + "="))!.slice(key.length + 1);
            const frame = (...fields: string[]) => sep("--startlineseparator") + fields.join(sep("--fieldseparator")) + sep("--endlineseparator") + "\n";
            out = frame("CI_START") + frame("CO", file) + frame("CHANGESET", "cs:18@br:/main@repo@server (mount:'/')"); dirty = false;
        } else if (args[0] === "merge" || args[0] === "branch") { /* terminal completion */ }
        else throw Error("Unexpected command");
        child.stdout.end(out); child.stderr.end(); child.emit("close", code, null);
    }); return child;
}) as any };
// Spoof only the OS discriminator to catch blanket gates on every development
// host. Paths and execution remain native; real OS runs belong to the CI matrix.
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
try {
    for (const os of ["win32", "darwin", "linux"]) {
        Object.defineProperty(process, "platform", { ...platform, value: os });
        calls = []; dirty = true;
        const checked = await runWithAbortSignal(undefined, () => assembleCheckinReceipt({ message: "Fixture", workdir: cwd }), deps);
        assert(checked.ok, JSON.stringify(checked)); assert.equal(checked.outcome, "completed"); assert.equal(calls.filter(a => a[0] === "checkin").length, 1);
        calls = [];
        const branch = await runWithAbortSignal(undefined, () => assembleBranchCreateReceipt({ branch: "/main/child", workdir: cwd }), deps);
        assert(branch.ok); assert.equal(calls.length, 1);
        const switched = await runWithAbortSignal(undefined, () => assembleSwitchReceipt({ branch: "/main", workdir: cwd }), deps);
        assert(switched.ok); assert.equal(switched.outcome, "already-loaded");
        const closeout = await runWithAbortSignal(undefined, () => assembleCloseoutReceipt({ source: "/main/child", target: "/main", workdir: cwd, preflight: true }), deps);
        assert(closeout.ok, JSON.stringify(closeout));
        const merged = await runWithAbortSignal(undefined, () => assembleWorkspaceMergeReceipt("merge", { source: "/main/child", workdir: cwd }), deps);
        assert(merged.ok, JSON.stringify(merged));
        const markers = await runWithAbortSignal(undefined, () => captureWorkspaceMergeCommand(["merge", "--list-conflict-markers"], cwd), deps);
        const inspection = markerInspectionFromObservation(markers), text = "CONFLICT_MARKERS /fixture/plain.txt\n";
        inspection.attempt.exitCode = 1; inspection.stdout = text;
        Object.assign(inspection.capture!, { stdoutBytes: Buffer.byteLength(text), stdoutRetainedBytes: Buffer.byteLength(text) });
        assert.equal(classifyMarkerInspection(inspection), "pending");
    }
} finally { Object.defineProperty(process, "platform", platform); }

// POSIX evidence is tested independently of the development host's path module.
const root = "/home/example/workspace", posix = root + "/file.txt";
assert(parseCheckinPending(pending(posix), root).admitted);
assert(parseSwitchPending(pending(posix), root).admitted);
assert(receiptPathWithin(root, posix));
for (const path of [root + "-other/file.txt", root + "/../escape", "C:\\other\\file.txt"]) assert(!receiptPathWithin(root, path));
assert.notEqual(receiptPathKey(root + "/A.txt"), receiptPathKey(root + "/a.txt"));
assert(!admittedSwitchNoChanges("", `Error: There are no changes in the workspace ${root.toUpperCase()}\n`, root));
const seps = { start: "START", end: "END", field: "FIELD" };
assert(parseCheckinEvidence("STARTCI_STARTEND\nSTARTCOFIELD" + posix + "END\n", seps).admitted);
const copied = parseCopiedPending(pending(posix, "CP", "Merge from 15"), root)!;
assert(copied);
const copiedStatus = "/main@repo@server (cs:16 - head)\nPending merge links\n    Merge from cs:15 at /main/child@repo@server\nAdded\n    Status  Size  Last Modified  Path\n    Copied (new) (Merge from 15)  1 bytes  today  file.txt\n";
assert(admitCopiedStandardStatus(copiedStatus, copied, "/main/child", root));
const merged = parseMergedPending(pending(posix, "CO", "Merge from 15"), root)!;
assert(merged); assert(correlateMergedCheckin([{ operation: "CO", path: posix }], merged, root));
const mergedStatus = copiedStatus.replace("\nAdded\n", "\nChanged\n").replace("Copied (new)", "Checked-out (changed)");
assert(admitMergedStandardStatus(mergedStatus, merged, "/main/child", root));
assert(!admitMergedStandardStatus(mergedStatus.replace("file.txt", "FILE.txt"), merged, "/main/child", root));
const caseDistinct = parseMergedPending(pending(posix, "CO", "Merge from 15") + ["CO", root + "/FILE.txt", "False", "-1", "Merge from 15"].join(us) + "\n", root)!;
assert.equal(caseDistinct.rows.length, 2);
const overlap = pending(posix, "CO", "Merge from 15") + ["PR", posix + "/private.txt", "False", "-1", "NO_MERGES"].join(us) + "\n";
assert(!parseMergedPending(overlap, root));
const token = "TOKEN", frame = (...fields: string[]) => token + "S__" + fields.join(token + "F__") + token + "E__\n";
const declarations = parseMergedApply(frame("FILE_CONFLICT", "/file.txt", "1", "2", "3", "4") + frame("DO_MERGE", posix), token)!;
assert(declarations); assert(correlateMergedApply(declarations, merged, root));
assert(!parseMergedPending(pending(root + "/../escape", "CO", "Merge from 15"), root));
assert(!parseCopiedPending(pending(root + "-other/file.txt", "CP", "Merge from 15"), root));
console.log("PASS: OS-independent checkin/create/switch/closeout/merge/marker execution, POSIX evidence and path safety");
