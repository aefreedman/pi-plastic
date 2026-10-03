import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { mergeBranches, parseQualifiedServerBranch, serverMergeCapabilityTokens } from "../src/operations/server-merge";
import { serverMergeOutputSchema, validateServerMergeOutput } from "../src/pi/server-merge-output";
const tool = (await loadRegisteredTools()).get("plastic_mergeBranches")!;
const args = { source: "br:/source@Example Repository@example-org@cloud", target: "br:/target 日本-é-😀@Example Repository@example-org@cloud", message: "Fixture résumé 日本語 😀" };
type Scenario = { mode?: string; launch?: "sync" | "async"; helpFail?: boolean; helpMissing?: boolean; code?: number | null; lateError?: boolean; decoded?: boolean; abort?: boolean; timeout?: boolean; ignoreTerm?: boolean; signal?: string };
async function invoke(scenario: Scenario = {}, input: any = args) {
    const calls: string[][] = [], children: any[] = [], timers: any[] = [];
    const controller = new AbortController();
    const spawn = ((_: string, argv: string[]) => {
        calls.push(argv);
        if (argv[0] === "merge" && scenario.launch === "sync") throw Error("private local path");
        const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill(signal: string) { if(scenario.ignoreTerm&&signal==="SIGTERM")return true; queueMicrotask(() => { c.stdout.end(); c.stderr.end(); c.emit("close", null, signal); }); return true; } }); children.push(c);
        if (scenario.decoded && argv[0] === "merge") c.stdout.setEncoding("utf8");
        queueMicrotask(() => {
            if (argv[0] === "merge" && scenario.launch === "async") { c.emit("error", Object.assign(Error("private failure"), { code: "ENOENT" })); return; }
            c.emit("spawn");
            if (argv[0] === "help") { c.stdout.end(scenario.helpMissing ? "other syntax" : serverMergeCapabilityTokens.join(" ")); c.stderr.end(); c.emit("close", scenario.helpFail ? 1 : 0, null); return; }
            const sep = (name: string) => argv.find(a => a.startsWith(name + "="))!.slice(name.length + 1);
            const record = (op: string, fields: string[]) => sep("--startlineseparator") + [op, ...fields].join(sep("--fieldseparator")) + sep("--endlineseparator") + "\r\n";
            const cs = record("CHANGESET", ["cs:9007199254740993@/target 日本-é-😀@Example Repository@example-org@unity (mount:'/')"]);
            let out = scenario.mode === "no-op" ? record("STATUS", ["ALREADY_CONNECTED", "No merges detected"]) : scenario.mode === "conflict" ? record("FILE_CONFLICT", ["/日本😀.txt", "1", "2", "3", "4"]) : cs;
            if (scenario.mode === "projection") out = Array.from({ length: 101 }, (_, i) => record("FILE_CONFLICT", ["/" + i + "-" + "日本😀".repeat(20), "1", "2", "3", "4"])).join("");
            if (scenario.mode === "tail") out += "foreign trailing text";
            if (scenario.mode === "empty") out = "";
            if (scenario.mode === "overflow") out = "x".repeat(65537);
            if (scenario.mode === "charOverflow") out = "x".repeat(16385);
            if (scenario.mode === "unknown") out += record("OTHER", ["unexpected"]);
            if (scenario.mode === "invalidUtf8") { c.stdout.write(Buffer.from([255])); }
            else { const b = Buffer.from(out); for (let i = 0; i < b.length; i += 7) c.stdout.write(b.subarray(i, i + 7)); }
            if (scenario.lateError) c.emit("error", Error("private stream/process failure"));
            if (scenario.abort) controller.abort();
            if (scenario.timeout) return;
            c.stdout.end(); c.stderr.end(scenario.mode === "conflict" ? "private conflict diagnostic" : "");
            c.emit("close", scenario.code !== undefined ? scenario.code : scenario.mode === "conflict" || scenario.mode === "projection" ? 1 : 0, scenario.signal ?? null);
        }); return c;
    }) as any;
    const deps = { spawn, setTimeout: ((cb: () => void, delay: number) => { const t = setTimeout(cb, delay); timers.push(t); if (scenario.timeout && (delay === 30000 || scenario.ignoreTerm && delay === 5000)) queueMicrotask(cb); return t; }) as any, clearTimeout: clearTimeout as any };
    const result = await runWithAbortSignal(controller.signal, () => tool.execute("fixture", input, undefined, undefined, { cwd: "/unrelated" }), deps);
    assert(Check(serverMergeOutputSchema, result.structuredContent)); assert(validateServerMergeOutput(result.structuredContent));
    const dto = result.structuredContent as any; assert.equal(result.isError, !dto.ok); assert.doesNotMatch(JSON.stringify(dto), /private|unrelated/); assert.deepEqual(result.details, {});
    for (const c of children) for (const event of ["spawn", "close", "error"]) assert.equal(c.listenerCount(event), 0);
    return { dto, calls, result };
}
assert.deepEqual(parseQualifiedServerBranch("source", args.source), { raw: args.source, branch: "/source", repository: "Example Repository", server: "example-org@cloud" });
let { dto, calls } = await invoke(); assert(dto.ok); assert.equal(dto.outcome, "completed"); assert.equal(dto.data.createdChangeset.id, "9007199254740993"); assert.equal(dto.data.createdChangeset.server, "example-org@unity"); assert.equal(dto.data.requestedIdentity.server, "example-org@cloud"); assert.equal(dto.data.serverAliasEquivalence, "unverified"); assert.equal(calls.length, 2);
for (const format of ["text", "json"]) { const r = await invoke({}, { ...args, preflight: true, format }); assert.equal(r.calls.length, 0); assert.equal(r.dto.outcome, "preflight"); }
for (const input of [{ ...args, workdir: "/wrong" }, { ...args, extra: true }, { ...args, source: "br:/source@repo@bad@extra@cloud" }, { ...args, message: "x".repeat(4097) }, { ...args, message: "bad\uD800" }, { ...args, preflight: "true" }]) { const r = await invoke({}, input); assert.equal(r.calls.length, 0); assert.equal(r.dto.error.code, "invalid_request"); }
for (const s of [{ launch: "sync" }, { launch: "async" }, { helpFail: true }, { helpMissing: true }] as Scenario[]) { const r = await invoke(s); assert(!r.dto.ok); assert.equal(r.dto.data.effect, "not-attempted"); if (s.launch) assert.equal(r.dto.data.attempt.state, "not-started"); else assert.equal(r.calls.length, 1); }
for (const s of [{ mode: "tail" }, { mode: "empty" }, { mode: "unknown" }, { mode: "invalidUtf8" }, { mode: "overflow" }, { mode: "charOverflow" }, { code: null }, { signal: "SIGTERM" }, { lateError: true }, { decoded: true }, { abort: true }, { timeout: true }, { timeout:true, ignoreTerm:true }] as Scenario[]) { const r = await invoke(s); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.dto.data.effect, "uncertain"); assert.equal(r.calls.filter(c => c[0] === "merge").length, 1); }
({ dto } = await invoke({ mode: "no-op" })); assert(dto.ok); assert.equal(dto.data.effect, "not-proven");
({ dto } = await invoke({ mode: "conflict" })); assert.equal(dto.outcome, "conflict"); assert.deepEqual(dto.data.conflictPaths, ["/日本😀.txt"]);
({ dto } = await invoke({ mode: "projection" })); assert.equal(dto.outcome, "conflict"); assert.equal(dto.data.parse.conflictsObserved, 101); assert.equal(dto.data.counts.conflictsReturned, 100); assert.equal(dto.data.counts.conflictsOmitted, 1); assert.equal(dto.completeness.projection, false);
const damaged = structuredClone(dto); damaged.data.effect = "not-attempted"; assert(!validateServerMergeOutput(damaged));
const coreCalls: string[][] = []; const core = await mergeBranches.execute({ ...args, preflight: true, format: "json" }); assert.match(String(core), /"outcome": "preflight"/); assert.equal(coreCalls.length, 0);
console.log("PASS: closed server receipts, qualified aliases/Unicode/precision, preflight/nonstart/help gates, strict bytes, terminal uncertainty, no retries, lifecycle cleanup and whole-record projection");
