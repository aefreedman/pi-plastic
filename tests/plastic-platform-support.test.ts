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
import { parseCheckinEvidence } from "../src/domain/checkin-contract";
import { parseSwitchPending, admittedSwitchNoChanges } from "../src/domain/switch-contract";
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
        assert(checked.ok, JSON.stringify(checked)); assert.equal(checked.outcome, "command-completed"); assert.equal(calls.filter(a => a[0] === "checkin").length, 1);
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
assert(parseSwitchPending(pending(posix), root).admitted);
assert(receiptPathWithin(root, posix));
for (const path of [root + "-other/file.txt", root + "/../escape", "C:\\other\\file.txt"]) assert(!receiptPathWithin(root, path));
assert.notEqual(receiptPathKey(root + "/A.txt"), receiptPathKey(root + "/a.txt"));
assert(!admittedSwitchNoChanges("", `Error: There are no changes in the workspace ${root.toUpperCase()}\n`, root));
const seps = { start: "START", end: "END", field: "FIELD" };
const observation=parseCheckinEvidence("STARTCI_STARTEND\nSTARTCHANGESETFIELDcs:99@br:/main@repo@server (mount:'/')END\n",seps);
assert(observation.admitted);assert.equal(observation.changesets[0].id,"99");
console.log("PASS: OS-independent native checkin/create/switch/closeout/merge/marker execution and POSIX path safety");
