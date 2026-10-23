import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithAbortSignal } from "../src/execution/context";
import { parseReviewCommentsXml } from "../src/domain/review-comments-xml";
import { executeReviewCommentOutput, validateReviewCommentOutput } from "../src/pi/review-comments-output";
import { REVIEW_COMMENT_ACTIONS, type ReviewCommentAction, validateReviewCommentFile, codeReviewCommentAdd, codeReviewCommentFind, codeReviewCommentReply, codeReviewCommentEdit, codeReviewCommentDelete } from "../src/operations/review-comments";
const fixture = JSON.parse(await readFile(new URL("./fixtures/review-comments/native-selected.json", import.meta.url), "utf8"));
const capture = (name: string, stream = "stdout") => Buffer.from(fixture.captures.find((c: any) => c.name === name).streams[stream].base64, "base64");
const guid = "db0ac495-d5cc-4eb8-a888-2d30d3ea9c90";
const bases = { find: { review: "1114" }, add: { review: "1114", comment: "explicit café Ω\n<xml> & | #" }, reply: { commentGuid: guid, comment: "reply" }, edit: { commentGuid: guid, comment: "replacement" }, delete: { commentGuids: [guid] } };
const calls: string[][] = [];
type Reply = { out?: string | Buffer; err?: string | Buffer; code?: number; start?: boolean; throws?: boolean; mutate?: () => void };
function deps(reply: Reply) { return { spawn: ((_c: string, argv: string[]) => { calls.push([...argv]); if (reply.throws) throw Error("launch"); const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => false }); queueMicrotask(() => { if (reply.start !== false) c.emit("spawn"); reply.mutate?.(); c.stdout.end(reply.out ?? ""); c.stderr.end(reply.err ?? ""); c.emit("close", reply.code ?? 0, null); }); return c; }) as any }; }
async function invoke(action: ReviewCommentAction, args: unknown, reply: Reply = {}) { calls.length = 0; const result = await runWithAbortSignal(undefined, () => executeReviewCommentOutput(action, args), deps(reply)); assert(validateReviewCommentOutput(result.structuredContent), JSON.stringify(result)); return result.structuredContent; }
const questionXml = capture("comments-read-inline-question").toString("utf8"), replyXml = capture("comments-read-reply").toString("utf8"), wideXml = capture("comments-read-wide").toString("utf8");
const rows = parseReviewCommentsXml(questionXml, "1114");
assert(rows.some(r => r.text === "synthetic café Ω\nsecond line <xml> & | #\n" && r.line === 2 && r.location === "1" && r.type === "question"));
assert(rows.every(r => r.serverPath === null));
assert(parseReviewCommentsXml(wideXml, "1110").some(r => r.type === "conversation" && r.line === null && r.location === "-1"));
assert(parseReviewCommentsXml(replyXml, "1114").some(r => r.parentId === "1116" && r.type === "comment" && r.line === 1));
for (const xml of [questionXml.replace("<PLASTICQUERY>", "<!DOCTYPE PLASTICQUERY [<!ENTITY x 'x'>]><PLASTICQUERY>"), questionXml.replace("<LINE>2</LINE>", "<LINE></LINE>"), questionXml.replace("<LINE>2</LINE>", "<LINE>0</LINE>"), questionXml.replace("</GUID>", "</GUID><GUID>x</GUID>"), questionXml.replace("<COMMENT>", "<COMMENT><x/>"), questionXml.replace("</PLASTICQUERY>", "<x/></PLASTICQUERY>"), questionXml + "junk", questionXml.slice(0, -30), questionXml.replace("&lt;", "&unknown;"), questionXml.replace("<TYPE>question</TYPE>", "<TYPE>unrecognized</TYPE>")]) assert.throws(() => parseReviewCommentsXml(xml, "1114"));
const multilineXml = wideXml.replace("synthetic wide &lt;xml&gt; &amp; | #", "first\n\nΩ &lt;x&gt; &amp; last");
assert(parseReviewCommentsXml(multilineXml, "1110").some(r => r.text === "first\n\nΩ <x> & last" && r.line === null));
const record = questionXml.match(/<CHANGEREVIEWCOMMENT>[\s\S]*?<\/CHANGEREVIEWCOMMENT>/)![0];
assert.throws(() => parseReviewCommentsXml(questionXml.replace("</PLASTICQUERY>", record + "</PLASTICQUERY>"), "1114"));
assert.throws(() => parseReviewCommentsXml("<PLASTICQUERY>" + record.repeat(501) + "</PLASTICQUERY>", "1114"));
assert.throws(() => parseReviewCommentsXml(questionXml, "1110"));
assert.throws(() => parseReviewCommentsXml("x".repeat(65537), "1114"));
for (const action of REVIEW_COMMENT_ACTIONS) {
    const base = bases[action], out = action === "find" ? questionXml : action === "add" || action === "reply" ? guid + "\r\n" : "";
    for (const bad of [null, [], {}, { ...base, unknown: true }, { ...base, output: "markdown" }, { ...base, preflight: "true" }, { ...base, workdir: "x\n" }, { ...base, output: null }]) { assert(!(await invoke(action, bad)).ok); assert.equal(calls.length, 0); }
    for (const output of ["text", "json"]) { const preview = await invoke(action, { ...base, preflight: true, output }); assert(preview.ok); assert.equal(preview.outcome, "preflight"); assert.equal(calls.length, 0); }
    const ok = await invoke(action, base, { out }); assert(ok.ok); assert.equal(calls.length, 1); assert.equal(ok.data.storedState, null); assert.equal(ok.data.repositoryIdentity, null);
    for (const mutate of [(d: any) => d.data.intendedArgv.push("--force"), (d: any) => d.data.observedGuid = "invented", (d: any) => d.data.observation.capture.stdoutBytes++, (d: any) => d.data.storedState = "verified", (d: any) => d.data.scope = "verified", (d: any) => d.data.extra = true, (d: any) => d.ok = false, (d: any) => d.data.requested.preflight = true]) { const forged = structuredClone(ok); mutate(forged); assert(!validateReviewCommentOutput(forged)); }
    for (const fail of [{ out, code: 1, err: "error" }, { out: Buffer.from([255]) }, { out: "x".repeat(65537) }, { throws: true }, { start: false, out }, { out, err: "warning" }]) { const failed = await invoke(action, base, fail); assert(!failed.ok); assert.equal(calls.length, 1); assert.equal(failed.data.rows, null); assert.equal(failed.data.observedGuid, null); }
    const controller = new AbortController(); controller.abort(); calls.length = 0;
    const aborted = await runWithAbortSignal(controller.signal, () => executeReviewCommentOutput(action, base), deps({ out })); assert(aborted.isError); assert(validateReviewCommentOutput(aborted.structuredContent)); assert.equal(calls.length, 0);
    for (const terminal of [false, true]) {
        calls.length = 0; const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => false });
        const timed = await runWithAbortSignal(undefined, () => executeReviewCommentOutput(action, base), { timeoutMs: 1, abortKillDelayMs: 1, spawn: ((_c: string, argv: string[]) => { calls.push(argv); queueMicrotask(() => { child.emit("spawn"); child.stdout.write("partial"); if (terminal) child.emit("close", 0, null); }); return child; }) as any });
        assert(timed.isError); assert(validateReviewCommentOutput(timed.structuredContent)); assert.equal(calls.length, 1); assert(timed.structuredContent.data.observation!.attempt.timedOut);
        const frozen = JSON.stringify(timed); child.emit("error", Error("late")); child.emit("close", 0, null); assert.equal(JSON.stringify(timed), frozen);
    }
}
for (const bad of [{ review: "--all" }, { review: "0" }, { review: "1 or 1=1" }, { review: guid }, { maxItems: 0 }, { maxItems: 501 }, { maxItems: 1.5 }]) { assert(!(await invoke("find", { ...bases.find, ...bad })).ok); assert.equal(calls.length, 0); }
for (const action of ["add", "reply", "edit"] as const) for (const bad of [{ comment: "" }, { comment: " " }, { comment: undefined }, { comment: "x", commentsFile: "x" }, { comment: undefined, commentsFile: "-" }, { comment: undefined, commentsFile: " - " }, { comment: "x\u0000" }, { comment: "\ud800" }, { comment: "x".repeat(4097) }]) { assert(!(await invoke(action, { ...bases[action], ...bad })).ok); assert.equal(calls.length, 0); }
for (const action of ["reply", "edit"] as const) for (const id of ["1114", "--help", "x", guid + "\n"]) { assert(!(await invoke(action, { ...bases[action], commentGuid: id })).ok); assert.equal(calls.length, 0); }
for (const bad of [{ path: "src/x", line: 1 }, { path: "C:/x", line: 1 }, { path: "/a/../x", line: 1 }, { path: "/a\\x", line: 1 }, { path: "/a" }, { line: 1 }, { path: "/a", line: 0 }, { path: "/a", line: 1.5 }, { path: "/a", line: Number.MAX_SAFE_INTEGER + 1 }, { type: "Change" }, { changeset: "cs:1" }, { path: "/a", line: 1, type: "change" }, { path: "/a", line: 1, changeset: "1" }, { path: "/a", line: 1, changeset: ["cs:16"] }, { path: "/a", line: 1, changeset: {} }, { path: "/a", line: 1, changeset: { toString: () => "cs:16" } }]) { assert(!(await invoke("add", { ...bases.add, ...bad })).ok); assert.equal(calls.length, 0); }
for (const type of ["Change", "Question", "Comment"]) { const d = await invoke("add", { ...bases.add, path: "/README.md", line: 2, changeset: "cs:16", type, repository: "synthetic-repository@synthetic-org@unity" }, { out: guid + "\r\n" }); assert(d.ok); assert.deepEqual(calls[0], ["codereview", "comment", "add", "1114", `-c=${bases.add.comment}`, "--path=/README.md", "--line=2", "--changeset=cs:16", `--type=${type}`, "--repository=synthetic-repository@synthetic-org@unity"]); }
for (const action of ["add", "reply"] as const) for (const out of ["progress " + guid, guid + "\r\nmore", "1116\r\n", "", " " + guid, guid + "\n\n"]) { const d = await invoke(action, bases[action], { out }); assert(d.ok); assert.equal(d.data.observedGuid, null); }
for (const discard of [undefined, false, true]) { const d = await invoke("reply", { ...bases.reply, ...(discard === undefined ? {} : { discard }) }, { out: guid }); assert(d.ok); assert.equal(calls[0].includes("--discard"), discard === true); }
assert(!(await invoke("reply", { ...bases.reply, discard: "true" })).ok); assert.equal(calls.length, 0);
for (const bad of [[], [guid, guid.toUpperCase()], ["1114"], Array(33).fill(guid)]) { assert(!(await invoke("delete", { commentGuids: bad })).ok); assert.equal(calls.length, 0); }
const mixed = await invoke("delete", { commentGuids: [guid, "00000000-0000-4000-8000-249769890001"] }, { code: 1, err: capture("comment-delete-mixed", "stderr") }); assert(!mixed.ok); assert.equal(mixed.outcome, "uncertain"); assert.equal(calls.length, 1);
const bounded = await invoke("find", { review: "1114", maxItems: 1 }, { out: questionXml }); assert(bounded.ok); assert.equal(bounded.data.rows!.length, 1); assert.equal(bounded.completeness.projection, false); assert.deepEqual(calls[0], ["find", "changereviewcomment", "where reviewid=1114", "--xml", "--encoding=utf-8"]);
for (const action of ["reply", "edit", "delete"] as const) for (const extra of [{ review: "1114" }, { type: "Question" }, { path: "/a", line: 1 }]) { assert(!(await invoke(action, { ...bases[action], ...extra })).ok); assert.equal(calls.length, 0); }
const mutable = { review: "1114", comment: "original" };
const immutable = await invoke("add", mutable, { out: guid, mutate: () => { mutable.comment = "later"; } }); assert(immutable.ok); assert.equal(immutable.data.requested!.comment, "original");
const aborter = new AbortController(); calls.length = 0;
const during = await runWithAbortSignal(aborter.signal, () => executeReviewCommentOutput("edit", bases.edit), deps({ mutate: () => aborter.abort() })); assert(during.isError); assert(validateReviewCommentOutput(during.structuredContent)); assert.equal(calls.length, 1); assert.equal(during.structuredContent.data.observation!.attempt.aborted, true);
const tools = [codeReviewCommentFind, codeReviewCommentAdd, codeReviewCommentReply, codeReviewCommentEdit, codeReviewCommentDelete];
for (let n = 0; n < tools.length; n++) { const a = REVIEW_COMMENT_ACTIONS[n]; calls.length = 0; await tools[n].execute({ ...bases[a], preflight: true }); assert.equal(calls.length, 0); }
const dir = await mkdtemp(join(tmpdir(), "review-comment-test-"));
try { for (const bytes of [Buffer.alloc(0), Buffer.from([255]), Buffer.from(" "), Buffer.from("x".repeat(16385))]) { await writeFile(join(dir, "input"), bytes); assert(!(await invoke("edit", { commentGuid: guid, commentsFile: "input", workdir: dir })).ok); assert.equal(calls.length, 0); }
    await writeFile(join(dir, "input"), "synthetic café Ω\nsecond line <xml> & | #\n"); const d = await invoke("edit", { commentGuid: guid, commentsFile: "input", workdir: dir }); assert(d.ok); assert.deepEqual(calls[0], ["codereview", "comment", "edit", guid, "-commentsfile=input"]);
    // Local validation is abort/deadline bounded even before the native executor.
    // A late open must close its handle, not proceed to read or dispatch.
    const regular = { isFile: () => true, size: 1 };
    let opens = 0, closes = 0;
    const preaborted = new AbortController(); preaborted.abort();
    assert.equal(await validateReviewCommentFile("unused", preaborted.signal, { stat: (() => { throw Error("stat after abort"); }) as any, open: (() => { throw Error("open after abort"); }) as any }), "aborted");
    assert.equal(await validateReviewCommentFile("unused", undefined, { stat: (async () => ({ isFile: () => false })) as any, open: (async () => { opens++; throw Error("nonregular open"); }) as any }), "invalid_file");
    assert.equal(opens, 0);
    let release!: (file: any) => void;
    const late = validateReviewCommentFile("unused", undefined, { stat: (async () => regular) as any, open: (() => new Promise(resolve => { release = resolve; })) as any }, 5);
    assert.equal(await late, "file_validation_timeout");
    release({ close: async () => { closes++; }, stat: async () => { throw Error("late stat"); } });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closes, 1);
    const inRead = new AbortController(); let finishRead!: () => void;
    const reading = validateReviewCommentFile("unused", inRead.signal, { stat: (async () => regular) as any, open: (async () => ({ stat: async () => regular, read: () => new Promise(resolve => { finishRead = () => resolve({ bytesRead: 0 }); inRead.abort(); }), close: async () => { closes++; } })) as any });
    assert.equal(await reading, "aborted"); finishRead();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closes, 2);
    const raced = await validateReviewCommentFile("unused", undefined, { stat: (async () => regular) as any, open: (async (_path: string, flags: number) => { assert.equal(flags, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NONBLOCK)); return { stat: async () => ({ isFile: () => false }), close: async () => { closes++; } }; }) as any });
    assert.equal(raced, "invalid_file"); assert.equal(closes, 3);
    calls.length = 0;
    const cancelledFile = await runWithAbortSignal(preaborted.signal, () => executeReviewCommentOutput("edit", { commentGuid: guid, commentsFile: "input", workdir: dir }), deps({}));
    assert(cancelledFile.isError); assert(validateReviewCommentOutput(cancelledFile.structuredContent)); assert.equal(cancelledFile.structuredContent.error!.code, "aborted"); assert.equal(cancelledFile.structuredContent.data.effect, "not-attempted"); assert.equal(calls.length, 0);
    const forgedFileFailure = structuredClone(cancelledFile.structuredContent); delete forgedFileFailure.data.requested!.commentsFile;
    assert(!validateReviewCommentOutput(forgedFileFailure));
    if (process.platform !== "win32") {
        const fifo = join(dir, "no-writer.fifo");
        const made = spawnSync("mkfifo", [fifo], { timeout: 2000, encoding: "utf8" }); assert.equal(made.status, 0, made.stderr);
        // Separate process bounds the regression: the old blocking open must
        // fail this test rather than hang the entire suite on POSIX.
        const code = `import assert from 'node:assert/strict'; import {runWithAbortSignal} from ${JSON.stringify(new URL("../src/execution/context.ts", import.meta.url).href)}; import {executeReviewCommentOutput,validateReviewCommentOutput} from ${JSON.stringify(new URL("../src/pi/review-comments-output.ts", import.meta.url).href)}; let calls=0; const r=await runWithAbortSignal(undefined,()=>executeReviewCommentOutput('edit',${JSON.stringify({ commentGuid: guid, commentsFile: fifo, workdir: dir })}),{spawn:()=>{calls++;throw Error('SCM forbidden')}}); assert(validateReviewCommentOutput(r.structuredContent)); assert(r.isError); assert.equal(r.structuredContent.error.code,'invalid_file'); assert.equal(calls,0);`;
        const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { timeout: 3000, encoding: "utf8", maxBuffer: 65536 });
        assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    } else console.log("SKIP: real no-writer FIFO regression requires POSIX; cancellation, deadline, late-open cleanup and replacement-race guards tested with injected filesystem.");
} finally { await rm(dir, { recursive: true, force: true }); }
console.log("PASS review-comments: scoped XML, exclusive inputs, exact argv, closed receipts, forged evidence, bounded capture/projection, GUID emission, failure/cancel/timeout/late events, no replay");
