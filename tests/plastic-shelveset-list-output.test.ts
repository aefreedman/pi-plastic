import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { shelvesetList } from "../src/operations/shelvesets";
import { shelvesetListRequest, shelvesetListCommand, parseShelvesetListIds, validShelvesetId } from "../src/operations/shelveset-list";
import { shelvesetListOutputSchema, validateShelvesetListOutput, type ShelvesetListOutput } from "../src/pi/shelveset-list-output";
import { SHELVESET_LIST_CAPTURE_LIMITS } from "../src/execution/shelveset-list-command";

const registered = (await loadRegisteredTools()).get("plastic_shelvesetList")!;
assert.deepEqual(registered.outputSchema, shelvesetListOutputSchema);
const identity = "17";
let calls: string[][] = [], children: any[] = [];
type Options = { stderr?: Buffer | string; code?: number; split?: number; signal?: AbortSignal; abortDuring?: AbortController; timeout?: boolean; spawnThrow?: boolean; spawnError?: boolean; streamError?: boolean; decoded?: boolean; decodedStderr?: boolean; premature?: boolean; outputLimitChars?: number };
async function invoke(output: Buffer | string = identity + "\r\n", args: Record<string, unknown> = {}, options: Options = {}) {
    calls = []; children = [];
    const spawn = ((_command: string, argv: string[], spawnOptions: any) => {
        assert.equal(spawnOptions.shell, false); calls.push(argv);
        if (options.spawnThrow) throw Error("private spawn diagnostic");
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("close", 1); }); return true; } });
        if (options.decoded) child.stdout.setEncoding("utf8");
        if (options.decodedStderr) child.stderr.setEncoding("utf8");
        children.push(child);
        queueMicrotask(() => {
            if (options.spawnError) { child.emit("error", Error("private spawn diagnostic")); return; }
            if (options.timeout) return;
            if (options.premature) { child.stdout.destroy(); child.stderr.end(); child.emit("close", 0); return; }
            if (options.streamError) { child.stdout.destroy(Error("private stream diagnostic")); child.stderr.end(); child.emit("close", 0); return; }
            const bytes = Buffer.from(output);
            if (options.split !== undefined) { child.stdout.write(bytes.subarray(0, options.split)); child.stdout.write(bytes.subarray(options.split)); }
            else child.stdout.write(bytes);
            child.stderr.end(options.stderr ?? ""); child.stdout.end();
            options.abortDuring?.abort(); child.emit("close", options.code ?? 0);
        });
        return child;
    }) as any;
    const result = await runWithAbortSignal(options.signal ?? options.abortDuring?.signal, () => registered.execute("synthetic", { source: "ids", ...args }, undefined, undefined, { cwd: "/synthetic" }), { spawn, ...(options.outputLimitChars !== undefined ? { outputLimitChars: options.outputLimitChars } : {}), ...(options.timeout ? { timeoutMs: 1, abortKillDelayMs: 1 } : {}) });
    assert(Check(shelvesetListOutputSchema, result.structuredContent));
    assert.equal(result.isError, !result.structuredContent.ok);
    assert.doesNotMatch(JSON.stringify(result), /private (?:spawn|stream|stderr) diagnostic/);
    for (const child of children) {
        assert.equal(child.listenerCount("close"), 0); assert.equal(child.listenerCount("error"), 0);
        assert.equal(child.stdout.listenerCount("data"), 0); assert.equal(child.stderr.listenerCount("data"), 0);
    }
    return result;
}

// Compile-time narrowing deliberately distinguishes native nulls, canonical rows and errors.
function typedRows(dto: ShelvesetListOutput): string[] {
    if (!dto.ok) { const code: string = dto.error.code; return [code]; }
    if (dto.data.mode === "native") { const rows: null = dto.data.rows; return rows === null ? [] : []; }
    return dto.data.rows.map(row => row.shelveset);
}
const direct = await invoke();
const dto = direct.structuredContent;
assert(dto.ok); assert.equal(dto.data.mode, "ids"); assert.deepEqual(typedRows(dto), ["sh:17"]);
assert.deepEqual(dto.data.rows, [{ id: "17", shelveset: "sh:17" }]);
assert.equal(dto.data.scope, "workspace_repository"); assert.equal(dto.data.qualifierVerified, false);
assert.deepEqual(calls, [["find", "shelve", "--nototal", "--format={shelveid}", "--encoding=utf-8"]]);
assert(!JSON.stringify(dto).includes("/synthetic"));
const json = await invoke(identity, { output: "json" });
assert.deepEqual(json.structuredContent, dto); assert.deepEqual(JSON.parse(json.content[0].text), dto); assert.equal(calls.length, 1);
assert.equal((await invoke(identity)).content[0].text, "sh:17");
for (const suffix of ["", "\n", "\r\n"]) assert.equal((await invoke(identity + suffix)).structuredContent.data.rows[0].id, identity);
const empty = await invoke("");
assert.deepEqual(empty.structuredContent.data.rows, []);
assert.deepEqual(empty.structuredContent.data.counts, { observed: 0, returned: 0, omitted: 0, excluded: 0 });
assert.equal((await invoke("9007199254740993")).structuredContent.data.rows[0].id, "9007199254740993");
assert.equal((await invoke("0")).structuredContent.data.rows[0].shelveset, "sh:0");
assert.equal((await invoke("9".repeat(20))).isError, false);
const full = Array.from({length: 600}, (_, i) => String(i)).join("\n");
const projected = await invoke(full);
assert.deepEqual(projected.structuredContent.data.counts, { observed: 600, returned: 100, omitted: 500, excluded: 0 });
assert.equal(projected.structuredContent.completeness.projection, false);
assert.equal((await invoke(full, {maxItems: 500})).structuredContent.data.rows.length, 500);
const repeated = await invoke(full + "\n17", {maxItems: 1});
assert.equal(repeated.structuredContent.data.diagnostics.duplicateRecords, 1);
assert.deepEqual((await invoke("17\n17")).structuredContent.data.rows, [dto.data.rows[0], dto.data.rows[0]]);
const query = await invoke("17\n3", {owner: "O'Neil", commentLike: "日本_%", dateFrom: "2026-01-01", limit: 2, maxItems: 1});
assert.deepEqual(calls[0], ["find","shelve","where owner = 'O''Neil' and comment like '日本_%' and date >= '2026-01-01'", "limit 2", "--nototal","--format={shelveid}","--encoding=utf-8"]);
assert.equal(query.structuredContent.data.counts.observed, 2);
assert.equal((await invoke("1\n2", {limit: 1})).structuredContent.error.code, "invalid_producer_data");
for (const args of [{format: "{comment}"}, {dateFormat: "yyyy"}]) {
    assert.equal((await invoke(identity, args)).structuredContent.error.code, "unsupported_query"); assert.equal(calls.length, 0);
}
assert.equal((await invoke(identity, {format: "", dateFormat: "", owner: "", dateFrom: "", commentLike: ""})).isError, false);
assert.equal((await invoke("  legacy table  \n", {source: "native"})).details.rawResult, "legacy table");
const native = await invoke("legacy table", {source: "native", format: "{shelveid}\t{comment}\n😀", dateFormat: "yyyy", owner: "me", limit: 3});
assert.equal(native.structuredContent.data.rows, null); assert.equal(native.structuredContent.data.counts, null);
assert.deepEqual(native.structuredContent.completeness, {read: "unknown", capture: "unknown", projection: false});
assert.deepEqual(calls[0], ["find","shelve","where owner = 'me'","limit 3","--format={shelveid}\t{comment}\n😀","--dateformat=yyyy","--nototal"]);
assert.equal((await invoke("", {source: "native"})).details.rawResult, "(no output)");
assert.equal((await invoke("table", {source: "native"}, {stderr: "legacy warning"})).details.rawResult, "table\nlegacy warning");
assert.equal((await invoke("", {source: "native"}, {code: 1})).structuredContent.error.code, "command_failed");
const nativeJson = await invoke("table", {source: "native", output: "json"});
assert.deepEqual(JSON.parse(nativeJson.content[0].text), nativeJson.structuredContent); assert.equal(calls.length, 1);
for (const bad of ["\n", "17\n\n", "17\r", " 17", "17 ", "01", "-1", "1.0", "sh:1", "1e3", "header", "17\t3", "17\nTotal: 1", "9".repeat(21), "日本", "\ufeff17", Buffer.from([0xff]), full + "\nforeign"]) {
    const r = await invoke(bad, {maxItems: 1}); assert(r.isError, String(bad)); assert.equal(r.structuredContent.data, undefined);
}
for (const args of [{maxItems: 0}, {maxItems: 501}, {maxItems: 1.5}, {limit: 0}, {limit: Number.MAX_SAFE_INTEGER + 1}, {source: "xml"}, {output: "yaml"}, {owner: "\ud800"}, {owner: "x".repeat(4097)}, {dateFrom: "x\n"}, {format: "\u0000"}, {dateFormat: "\ud800"}, {dateFormat: "x".repeat(4097)}]) {
    assert((await invoke(identity,args)).isError); assert.equal(calls.length,0);
}
const maxRecords = Array.from({length: 20000}, (_,i) => String(i)).join("\n");
assert.equal((await invoke(maxRecords, {maxItems: 1})).isError,false);
assert.equal((await invoke(maxRecords + "\n20000")).structuredContent.error.code,"capture_incomplete");
assert.equal((await invoke(Buffer.alloc(SHELVESET_LIST_CAPTURE_LIMITS.stdoutBytes + 1, 49))).structuredContent.error.code,"capture_incomplete");
// Inclusive byte cap captures fully, then rejects malformed/overlong identity.
assert.equal((await invoke(Buffer.alloc(SHELVESET_LIST_CAPTURE_LIMITS.stdoutBytes, 49))).structuredContent.error.code,"invalid_identity");
assert.equal((await invoke(identity,{}, {stderr: Buffer.alloc(65537, 32)})).structuredContent.error.code,"capture_incomplete");
assert.equal((await invoke(identity,{}, {stderr: Buffer.alloc(65536, 32)})).structuredContent.error.code,"command_failed");
for (const options of [{stderr: "private stderr diagnostic"}, {code: 1}, {spawnThrow: true}, {spawnError: true}, {streamError: true}, {premature: true}, {decoded: true}, {decodedStderr: true}, {timeout: true}, {abortDuring: new AbortController()}]) assert((await invoke(identity,{},options)).isError);
const aborted = new AbortController(); aborted.abort();
assert.equal((await invoke(identity,{}, {signal: aborted.signal})).structuredContent.error.code,"aborted"); assert.equal(calls.length,0);
for (const mutate of [
    (x:any)=>x.data.rows[0].shelveset="sh:3",
    (x:any)=>x.data.counts.observed++,
    (x:any)=>x.data.diagnostics.duplicateRecords=1,
    (x:any)=>x.data.query.owner="\ud800",
    (x:any)=>x.data.extra=true,
    (x:any)=>x.completeness.projection=false,
]) {const x=structuredClone(dto); mutate(x); assert.equal(validateShelvesetListOutput(x).ok,false);}
// Timeout escalation, drain and all listener/timer cleanup when SIGTERM is ignored.
const kills: string[] = [], timers = new Set<NodeJS.Timeout>(); let escalating: any;
const spawn = (() => {
    escalating = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal: string) => {
        kills.push(signal); if (signal === "SIGKILL") queueMicrotask(() => { escalating.stdout.end(); escalating.stderr.end(); escalating.emit("close", null); }); return true;
    } }); return escalating;
}) as any;
const timed = await runWithAbortSignal(undefined, () => registered.execute("synthetic", { source: "ids" }, undefined, undefined, { cwd: "/synthetic" }), { spawn, timeoutMs: 1, abortKillDelayMs: 1, setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; }, clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); } });
assert.deepEqual(kills, ["SIGTERM", "SIGKILL"]); assert.equal(timers.size, 0); assert.equal(timed.structuredContent.error.code, "capture_incomplete");
assert.equal(escalating.stdout.listenerCount("data"), 0); assert.equal(escalating.listenerCount("close"), 0);
const coreCalls:string[][]=[];
const core = await runWithAbortSignal(undefined, () => shelvesetList.execute({format:"{comment}",dateFormat:"yyyy",workdir:"/synthetic"}), {spawn: ((_cmd:string,argv:string[])=>{
    coreCalls.push(argv); const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
    queueMicrotask(()=>{child.stdout.end(" native custom \n");child.stderr.end();child.emit("close",0);});return child;
}) as any});
assert.equal(core,"native custom"); assert.deepEqual(coreCalls,[["find","shelve","--format={comment}","--dateformat=yyyy","--nototal"]]);
console.log("PASS: shelveset list contract, exact decimal identities, templates, counts, bounds, whole-response parser, native errors, transport and core compatibility");
