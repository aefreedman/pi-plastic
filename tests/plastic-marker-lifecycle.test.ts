import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyMarkerInspection } from "../src/domain/marker-lifecycle";
import { compactMarkerGate } from "../src/domain/marker-gate";
import { validateMarkerGate } from "../src/pi/marker-gate-output";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runWithAbortSignal } from "../src/execution/context";
import { inspectConflictMarkers, mergeListConflictMarkers, mergeMarkResolved } from "../src/operations/marker-lifecycle";
import { executeMarkerLifecycleOutput, validateMarkerLifecycleOutput } from "../src/pi/marker-lifecycle-output";
const root = await mkdtemp(path.join(os.tmpdir(), "plastic-marker-synthetic-"));
const workspace = path.join(root, "workspace"), outside = path.join(root, "outside.txt");
await mkdir(workspace); await writeFile(outside, "outside");
const file = path.join(workspace, "café 日本 😀 fixture.txt");
await writeFile(file, "<<<<<<< intentional fixture\n=======\n>>>>>>> fixture\n");
let calls: string[][] = [];
function deps(out: string | Buffer = "", err = "", code = 0, mutate?: () => void, emitSpawn = true) {
    return { abortKillDelayMs: 1, spawn: ((_: string, argv: string[], options: any) => {
        assert.equal(options.shell, false); assert.equal(options.cwd, workspace);
        calls.push([...argv]); mutate?.();
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
        queueMicrotask(() => { if (emitSpawn) child.emit("spawn"); child.stdout.end(out); child.stderr.end(err); child.emit("close", code, null); });
        return child;
    }) as any };
}
const list = "merge-list-conflict-markers", mark = "merge-mark-resolved";
try {
    for (const format of ["text", "json"] as const) {
        calls = [];
        const r = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(list, { workdir: workspace, format }), deps());
        assert(validateMarkerLifecycleOutput(r.structuredContent)); assert.equal(r.isError, false);
        assert.equal(r.structuredContent.data.inspection.state, "clear"); assert.equal(r.structuredContent.data.checkinReadiness, "unknown");
        assert.deepEqual(calls, [["merge", "--list-conflict-markers"]]);
        const inspection = await runWithAbortSignal(undefined, () => inspectConflictMarkers(workspace), deps());
        assert.equal(inspection.state, "clear"); assert.equal(inspection.stdout, "");
        if (format === "json") assert.equal(JSON.parse(r.content[0].text).outcome, "clear");
        for (const patch of [(v: any) => v.extra = true, (v: any) => v.data.inspection.state = "pending", (v: any) => v.data.command.push("--merge"), (v: any) => v.data.inspection.capture.stdoutBytes = 1, (v: any) => v.data.checkinReadiness = "ready", (v: any) => v.data.inspection.stdout = null, (v: any) => v.data.inspection.attempt.state = "not-started", (v: any) => v.data.effect = "not-proven"]) {
            const forged = structuredClone(r.structuredContent); patch(forged); assert(!validateMarkerLifecycleOutput(forged));
        }
    }
    const captures = JSON.parse(readFileSync(new URL("./fixtures/marker-list-captures.json", import.meta.url), "utf8")).captures;
    for (const fixture of captures) {
        const out = Buffer.from(fixture.stdoutBase64, "base64"), err = Buffer.from(fixture.stderrBase64, "base64").toString("utf8");
        calls = [];
        const r = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(list, { workdir: workspace, format: "json" }), deps(out, err, fixture.exitCode));
        const dto = r.structuredContent, expected = !fixture.validUtf8 ? "unknown" : fixture.exitCode === 1 ? process.platform === "win32" ? "pending" : "unknown" : "clear";
        assert(validateMarkerLifecycleOutput(dto)); assert.equal(dto.data.inspection.state, expected, fixture.name);
        assert.equal(dto.data.inspection.capture!.validUtf8, fixture.validUtf8);
        assert.equal(dto.ok, expected !== "unknown"); assert.equal(r.isError, expected === "unknown");
        assert.equal(dto.outcome, expected === "unknown" ? "uncertain" : expected);
        assert.equal(dto.data.commandCompleted, expected === "clear");
        assert.equal(dto.data.effect, "not-attempted"); assert.equal(dto.data.checkinReadiness, "unknown");
        assert.equal(calls.length, 1); assert(validateMarkerGate(compactMarkerGate(dto.data.inspection)));
        if (expected !== "pending") continue;
        for (const patch of [(v: any) => v.data.inspection.state = "clear", (v: any) => v.outcome = "clear", (v: any) => v.data.commandCompleted = true, (v: any) => v.data.inspection.stdout = "", (v: any) => v.data.inspection.attempt.exitCode = 0, (v: any) => v.data.inspection.capture.complete = false]) {
            const forged = structuredClone(dto); patch(forged); assert(!validateMarkerLifecycleOutput(forged));
        }
        const gate = compactMarkerGate(dto.data.inspection);
        for (const patch of [(v: any) => v.state = "clear", (v: any) => v.attempt.exitCode = 0, (v: any) => v.attempt.aborted = true, (v: any) => v.capture.validUtf8 = false, (v: any) => v.capture.stdoutRetainedBytes--]) {
            const forged = structuredClone(gate); patch(forged); assert(!validateMarkerGate(forged));
        }
        // Full receipts reclassify the text, not just trusted state/counts.
        const forged = structuredClone(dto); forged.data.inspection.stdout = "x".repeat(out.length);
        assert(!validateMarkerLifecycleOutput(forged));
        for (const patch of [(i: any) => i.capture.complete = false, (i: any) => i.capture.truncated = true, (i: any) => i.capture.validUtf8 = false, (i: any) => i.attempt.aborted = true, (i: any) => i.attempt.timedOut = true, (i: any) => i.attempt.terminal = "not-observed", (i: any) => i.attempt.state = "unknown"]) {
            const inspection = structuredClone(dto.data.inspection); patch(inspection); assert.equal(classifyMarkerInspection(inspection), "unknown");
        }
        calls = [];
        const core = JSON.parse(await runWithAbortSignal(undefined, () => mergeListConflictMarkers.execute({ workdir: workspace, format: "json" }), deps(out, err, 1)));
        assert.equal(core.outcome, "pending"); assert.equal(calls.length, 1);
    }
    const record = "CONFLICT_MARKERS /fixture/plain.txt\r\n";
    const malformed = [record.replace(/\r/g, ""), record.slice(0, -2), record + "\r\n", record + "error\r\n", record + record, record + record.replace("plain", "PLAIN"), "\uFEFF" + record,
        ...["plain.txt", "//plain.txt", "/../plain.txt", "/./plain.txt", "/a//plain.txt", "/a/", "/a\\plain.txt", "/C:/plain.txt", "/a?.txt", "/café.txt", "/ space.txt", "/space .txt ", "/a  b.txt", "/CON.txt", "/CON .txt", "/" + "x".repeat(256)].map(p => `CONFLICT_MARKERS ${p}\r\n`), record.repeat(257)];
    for (const [out, err, code] of [...malformed.map(out => [out, "", 1] as const), [record, "warning", 1], [record, "", 0], [record, "", 2]] as const) {
        calls = [];
        const r = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(list, { workdir: workspace }), deps(out, err, code));
        assert(validateMarkerLifecycleOutput(r.structuredContent)); assert(r.isError); assert.equal(r.structuredContent.data.inspection.state, "unknown"); assert.equal(calls.length, 1);
    }
    // A terminal exit-1 event cannot replace complete stream capture.
    calls = [];
    const partial = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(list, { workdir: workspace }), { spawn: ((_: string, argv: string[]) => {
        calls.push([...argv]);
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
        queueMicrotask(() => { child.emit("spawn"); child.stdout.write(record); child.stdout.destroy(); child.stderr.end(); child.emit("close", 1, null); });
        return child;
    }) as any });
    assert(validateMarkerLifecycleOutput(partial.structuredContent)); assert(partial.isError); assert.equal(partial.structuredContent.data.inspection.state, "unknown");
    assert.equal(partial.structuredContent.data.inspection.capture!.complete, false); assert.equal(calls.length, 1);
    // Generic exit 1 and unobserved absolute/LF shapes remain unknown.
    for (const [out, err, code] of [[file + "\r\n", "", 1], ["CONFLICT_MARKERS " + file + "\n", "", 1], ["error reading metadata", "", 1], ["", "error", 1], ["", "", 1], ["unexpected record", "", 0], ["\n", "", 0], ["", "warning", 0], ["\uFEFF", "", 0]] as const) {
        calls = [];
        const r = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(list, { workdir: workspace }), deps(out, err, code));
        assert(validateMarkerLifecycleOutput(r.structuredContent)); assert(r.isError); assert.equal(r.structuredContent.data.inspection.state, "unknown"); assert.equal(calls.length, 1);
        assert.equal(r.structuredContent.data.inspection.stdout, out);
    }
    for (const action of [list, mark] as const) {
        const args = { workdir: workspace, ...(action === mark ? { paths: [file], acknowledgeIntentionalMarkers: true } : {}) };
        for (const out of [Buffer.from([255]), Buffer.from([0xe2, 0x82]), Buffer.alloc(65537, 120)]) {
            calls = [];
            const r = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(action, args), deps(out));
            assert(validateMarkerLifecycleOutput(r.structuredContent)); assert(r.isError); assert.equal(calls.length, 1); assert.equal(r.structuredContent.data.inspection.state, "unknown");
            if (out.length > 65536) assert(r.structuredContent.data.inspection.capture!.truncated);
            else assert.equal(r.structuredContent.data.inspection.stdout, null);
        }
        const controller = new AbortController(); controller.abort(); calls = [];
        const r = await runWithAbortSignal(controller.signal, () => executeMarkerLifecycleOutput(action, args), deps());
        assert(validateMarkerLifecycleOutput(r.structuredContent)); assert(r.isError); assert.equal(calls.length, 0); assert(r.structuredContent.data.inspection.attempt.aborted);
        calls = [];
        const during = new AbortController();
        const interrupted = await runWithAbortSignal(during.signal, () => executeMarkerLifecycleOutput(action, args), deps("CONFLICT_MARKERS /fixture/plain.txt\r\n", "", 1, () => during.abort()));
        assert(validateMarkerLifecycleOutput(interrupted.structuredContent)); assert(interrupted.isError); assert.equal(calls.length, 1);
    }
    for (const action of [list, mark] as const) {
        const args = { workdir: workspace, ...(action === mark ? { paths: [file], acknowledgeIntentionalMarkers: true } : {}) };
        calls = [];
        const missingStart = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(action, args), deps("", "", 0, undefined, false));
        assert(validateMarkerLifecycleOutput(missingStart.structuredContent)); assert(missingStart.isError); assert.equal(calls.length, 1);
        const launch = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(action, args), { spawn: (() => { throw Error("synthetic launch failure"); }) as any });
        assert(validateMarkerLifecycleOutput(launch.structuredContent)); assert(launch.isError); assert.equal(launch.structuredContent.data.inspection.attempt.state, "not-started");
        const timed = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(action, args), { timeoutMs: 1, abortKillDelayMs: 1, spawn: (() => {
            const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.stdout.end(); child.stderr.end(); child.emit("close", null, "SIGTERM"); return true; } });
            queueMicrotask(() => { child.emit("spawn"); child.stdout.write("CONFLICT_MARKERS /fixture/plain.txt\r\n"); }); return child;
        }) as any });
        assert(validateMarkerLifecycleOutput(timed.structuredContent)); assert(timed.isError); assert(timed.structuredContent.data.inspection.attempt.timedOut);
    }
    const input = { workdir: workspace, paths: [path.basename(file)], acknowledgeIntentionalMarkers: true, format: "json", preflight: true };
    const original = structuredClone(input); calls = [];
    const preview = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(mark, input), deps());
    assert(validateMarkerLifecycleOutput(preview.structuredContent)); assert(!preview.isError); assert.equal(preview.structuredContent.outcome, "preflight"); assert.equal(calls.length, 0); assert.deepEqual(input, original);
    assert.deepEqual(preview.structuredContent.data.command, ["merge", "--mark-resolved", file]);
    calls = [];
    const active: any = { ...input, paths: [...input.paths], preflight: false };
    const completed = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(mark, active), deps("", "", 0, () => { active.paths[0] = outside; active.acknowledgeIntentionalMarkers = false; }));
    assert(validateMarkerLifecycleOutput(completed.structuredContent)); assert(!completed.isError); assert.equal(completed.structuredContent.outcome, "command-completed"); assert.equal(completed.structuredContent.data.inspection.state, "unknown"); assert.equal(completed.structuredContent.data.effect, "not-proven"); assert.deepEqual(calls, [["merge", "--mark-resolved", file]]);
    for (const patch of [(v: any) => v.data.requested.acknowledgeIntentionalMarkers = false, (v: any) => v.data.requested.paths = [], (v: any) => v.data.inspection.state = "clear", (v: any) => v.data.inspection.attempt.exitCode = 1, (v: any) => v.data.requested.preflight = true, (v: any) => v.data.command.push("--list-conflict-markers"), (v: any) => v.data.requested.paths[0] = outside]) {
        const forged = structuredClone(completed.structuredContent); patch(forged); assert(!validateMarkerLifecycleOutput(forged));
    }
    for (const [out, err, code] of [["", "", 1], ["", "warning", 0], ["error", "", 2]] as const) {
        calls = []; const r = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(mark, { ...input, preflight: false }), deps(out, err, code));
        assert(validateMarkerLifecycleOutput(r.structuredContent)); assert(r.isError); assert.equal(r.structuredContent.data.effect, "uncertain"); assert.equal(calls.length, 1);
    }
    const invalidList = [null, [], { workdir: null }, { format: null }, { format: "xml" }, { preflight: true }, { paths: [file] }, { workdir: "\uD800" }, { workdir: "x".repeat(4097) }, { extra: true }];
    const invalidMark = [null, { paths: [file] }, { paths: [file], acknowledgeIntentionalMarkers: false }, { paths: [file], acknowledgeIntentionalMarkers: "true" }, ...[null, [], ["-option"], [file, file], [workspace], [outside], ["../outside.txt"], ["missing"], ["*.txt"], ["x\u0000"], ["\uD800"], ["x".repeat(4097)], Array(65).fill(file)].map(paths => ({ ...input, paths })), ...[null, "true", 0].map(preflight => ({ ...input, preflight })), { ...input, extra: true }];
    for (const [action, inputs] of [[list, invalidList], [mark, invalidMark]] as const) for (const args of inputs) {
        calls = []; const r = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(action, args), deps());
        assert(validateMarkerLifecycleOutput(r.structuredContent), JSON.stringify(args)); assert(r.isError); assert.equal(calls.length, 0);
    }
    const escape = path.join(workspace, "escape");
    // Directory junctions permit this containment test on Windows without
    // requiring the symlink-file privilege.
    await symlink(root, escape, process.platform === "win32" ? "junction" : "dir");
    calls = []; const escaped = await runWithAbortSignal(undefined, () => executeMarkerLifecycleOutput(mark, { ...input, paths: [path.join(escape, "outside.txt")] }), deps());
    assert(escaped.isError); assert(validateMarkerLifecycleOutput(escaped.structuredContent)); assert.equal(calls.length, 0);
    calls = []; await assert.rejects(() => runWithAbortSignal(undefined, () => mergeMarkResolved.execute({ workdir: workspace, paths: [file], acknowledgeIntentionalMarkers: true }), deps("", "", 1))); assert.equal(calls.length, 1);
    calls = []; await runWithAbortSignal(undefined, () => mergeListConflictMarkers.execute({ workdir: workspace }), deps()); assert.equal(calls.length, 1);
    assert.deepEqual(mergeMarkResolved.args.acknowledgeIntentionalMarkers.values, [true]);
    console.log("PASS: captured marker clear/pending/invalid-UTF8, unknown diagnostics/malformed paths, compact/full forgery, core transport, strict capture/UTF8/abort, intentional bypass, physical containment, zero-command preflight, argv ownership, closed receipt forgery checks, no followup/retry");
} finally { await rm(root, { recursive: true, force: true }); }
