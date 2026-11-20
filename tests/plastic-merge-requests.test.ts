import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { runWithAbortSignal } from "../src/execution/context";
import { mergeRequestFindOutputSchema, mergeRequestOutputSchema } from "../src/pi/merge-request-output";
import { loadRegisteredTools } from "./pi-tool-harness";

// Captured from cm find mergerequest --xml --encoding=utf-8 on Windows CM
// 11.0.16.10694; IDs, names, timestamps and branch paths replaced with examples.
const xml = readFileSync(new URL("./fixtures/merge-request-10694.xml", import.meta.url), "utf8");
const tools = await loadRegisteredTools();
const command = tools.get("plastic_mergeRequest")!;
const find = tools.get("plastic_mergeRequestFind")!;
const calls: { argv: string[]; cwd?: string; shell?: string | boolean; stdio: unknown; env?: NodeJS.ProcessEnv }[] = [];
let kills = 0;

async function invoke(tool: typeof command, args: Record<string, unknown>, response: { stdout?: string; stderr?: string; code?: number } = {}, signal?: AbortSignal) {
    calls.length = 0;
    const fakeSpawn = ((_executable: string, argv: string[], options: any) => {
        calls.push({ argv, cwd: options.cwd, shell: options.shell, stdio: options.stdio, env: options.env });
        const child = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { kills++; return true; },
        });
        queueMicrotask(() => {
            child.emit("spawn");
            child.stdout.end(response.stdout ?? "");
            child.stderr.end(response.stderr ?? "");
            child.emit("close", response.code ?? 0, null);
        });
        return child;
    }) as typeof spawn;
    return runWithAbortSignal(signal, () => tool.execute("test-mr", args, signal, undefined, { cwd: process.cwd() }), { spawn: fakeSpawn });
}

const oldEditor = process.env.PLASTICEDITOR;
process.env.PLASTICEDITOR = "not-for-this-child";
try {
    for (const [subcommand, args] of [
        ["create", ["br:/main/synthetic@repo@server", "Title \"quoted\" & literal", "--destination=br:/main"]],
        ["merge", ["1367"]],
        ["merge", ["1367", "--merge", "-c=Message\nsecond line"]],
        ["comment", ["add", "1367", "-c=Line <two> & a semicolon;"]],
        ["reviewer", ["list", "1367", "--xml", "--encoding=utf-8"]],
    ] as const) {
        const result = await invoke(command, { subcommand, args }, { stdout: "native text\r\n" });
        assert(Check(mergeRequestOutputSchema, result.structuredContent));
        assert.equal(result.isError, false);
        assert.equal(result.structuredContent.stdout, "native text\r\n");
        assert.deepEqual(calls.map(call => call.argv), [["mergerequest", subcommand, ...args]]);
        assert.equal(calls[0].cwd, process.cwd());
        assert.equal(calls[0].shell, false);
        assert.deepEqual(calls[0].stdio, ["ignore", "pipe", "pipe"]);
        assert(!Object.keys(calls[0].env ?? {}).some(key => key.toUpperCase() === "PLASTICEDITOR"));
        assert.equal(process.env.PLASTICEDITOR, "not-for-this-child");
    }
} finally {
    if (oldEditor === undefined) delete process.env.PLASTICEDITOR;
    else process.env.PLASTICEDITOR = oldEditor;
}

const diagnostic = "Conflict. Run another cm merge command to inspect it.";
const failed = await invoke(command, { subcommand: "merge", args: ["1367", "--merge"] }, { code: 1, stderr: diagnostic });
assert.equal(failed.isError, true);
assert.equal(failed.structuredContent.exitCode, 1);
assert.equal(failed.structuredContent.stderr, diagnostic);
assert.equal(calls.length, 1, "Never execute a native suggestion or retry a failed merge");

const verbose = await invoke(command, { subcommand: "merge", args: ["1367", "--merge"] }, { stdout: "x".repeat(66000) });
assert.equal(verbose.isError, false);
assert.equal(verbose.structuredContent.exitCode, 0);
assert.equal(verbose.structuredContent.truncated, true);
assert.equal(verbose.structuredContent.stdout.length, 65536);
assert.equal(kills, 0, "Diagnostic bounds must not stop a mutation");
assert.equal(calls.length, 1);

for (const args of [
    { subcommand: "status", args: [] },
    { subcommand: "merge", args: ["1367", "--commentsfile=-"] },
    { subcommand: "comment", args: ["add", "1367", "-CommentsFile", "-"] },
    { subcommand: "create", args: ["--descriptionfile=-"] },
    { subcommand: "review", args: ["1367", "\0"] },
]) {
    assert.equal((await invoke(command, args)).isError, true);
    assert.equal(calls.length, 0);
}
const aborted = new AbortController();
aborted.abort();
assert.equal((await invoke(command, { subcommand: "merge", args: ["1367", "--merge"] }, {}, aborted.signal)).isError, true);
assert.equal(calls.length, 0);

const query = "where reviewer='me' limit 20";
const found = await invoke(find, { query }, { stdout: xml });
assert(Check(mergeRequestFindOutputSchema, found.structuredContent));
assert.equal(found.isError, false);
assert.deepEqual(calls.map(call => call.argv), [["find", "mergerequest", query, "--xml", "--encoding=utf-8"]]);
assert.deepEqual(found.structuredContent.rows, [{
    id: "1367", guid: "00000000-0000-4000-8000-000000000001", title: "Synthetic merge request & review", target: "id:100", destination: "br:/main/example",
    mergeRequestStatusName: "Open", codeReviewStatusName: "Under review",
}]);
assert.match(found.content[0].text, /Open \/ Under review/);
const empty = await invoke(find, {}, { stdout: "<PLASTICQUERY/>" });
assert.deepEqual(empty.structuredContent.rows, []);
assert.deepEqual(calls.map(call => call.argv), [["find", "mergerequest", "--xml", "--encoding=utf-8"]]);
for (const response of [{ stdout: xml.slice(0, -20) }, { stdout: xml, code: 1 }, { stdout: xml + " ".repeat(65536) }]) {
    const incomplete = await invoke(find, {}, response);
    assert.equal(incomplete.isError, true);
    assert.equal(incomplete.structuredContent.rows, null);
    assert.equal(calls.length, 1);
}
assert.equal((await invoke(find, { query: " --file=unwanted.xml" })).isError, true);
assert.equal(calls.length, 0);
console.log("PASS: merge request native argv, editor/stdin guards, failure and cancellation, bounded diagnostics, and live-profile XML projection");
