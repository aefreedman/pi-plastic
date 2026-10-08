import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { Check } from "typebox/value";
import { branchCreate } from "../src/operations/branches";
import { parseBranchCreateParent } from "../src/domain/branch-create-contract";
import { captureBranchCreateCommand } from "../src/execution/branch-create-command";
import { runWithAbortSignal } from "../src/execution/context";
import { executeBranchCreateOutput, branchCreateOutputSchema, validateBranchCreateOutput } from "../src/pi/branch-create-output";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/plastic-branch-create-contract.json", import.meta.url), "utf8"));
assert(Check(branchCreateOutputSchema, fixture)); assert(validateBranchCreateOutput(fixture));
const input = { branch: "/main/résumé-é-日本-😀", comment: "Fixture résumé 日本 😀", workdir: "C:/fictional/workspace" };
type Scenario = { output?: string | Buffer; stderr?: string; code?: number | null; signal?: string; launch?: "sync" | "async"; abort?: boolean; preAbort?: boolean; timeout?: boolean; ignoreTerm?: boolean; decoded?: boolean; lateError?: boolean; streamError?: boolean; status?: string; compact?: string; parentFail?: boolean; missingSpawn?: boolean };
async function invoke(s: Scenario = {}, args: unknown = input, core = false) {
    const calls: string[][] = [], children: any[] = [], timers: any[] = [];
    const controller = new AbortController();
    if (s.preAbort) controller.abort();
    const spawn = ((_: string, argv: string[], options: any) => {
        assert.equal(options.cwd, (args as any)?.workdir ?? process.cwd());
        assert.equal(options.shell, false); calls.push(argv);
        if (s.launch === "sync" && argv[0] === "branch") throw Error("private native failure");
        const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill(signal: string) { if (s.ignoreTerm && signal === "SIGTERM") return true; queueMicrotask(() => { c.stdout.end(); c.stderr.end(); c.emit("close", null, signal); }); return true; } });
        children.push(c);
        if (s.decoded) c.stdout.setEncoding("utf8");
        queueMicrotask(() => {
            if (s.launch === "async" && argv[0] === "branch") { c.emit("error", Object.assign(Error("private native failure"), { code: "ENOENT" })); return; }
            if (!s.missingSpawn) c.emit("spawn");
            if (argv[0] === "status") { c.stdout.end(argv.length === 1 ? s.status ?? "/main@Fictional Repository@fictional-org@cloud (cs:9007199254740993 - head)\r\n\r\n" : s.compact ?? "cs:9007199254740993@rep:Fictional Repository@repserver:fictional-org@cloud\r\n"); c.stderr.end(); c.emit("close", s.parentFail ? 1 : 0, null); return; }
            const b = Buffer.isBuffer(s.output) ? s.output : Buffer.from(s.output ?? "");
            for (let i = 0; i < b.length; i += 7) c.stdout.write(b.subarray(i, i + 7));
            if (s.streamError) c.stdout.emit("error", Error("private stream"));
            if (s.lateError) c.emit("error", Error("private native failure"));
            if (s.abort) controller.abort();
            if (s.timeout) return;
            c.stdout.end(); c.stderr.end(s.stderr ?? ""); c.emit("close", s.code === undefined ? 0 : s.code, s.signal ?? null);
        }); return c;
    }) as any;
    const deps = { spawn, setTimeout: ((cb: () => void, delay: number) => { const t = setTimeout(cb, delay); timers.push(t); if (s.timeout && (delay === 30000 || s.ignoreTerm && delay === 5000)) queueMicrotask(cb); return t; }) as any, clearTimeout: clearTimeout as any };
    const result = await runWithAbortSignal(controller.signal, () => core ? branchCreate.execute(args as any) : executeBranchCreateOutput(args), deps);
    for (const c of children) for (const event of ["spawn", "close", "error"]) assert(c.listenerCount(event) === 0 || event === "error" && c.listeners(event).length === 1 && c.listeners(event)[0].name === "ignoreRetiredError");
    for (const c of children) for (const stream of [c.stdout, c.stderr]) for (const event of ["data", "end", "error", "close"]) assert(stream.listenerCount(event) === 0 || event === "error" && stream.listeners(event).length === 1 && stream.listeners(event)[0].name === "ignoreRetiredError");
    for (const t of timers) assert(t._destroyed, "timers cleaned up");
    if (core) { assert.equal(typeof result, "string"); return { calls, result, dto: undefined as any }; }
    const r = result as Awaited<ReturnType<typeof executeBranchCreateOutput>>;
    assert(Check(branchCreateOutputSchema, r.structuredContent)); assert(validateBranchCreateOutput(r.structuredContent));
    assert.deepEqual(r.details, {}); assert.equal(r.isError, !r.structuredContent.ok);
    assert(r.content[0]!.text.length <= 24000); assert(Buffer.byteLength(JSON.stringify(r.structuredContent)) <= 131072);
    assert.doesNotMatch(JSON.stringify(r.structuredContent), /private native|private stream/);
    return { calls, result: r, dto: r.structuredContent };
}
if (process.platform === "win32") {
let r = await invoke(); assert(r.dto.ok, JSON.stringify(r.dto)); assert.equal(r.dto.outcome, "command-completed"); assert.equal(r.dto.data.effect, "not-proven"); assert.equal(r.dto.data.observedCreatedIdentity, null); assert.deepEqual(r.calls, [["branch", "create", input.branch, `-c=${input.comment}`]]);
for (const output of ["", "Unknown creation text", "Created branch 9007199254740993", "Created /different@repo@server\nError: contradictory", "é-é-日本-😀"]) { r = await invoke({ output }); assert(r.dto.ok); assert.equal(r.dto.data.observedCreatedIdentity, null); }
for (const s of [{ code: 1 }, { code: null }, { signal: "SIGTERM" }, { stderr: "private native failure" }, { output: Buffer.from([255]) }, { output: "x".repeat(65537) }, { stderr: "x".repeat(16385) }, { decoded: true }, { missingSpawn: true }, { lateError: true }, { streamError: true }, { abort: true }, { timeout: true }, { timeout: true, ignoreTerm: true }] as Scenario[]) { r = await invoke(s); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.dto.data.effect, "uncertain"); assert.equal(r.calls.length, 1); }
for (const s of [{ launch: "sync" }, { launch: "async" }, { preAbort: true }] as Scenario[]) { r = await invoke(s); assert.equal(r.dto.outcome, "failed"); assert.equal(r.dto.data.effect, "not-attempted"); }
for (const args of [{}, { ...input, extra: true }, { ...input, branch: " " }, { ...input, branch: "x".repeat(4097) }, { ...input, comment: "bad\uD800" }, { ...input, comment: " " }, { ...input, commentsFile: "comment.txt" }, { ...input, changeset: "cs:1", label: "lb:v1" }, { ...input, allowRootBranch: "true" }, { ...input, branch: "/root" }]) { r = await invoke({}, args); assert(!r.dto.ok); assert.equal(r.calls.length, 0); }
r = await invoke({}, { ...input, branch: "child", parent: "/release", changeset: "cs:9007199254740993", comment: undefined, commentsFile: "fixture-comment.txt" }); assert(r.dto.ok); assert.equal(r.dto.data.parentResolution.basis, "explicit"); assert.deepEqual(r.calls, [["branch", "create", "/release/child", "--changeset=cs:9007199254740993", "-commentsfile=fixture-comment.txt"]]);
r = await invoke({}, { ...input, branch: "child" }); assert(r.dto.ok); assert.equal(r.dto.data.parentResolution.basis, "status"); assert.equal(r.calls.length, 2); assert.deepEqual(r.calls[0], ["status"]); assert.equal(r.dto.data.resolvedTarget, "/main/child");
r = await invoke({ status: input.branch + "@Fictional Repository@fictional-org@cloud (cs:16 - head)\r\n" }, { branch: "child" }); assert(r.dto.ok); assert.equal(r.dto.data.resolvedTarget, input.branch + "/child");
for (const status of ["\uFEFF/main@rep@server (cs:16 - head)", "", "unknown", "cs:16@rep:Fixture@repserver:fixture@cloud", "/one@rep@server (cs:16 - head)\n/two@rep@server (cs:16 - head)", "/ma?n@rep@server (cs:16 - head)", "/m�in@rep@server (cs:16 - head)"]) { r = await invoke({ status }, { branch: "child" }); assert(!r.dto.ok); assert.equal(r.dto.data.effect, "not-attempted"); assert.deepEqual(r.calls, [["status"], ["status", "--compact"]]); }
// A compact direct header is not admitted merely because it resembles standard.
r = await invoke({ status: "cs:16@rep:Fixture@repserver:fixture@cloud", compact: "/other@rep@server (cs:16 - head)" }, { branch: "child" }); assert(!r.dto.ok); assert.deepEqual(r.calls, [["status"], ["status", "--compact"]]);
for (const status of ["/one@rep@server (cs:16 - head)\n/one@rep@server (cs:16 - head)", "/main@rep@server (cs:16x - head)", "/main@rep@server (cs:16 - head)\nprivate native extra row", "/main@rep@server (cs:16 - head)\ncs:17"]) { r = await invoke({ status }, { branch: "child" }); assert(!r.dto.ok); assert.equal(r.calls.length, 2); }
r = await invoke({ parentFail: true }, { branch: "child" }); assert.equal(r.calls.length, 1); assert(!r.dto.ok);
for (const args of [{ branch: "child@repo" }, { branch: "child@repo", parent: "/main" }, { branch: "child", parent: "/main@repo@server" }]) { r = await invoke({}, args); assert.equal(r.dto.outcome, "unsupported"); assert.equal(r.calls.length, 0); }
r = await invoke({}, { branch: "br:/main/task@repo@server", parent: "/ignored@elsewhere", label: "lb:v1" }); assert(r.dto.ok); assert.equal(r.calls[0]![2], "br:/main/task@repo@server");
r = await invoke({}, { branch: "/root", allowRootBranch: true }); assert(r.dto.ok);
r = await invoke({}, { branch: "x".repeat(4096), parent: "/" + "p".repeat(4094) }); assert(!r.dto.ok); assert.equal(r.calls.length, 0);
// Unicode maximums exercise aggregate DTO and argv bounds without lossy trimming.
r = await invoke({}, { branch: "/main/" + "日".repeat(4090), parent: "日".repeat(4096), changeset: "日".repeat(4096), comment: "日".repeat(4096), commentsFile: "" }); assert(r.dto.ok);
const success = (await invoke()).dto;
for (const mutate of [(d: any) => d.data.effect = "branch-created", (d: any) => d.data.observedCreatedIdentity = input.branch, (d: any) => d.data.attempt.exitCode = null, (d: any) => d.data.capture.stderrBytes = 1, (d: any) => d.data.resolvedTarget = "/different", (d: any) => d.data.command.push("--other"), (d: any) => d.data.rawResult = "opaque", (d: any) => d.completeness.capture = "unknown", (d: any) => d.data.parentResolution.basis = "status", (d: any) => d.data.capture.complete = false]) { const damaged = structuredClone(success); mutate(damaged); assert(!validateBranchCreateOutput(damaged)); }
await invoke({}, input, true);
await assert.rejects(() => invoke({}, { branch: "/root" }, true), /Refusing to create top-level branch/);
} else {
    for (const args of [input, { branch: "child" }, { branch: "child", parent: "/main" }]) {
        const r = await invoke({}, args);
        assert.equal(r.dto.ok, false);
        assert.equal(r.dto.outcome, "unsupported");
        assert.equal(r.dto.error.code, "unsupported_source");
        assert.equal(r.dto.data.effect, "not-attempted");
        assert.equal(r.calls.length, 0, "unsupported platforms must not dispatch Plastic");
    }
    const core = await invoke({}, input, true);
    assert.match(core.result as string, /admitted only on Windows/);
    assert.equal(core.calls.length, 0);
}
assert.equal(parseBranchCreateParent("/main@rep@server (cs:9007199254740993 - head)\r\n"), "/main");
assert.equal(parseBranchCreateParent("/main@rep@server (cs:9007199254740993x - head)"), null);
// Byte-decoding must not silently remove a source BOM or merge split codepoints.
const captured = await runWithAbortSignal(undefined, () => captureBranchCreateCommand(["status"]), {
    spawn: (() => {
        const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
        queueMicrotask(() => {
            c.emit("spawn");
            const bytes = Buffer.from("\uFEFFé-é-日本-😀");
            for (const byte of bytes) c.stdout.write(Buffer.from([byte]));
            c.stdout.end(); c.stderr.end(); c.emit("close", 0, null);
        });
        return c;
    }) as any,
});
assert.equal(captured.stdout, "\uFEFFé-é-日本-😀");
assert(captured.capture.complete);
assert.equal(captured.capture.stdoutBytes, Buffer.byteLength(captured.stdout!));
console.log("PASS: branch-create terminal-only receipts, closed semantics, strict bounded bytes, original Unicode/precision, parent/source guards, no hidden verification/retry/switch and lifecycle cleanup");
