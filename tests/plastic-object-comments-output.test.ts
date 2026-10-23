import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import { runWithAbortSignal } from "../src/execution/context";
import { OBJECT_COMMENT_ACTIONS, assembleObjectCommentReceipt, branchEditComment, labelEditComment, type ObjectCommentAction } from "../src/operations/object-comments";
import { executeObjectCommentOutput, validateObjectCommentOutput, objectCommentSchemas } from "../src/pi/object-comments-output";
const calls: string[][] = [];
type Reply = { out?: string | Buffer; err?: string | Buffer; code?: number; start?: boolean; launchFail?: boolean; partial?: boolean; mutate?: () => void };
function deps(r: Reply = {}) {
    return { timeoutMs: 5, abortKillDelayMs: 1, spawn: ((_cm: string, argv: string[], options: any) => {
        calls.push([...argv]); assert.equal(options.shell, false); assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
        if (r.launchFail) throw Error("SYNTHETIC_PRIVATE_LAUNCH");
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => false });
        queueMicrotask(() => { if (r.start !== false) child.emit("spawn"); r.mutate?.();
            if (r.partial) { child.stdout.write(r.out ?? "partial"); return; }
            child.stdout.end(r.out ?? ""); child.stderr.end(r.err ?? ""); child.emit("close", r.code ?? 0, null);
        }); return child;
    }) as any };
}
async function invoke(a: ObjectCommentAction, args: unknown, reply: Reply = {}) {
    calls.length = 0;
    const result = await runWithAbortSignal(undefined, () => executeObjectCommentOutput(a, args), deps(reply));
    assert(validateObjectCommentOutput(result.structuredContent), JSON.stringify(result));
    assert(Check(objectCommentSchemas[a], result.structuredContent)); assert.deepEqual(result.details, {});
    assert.equal(result.isError, !result.structuredContent.ok);
    if (!result.structuredContent.ok) assert.notEqual(result.structuredContent.error.code, "producer_failed", "Expected original transport/validation receipt, not emergency replacement");
    return result;
}
calls.length = 0;
await runWithAbortSignal(undefined, async () => {
    const unsupported = await assembleObjectCommentReceipt("unknown" as ObjectCommentAction, { label: "lb:fixture", comment: "x" });
    assert(!unsupported.ok); assert.equal(calls.length, 0);
    await assert.rejects(() => executeObjectCommentOutput("unknown" as ObjectCommentAction, { label: "lb:fixture", comment: "x" })); assert.equal(calls.length, 0);
}, deps());
const evidence = JSON.parse(readFileSync(new URL("./fixtures/object-comments-native.json", import.meta.url), "utf8"));
assert.equal(evidence.schema, "native-selected-evidence-v1"); assert.equal(evidence.client, "11.0.16.10512"); assert.equal(evidence.captures.length, 8);
// Exact selected public-safe native bytes, not normalized or reserialized protocol streams.
for (const c of evidence.captures) {
    for (const s of Object.values(c.streams) as any[]) { const b = Buffer.from(s.base64, "base64"); assert.equal(b.length, s.selectedByteCount); assert.equal(createHash("sha256").update(b).digest("hex"), s.selectedSha256); new TextDecoder("utf8", { fatal: true }).decode(b); }
    if (c.name.startsWith("help-")) continue;
    const argv: string[] = c.receipt.argv.slice(1), branch = argv[0] === "branch", a = branch ? "branch-edit-comment" : "label-edit-comment";
    const content = argv[3].startsWith("-commentsfile=") ? { commentsFile: argv[3].slice(14) } : { comment: argv[3] };
    const result = await invoke(a, { [branch ? "branch" : "label"]: argv[2], ...content }, { out: Buffer.from(c.streams.stdout.base64, "base64"), err: Buffer.from(c.streams.stderr.base64, "base64"), code: c.receipt.exitCode });
    assert(!result.isError); assert.deepEqual(calls, [argv]);
}
assert.equal(readFileSync(new URL("./fixtures/object-comments-input.txt", import.meta.url), "utf8"), "synthetic café Ω\nsecond line <xml> & | #\n");
// Every case below is an explicitly synthetic derivative: no native execution or stored-state claim.
for (const a of OBJECT_COMMENT_ACTIONS) {
    const branch = a === "branch-edit-comment", key = branch ? "branch" : "label", prefix = branch ? "branch" : "label", selector = branch ? "br:/main/fixture" : "lb:fixture";
    const request = { [key]: selector, comment: "synthetic text" };
    for (const args of [null, [], {}, { ...request, extra: true }, { ...request, preflight: "true" }, { ...request, output: "xml" }, { ...request, output: null }, { ...request, workdir: "bad\n" }, { ...request, [branch ? "label" : "branch"]: selector }, { [key]: selector }, { ...request, commentsFile: "file" }, { ...request, comment: null }, { ...request, comment: "--help" }, { ...request, comment: " \t-commentsfile=-" }, { ...request, comment: "x\0y" }, { ...request, comment: "x\u001by" }, { ...request, comment: "\ud800" }, { ...request, comment: "\udfff" }, { ...request, comment: "x".repeat(4097) }, { [key]: selector, commentsFile: "-" }, { [key]: selector, commentsFile: " --all" }, { [key]: selector, commentsFile: "\nfile" }, { [key]: selector, commentsFile: "" }]) {
        const r = await invoke(a, args); assert(r.isError); assert.equal(calls.length, 0); assert.equal(r.structuredContent.data.requested, null);
    }
    for (const invalid of ["--all", "", ".", "fixture", "br:main", "lb:", "br:/", "br:/main//child", "br:/main/../other", `${selector}@`, `${selector}@repo@@unity`, `${selector}\n--help`, `${selector} --all`, `${selector}@--repository`, `${selector}*`, branch ? "lb:fixture" : "br:/main/fixture"]) {
        const r = await invoke(a, { ...request, [key]: invalid }); assert(r.isError, invalid); assert.equal(calls.length, 0);
    }
    for (const suffix of ["", "@synthetic-repository", "@synthetic-repository@synthetic-server:8087", "@synthetic-repository@synthetic-org@unity", "@synthetic-repository@synthetic-org@cloud", "@Example Repository@synthetic-server:8087"]) {
        const r = await invoke(a, { ...request, [key]: selector + suffix }); assert(!r.isError, selector + suffix); assert.deepEqual(calls, [[prefix, "editcomment", selector + suffix, request.comment]]);
    }
    for (const comment of ["", " ", "café 日本 😀", "line 1\nline 2\r\ntab\tend", "exists.txt", "x".repeat(4096)]) {
        const r = await invoke(a, { ...request, comment }); assert(!r.isError); assert.deepEqual(calls, [[prefix, "editcomment", selector, comment]]);
    }
    for (const commentsFile of ["synthetic comment.txt", "C:/synthetic-evidence/comment.txt", "./-file", "café.txt"]) {
        const r = await invoke(a, { [key]: selector, commentsFile }); assert(!r.isError); assert.deepEqual(calls, [[prefix, "editcomment", selector, `-commentsfile=${commentsFile}`]]);
    }
    for (const output of ["text", "json"]) {
        const r = await invoke(a, { ...request, output, preflight: true }); assert(!r.isError); assert.equal(calls.length, 0); assert.equal(r.structuredContent.outcome, "preflight"); assert.equal(r.structuredContent.data.capture, null);
    }
    const ok = await invoke(a, request); assert(!ok.isError); assert.equal(ok.structuredContent.data.effect, "not-proven");
    for (const mutate of [
        (d: any) => d.data.intendedArgv.push("--force"), (d: any) => d.action = branch ? "label-edit-comment" : "branch-edit-comment",
        (d: any) => d.data.attempt.exitCode = 1, (d: any) => d.data.attempt.state = "unknown", (d: any) => d.data.attempt.terminal = "not-observed",
        (d: any) => d.data.attempt.aborted = true, (d: any) => d.data.attempt.timedOut = true,
        (d: any) => d.data.capture.stdoutBytes++, (d: any) => d.data.capture.stderrBytes++, (d: any) => d.data.capture.stdoutRetainedBytes++,
        (d: any) => d.data.capture.complete = false, (d: any) => d.data.capture.validUtf8 = false, (d: any) => d.data.capture.truncated = true,
        (d: any) => d.data.commandOutput.text = "fabricated", (d: any) => d.data.commandOutput = null,
        (d: any) => d.data.effect = "not-attempted", (d: any) => d.data.observedUpdatedState = "stored", (d: any) => d.data.observedRepositoryIdentity = "verified",
        (d: any) => d.data.rollback = "atomic", (d: any) => d.completeness.capture = "unknown", (d: any) => d.data.requested = null,
        (d: any) => d.data.requested.comment = "different", (d: any) => d.outcome = "preflight", (d: any) => d.provenance.producer = "foreign",
        (d: any) => { d.data.commandOutput.text = "\ud800"; d.data.capture.stdoutBytes = d.data.capture.stdoutRetainedBytes = 3; },
    ]) { const forged = structuredClone(ok.structuredContent); mutate(forged); assert(!validateObjectCommentOutput(forged), JSON.stringify(forged)); }
    // Closed receipt at every object boundary: missing/unknown fields never admitted.
    function closed(value: any, path: string[] = []) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        for (const k of Object.keys(value)) {
            const forged: any = structuredClone(ok.structuredContent); let target = forged; for (const p of path) target = target[p]; delete target[k]; assert(!validateObjectCommentOutput(forged), [...path, k].join("."));
            closed(value[k], [...path, k]);
        }
        const forged: any = structuredClone(ok.structuredContent); let target = forged; for (const p of path) target = target[p]; target.unknown = true; assert(!validateObjectCommentOutput(forged));
    }
    closed(ok.structuredContent);
    for (const reply of [{ code: 1, err: "SYNTHETIC_PRIVATE_ERROR" }, { err: "SYNTHETIC_PRIVATE_WARNING" }, { out: Buffer.from([255]) }, { err: Buffer.from([255]) }, { out: "x".repeat(65537) }, { err: "x".repeat(16385) }, { launchFail: true }, { start: false }, { partial: true }]) {
        const r = await invoke(a, request, reply); assert(r.isError); assert.equal(calls.length, 1); assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC_PRIVATE/);
        const receipt = r.structuredContent;
        assert.equal(receipt.data.attempt.state, "launchFail" in reply ? "not-started" : "start" in reply ? "unknown" : "started");
        assert.equal(receipt.data.effect, "launchFail" in reply ? "not-attempted" : "uncertain");
        assert.equal(receipt.outcome, "launchFail" in reply ? "failed" : "uncertain");
        if (!receipt.ok) assert.equal(receipt.error.code, "launchFail" in reply ? "launch_failed" : "uncertain");
    }
    const opaque = await invoke(a, request, { out: "synthetic diagnostic, not state\r\n" }); assert(!opaque.isError); assert.equal(opaque.structuredContent.data.observedUpdatedState, null);
    const caller: any = { ...request };
    const snapshot = await invoke(a, caller, { mutate: () => { caller[key] = "--all"; caller.comment = "changed"; caller.preflight = true; caller.workdir = "other"; } });
    assert(!snapshot.isError); assert.equal(snapshot.structuredContent.data.requested!.comment, request.comment); assert.equal(snapshot.structuredContent.data.requested!.preflight, false); assert.equal(snapshot.structuredContent.data.requested!.workdir, process.cwd());
    for (const named of [branch ? "br:/main/Feature Name" : "lb:Release Candidate", branch ? "br:/main/café" : "lb:café"]) {
        const r = await invoke(a, { ...request, [key]: named }); assert(!r.isError); assert.deepEqual(calls, [[prefix, "editcomment", named, request.comment]]);
    }
    const activeAbort = new AbortController(); calls.length = 0;
    const activeResult = await runWithAbortSignal(activeAbort.signal, () => executeObjectCommentOutput(a, request), deps({ partial: true, mutate: () => activeAbort.abort() }));
    assert(activeResult.isError); assert(validateObjectCommentOutput(activeResult.structuredContent)); assert.equal(activeResult.structuredContent.data.attempt.aborted, true); assert.equal(activeResult.structuredContent.outcome, "uncertain"); assert.equal(calls.length, 1);
    const controller = new AbortController(); controller.abort(); calls.length = 0;
    const aborted = await runWithAbortSignal(controller.signal, () => executeObjectCommentOutput(a, request), deps()); assert(validateObjectCommentOutput(aborted.structuredContent)); assert(aborted.isError); assert.equal(calls.length, 0);
    const core = branch ? branchEditComment : labelEditComment;
    calls.length = 0; const json = await runWithAbortSignal(undefined, () => core.execute({ ...request, output: "json" } as any), deps()); assert(validateObjectCommentOutput(JSON.parse(json))); assert.equal(calls.length, 1);
    await assert.rejects(() => runWithAbortSignal(undefined, () => core.execute(request as any), deps({ code: 1 }))); assert.equal(calls.length, 2);
    // Retirement after timeout and partial terminal output is bounded; late events cannot revise the receipt.
    for (const terminal of [false, true]) {
        calls.length = 0;
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => false });
        const r = await runWithAbortSignal(undefined, () => executeObjectCommentOutput(a, request), { timeoutMs: 1, abortKillDelayMs: 1, spawn: ((_cm: string, argv: string[]) => { calls.push([...argv]); queueMicrotask(() => { child.emit("spawn"); child.stdout.write("partial"); if (terminal) child.emit("close", 0, null); }); return child; }) as any });
        assert(r.isError); assert(validateObjectCommentOutput(r.structuredContent)); assert.equal(r.structuredContent.data.attempt.timedOut, true); assert.equal(r.structuredContent.data.attempt.terminal, terminal ? "observed" : "not-observed"); assert.equal(calls.length, 1);
        const frozen = JSON.stringify(r); child.emit("error", Error("synthetic late error")); child.emit("close", 0, null); assert.equal(JSON.stringify(r), frozen);
    }
}
console.log("PASS: object-comment native selected bytes, exact branch/label argv, explicit empty/file/text, preflight, closed receipts/forgeries, bounded transport failures and no retries/hidden commands");
