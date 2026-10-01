import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { branchList } from "../src/operations/branches";
import { branchListRequest, branchListCommand, parseBranchListNames, validBranchListIdentity } from "../src/operations/branch-list";
import { branchListOutputSchema, validateBranchListOutput } from "../src/pi/branch-list-output";
import { BRANCH_LIST_CAPTURE_LIMITS } from "../src/execution/branch-list-command";

const registered = (await loadRegisteredTools()).get("plastic_branchList")!;
assert.deepEqual(registered.outputSchema, branchListOutputSchema);
const identity = "/main/space ü café 日本 😀";
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
    const result = await runWithAbortSignal(options.signal ?? options.abortDuring?.signal, () => registered.execute("synthetic", { source: "names", ...args }, undefined, undefined, { cwd: "/synthetic" }), { spawn, ...(options.outputLimitChars !== undefined ? { outputLimitChars: options.outputLimitChars } : {}), ...(options.timeout ? { timeoutMs: 1, abortKillDelayMs: 1 } : {}) });
    assert(Check(branchListOutputSchema, result.structuredContent));
    assert.equal(result.isError, !result.structuredContent.ok);
    assert.doesNotMatch(JSON.stringify(result), /private (?:spawn|stream|stderr) diagnostic/);
    for (const child of children) {
        assert.equal(child.listenerCount("close"), 0); assert.equal(child.listenerCount("error"), 0);
        assert.equal(child.stdout.listenerCount("data"), 0); assert.equal(child.stderr.listenerCount("data"), 0);
    }
    return result;
}
const direct = await invoke(); const dto = direct.structuredContent;
assert(dto.ok); assert.equal(dto.data.rows[0].branch, identity); assert.equal(dto.data.qualifierVerified, false);
assert.deepEqual(calls, [["find", "branch", "where hidden = 'false'", "--nototal", "--format={name}", "--encoding=utf-8"]]);
assert(!JSON.stringify(dto).includes("/synthetic")); assert.equal(dto.data.limits.maxItems, 100);
assert.deepEqual((await invoke(identity + "\r\n", { format: "json" })).structuredContent, dto);
assert.equal(calls.length, 1); assert.equal(JSON.parse((await invoke(identity + "\r\n", { format: "json" })).details.rawResult).data.rows[0].branch, identity);
for (const suffix of ["", "\n", "\r\n"]) assert.equal((await invoke(identity + suffix)).structuredContent.data.rows[0].branch, identity);
const empty = await invoke(""); assert.deepEqual(empty.structuredContent.data.rows, []);
assert.deepEqual(empty.structuredContent.data.counts, { observed: 0, returned: 0, omitted: 0, excluded: 0 }); assert.equal(empty.structuredContent.completeness.projection, true);
const full = Array.from({ length: 600 }, (_, i) => `/main/row-${i}`).join("\n");
const projected = await invoke(full); assert.deepEqual(projected.structuredContent.data.counts, { observed: 600, returned: 100, omitted: 500, excluded: 0 });
assert.equal(projected.structuredContent.completeness.read, "complete"); assert.equal(projected.structuredContent.completeness.projection, false); assert.match(projected.details.rawResult, /500 observed query rows omitted/);
assert.equal((await invoke(full, { maxItems: 500 })).structuredContent.data.rows.length, 500);
const limited = await invoke("/main/b\n/main/a\n", { limit: 2, maxItems: 1, parent: "br:/main@synthetic-repo@synthetic-server", nameLike: "a%", owner: "me", orderBy: "branchname", descending: true });
assert.deepEqual(limited.structuredContent.data.counts, { observed: 2, returned: 1, omitted: 1, excluded: 0 });
assert.equal(limited.structuredContent.data.query.parent, "br:/main@synthetic-repo@synthetic-server"); assert.equal(limited.structuredContent.data.rows[0].branch, "/main/b");
assert.deepEqual(calls[0], ["find", "branch", "where name like 'a%' and parent = 'br:/main@synthetic-repo@synthetic-server' and owner = 'me' and hidden = 'false'", "order by branchname desc", "limit 2", "--nototal", "--format={name}", "--encoding=utf-8"]);
const ignored = await invoke(identity, { nameLike: "", parent: "", owner: "", descending: true });
assert.deepEqual(ignored.structuredContent.data.query, { nameLike: "", parent: "", owner: "", includeHidden: false, limit: null, orderBy: null, descending: true }); assert(!calls[0].some(a => a.startsWith("order")));
assert.equal((await invoke(identity, { includeHidden: true })).structuredContent.error.code, "unsupported_query"); assert.equal(calls.length, 0);
for (const args of [{ maxItems: 0 }, { maxItems: 501 }, { maxItems: 1.5 }, { limit: 0 }, { limit: Number.MAX_SAFE_INTEGER + 1 }, { limit: NaN }, { owner: "x".repeat(4097) }, { parent: "a\u0000b" }, { nameLike: "\ud800" }, { source: "xml" }]) { assert.equal((await invoke(identity, args)).isError, true); assert.equal(calls.length, 0); }
// Native preserves query and exact legacy presentation, not normalized identities.
const native = await invoke("  synthetic metadata table  \n", { source: "native", includeHidden: true });
assert.equal(native.details.rawResult, "synthetic metadata table"); assert.equal(native.structuredContent.data.rows, null); assert.equal(native.structuredContent.data.counts, null);
assert.deepEqual(native.structuredContent.completeness, { read: "unknown", capture: "unknown", projection: false });
assert.deepEqual(calls[0], ["find", "branch", "where (hidden = 'true' or hidden = 'false')", "--nototal"]);
assert.equal((await invoke("", { source: "native" })).details.rawResult, "(no output)");
assert.deepEqual((await invoke("  synthetic metadata table  \n", { source: "native", includeHidden: true, format: "json" })).structuredContent, native.structuredContent);
assert.equal((await invoke("table", { source: "native" }, { stderr: "legacy warning" })).details.rawResult, "table\nlegacy warning");
assert.equal((await invoke("", { source: "native" }, { code: 1, stderr: "private stderr diagnostic" })).structuredContent.error.code, "command_failed");
for (const bad of ["\n", identity + "\n\n", identity + "\r", identity + "\n3 table columns", "(no output)", "/main//leaf", "/main/", "/", "br:/main", "/main@qualifier", "/main/\\leaf", "/main/\tleaf", "/main/\uFFFD", Buffer.from([0xc3, 0x28]), Buffer.concat([Buffer.from(identity), Buffer.from([0xc3])]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(identity)]), "/" + "x".repeat(4096), full + "\n/main/row-0", full + "\nforeign"]) {
    const result = await invoke(bad); assert.equal(result.isError, true, String(bad).slice(-30)); assert.equal(result.structuredContent.data, undefined); assert.equal(calls.length, 1);
}
assert.equal((await invoke("/" + "x".repeat(4095))).isError, false);
assert(validBranchListIdentity(identity)); assert(!validBranchListIdentity("/main/\ud800"));
assert.equal((await invoke(identity + "\n" + identity, { maxItems: 1 })).structuredContent.error.code, "malformed_output");
assert.equal((await invoke(Array.from({ length: 20000 }, (_, i) => `/b${i}`).join("\n"), { maxItems: 1 })).isError, false);
assert.equal((await invoke(Array.from({ length: 20001 }, (_, i) => `/b${i}`).join("\n"))).structuredContent.error.code, "capture_incomplete");
// Inclusive raw stdout boundary remains independent of compact projected bytes.
const captureBoundaryRows = Array.from({ length: 300 }, (_, i) => "/" + i + "x".repeat(3490));
const capturePadding = BRANCH_LIST_CAPTURE_LIMITS.stdoutBytes - Buffer.byteLength(captureBoundaryRows.join("\n") + "\n");
assert(capturePadding >= 0 && capturePadding < 500);
captureBoundaryRows[299] += "x".repeat(capturePadding);
const captureBoundary = captureBoundaryRows.join("\n") + "\n";
assert.equal(Buffer.byteLength(captureBoundary), BRANCH_LIST_CAPTURE_LIMITS.stdoutBytes);
assert.equal((await invoke(captureBoundary, { maxItems: 1 })).isError, false);
assert.equal((await invoke(Buffer.alloc(BRANCH_LIST_CAPTURE_LIMITS.stdoutBytes + 1, 32))).structuredContent.error.code, "capture_incomplete");
assert.equal((await invoke(identity, {}, { stderr: Buffer.alloc(65537, 32) })).structuredContent.error.code, "capture_incomplete");
for (const options of [{ stderr: "private stderr diagnostic" }, { code: 1 }, { spawnThrow: true }, { spawnError: true }, { streamError: true }, { premature: true }, { decoded: true }, { decodedStderr: true, stderr: "diagnostic" }, { timeout: true }, { abortDuring: new AbortController() }]) assert.equal((await invoke(identity, {}, options)).isError, true);
assert.equal((await invoke("", {}, { decoded: true })).structuredContent.error.code, "command_failed");
assert.equal((await invoke(identity, {}, { decodedStderr: true })).structuredContent.error.code, "command_failed");
assert.equal((await invoke(identity, {}, { stderr: Buffer.alloc(65536, 32) })).structuredContent.error.code, "command_failed");
assert.equal((await invoke("table", { source: "native" }, { timeout: true })).structuredContent.error.code, "capture_incomplete");
assert.equal((await invoke("table", { source: "native" }, { outputLimitChars: 1 })).structuredContent.error.code, "capture_incomplete");
const aborted = new AbortController(); aborted.abort(); assert.equal((await invoke(identity, {}, { signal: aborted.signal })).structuredContent.error.code, "aborted"); assert.equal(calls.length, 0);
const bytes = Buffer.from(identity + "\r\n");
for (let split = 1; split < bytes.length; split++) assert.equal((await invoke(bytes, {}, { split })).structuredContent.data.rows[0].branch, identity);
const overflow = Array.from({ length: 100 }, (_, i) => "/main/" + i + "x".repeat(1600)).join("\n");
assert.equal((await invoke(overflow)).structuredContent.error.code, "output_overflow");
// Exact compact byte ceiling, independent of transport/canonical row counts.
const byteBoundary = structuredClone(dto);
byteBoundary.data.rows = Array.from({ length: 100 }, (_, i) => ({ branch: "/main/" + i + "x".repeat(1280) }));
byteBoundary.data.counts = { observed: 100, returned: 100, omitted: 0, excluded: 0 };
const padding = 131072 - Buffer.byteLength(JSON.stringify(byteBoundary), "utf8");
assert(padding > 0 && padding < 2500);
byteBoundary.data.rows[99].branch += "x".repeat(padding);
assert.equal(Buffer.byteLength(JSON.stringify(byteBoundary)), 131072);
assert.equal(validateBranchListOutput(byteBoundary).ok, true);
byteBoundary.data.rows[99].branch += "x";
assert.equal(validateBranchListOutput(byteBoundary).ok, false);
assert.equal((validateBranchListOutput(byteBoundary) as any).error.code, "output_overflow");
const wrongCount = structuredClone(dto); wrongCount.data.counts.observed++; assert.equal(validateBranchListOutput(wrongCount).ok, false);
const wrongProjection = structuredClone(dto); wrongProjection.completeness.projection = false; assert.equal(validateBranchListOutput(wrongProjection).ok, false);
const foreign = structuredClone(dto); foreign.data.repository = "synthetic"; assert.equal(validateBranchListOutput(foreign).ok, false);
const wrongIdentity = structuredClone(dto); wrongIdentity.data.rows[0].branch = "/main/\uFFFD"; assert.equal(validateBranchListOutput(wrongIdentity).ok, false);
const wrongLimit = structuredClone(dto); wrongLimit.data.query.limit = 0; assert.equal(validateBranchListOutput(wrongLimit).ok, false);
assert.equal((await invoke(identity + "\n/main/other", { limit: 1 })).structuredContent.error.code, "invalid_producer_data");
// Timeout escalation, drain and all listener/timer cleanup when SIGTERM is ignored.
const kills: string[] = [], timers = new Set<NodeJS.Timeout>(); let escalating: any;
const spawn = (() => {
    escalating = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal: string) => {
        kills.push(signal); if (signal === "SIGKILL") queueMicrotask(() => { escalating.stdout.end(); escalating.stderr.end(); escalating.emit("close", null); }); return true;
    } }); return escalating;
}) as any;
const timed = await runWithAbortSignal(undefined, () => registered.execute("synthetic", { source: "names" }, undefined, undefined, { cwd: "/synthetic" }), { spawn, timeoutMs: 1, abortKillDelayMs: 1, setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; }, clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); } });
assert.deepEqual(kills, ["SIGTERM", "SIGKILL"]); assert.equal(timers.size, 0); assert.equal(timed.structuredContent.error.code, "capture_incomplete");
assert.equal(escalating.stdout.listenerCount("data"), 0); assert.equal(escalating.listenerCount("close"), 0);
// Core still emits native default table/sentinel; canonical/json stays one snapshot.
let coreCalls: string[][] = [];
const coreSpawn = ((_command: string, argv: string[]) => { coreCalls.push(argv); const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true }); queueMicrotask(() => { child.stdout.end(argv.includes("--format={name}") ? identity + "\n" : "  table  \n"); child.stderr.end(); child.emit("close", 0); }); return child; }) as any;
assert.equal(await runWithAbortSignal(undefined, () => branchList.execute({}), { spawn: coreSpawn }), "table");
const coreJson = await runWithAbortSignal(undefined, () => branchList.execute({ source: "names", format: "json" }), { spawn: coreSpawn });
assert.deepEqual(JSON.parse(coreJson), dto); assert.equal(coreCalls.length, 2); assert(!coreCalls.flat().includes("version"));
const emptyCoreSpawn = (() => { const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true }); queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("close", 0); }); return child; }) as any;
assert.equal(await runWithAbortSignal(undefined, () => branchList.execute({}), { spawn: emptyCoreSpawn }), "(no output)");
assert.equal(branchListCommand(branchListRequest({ nameLike: "quote'pattern" }).query, "native")[2], "where name like 'quote''pattern' and hidden = 'false'");
assert.deepEqual(parseBranchListNames(Buffer.from("")), []);
console.log("PASS: branch-list strict transport, canonical/native DTO, query/projection/count boundaries and core presentation");
