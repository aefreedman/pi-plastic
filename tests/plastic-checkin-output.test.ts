import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { captureCheckinCommand } from "../src/execution/checkin-command";
import { checkin } from "../src/operations/checkin";
import { assembleCheckinReceipt } from "../src/operations/checkin-receipt";
import { checkinOutputSchema, executeCheckinOutput, validateCheckinOutput } from "../src/pi/checkin-output";
import { parseCheckinEvidence, parseCheckinPending, parseCheckinChangeset, checkinSafeComment, checkinSafeValue } from "../src/domain/checkin-contract";
const us = "\x1f", cwd = "C:\\Example\\workspace", name = "résumé-é-日本-😀.txt", path = cwd + "\\" + name;
const header = ["STATUS", "9007199254740993", "Example Repository", "example@unity"].join(us) + "\r\n";
const row = (code = "CH", file = path) => [code, file, "False", code === "PR" || code === "AD" ? "-1" : "9007199254740995", "NO_MERGES"].join(us) + "\r\n";
const checkedOutRow = (file = path) => ["CO", file, "False", "-1", "NO_MERGES"].join(us) + "\r\n";
const payload = "cs:9007199254740997@br:/main/café-é-日本-😀@Example Repository@example@unity (mount:'/')";
const input = { message: "Fixture résumé é 日本語 😀", workdir: cwd, paths: [name] };
type Scenario = { mode?: string; native?: string; private?: boolean; recoveryFail?: boolean; afterFail?: boolean; addFail?: boolean; retryFail?: boolean; fallback?: boolean; pending?: string; preabort?: boolean; launch?: "sync" | "async"; lateError?: boolean; decoded?: boolean; abort?: boolean; timeout?: boolean; ignoreTerm?: boolean; code?: number | null; signal?: string; stderr?: string; scopeMany?: boolean; noSpawn?: boolean; streamError?: boolean; payload?: string };
async function invoke(scenario: Scenario = {}, args: any = input, core = false, registered?: any) {
    const calls: string[][] = [], children: any[] = [], timers = new Set<any>(), controller = new AbortController();
    let reads = 0, checkins = 0;
    if (scenario.preabort) controller.abort();
    const deps = { spawn: ((_: string, argv: string[], options: any) => {
        calls.push(argv); assert.equal(options.cwd, cwd); assert.equal(options.shell, false);
        if (argv[0] === "checkin" && scenario.launch === "sync") throw Error("PRIVATE_PATH");
        const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill(signal: string) { if (scenario.ignoreTerm && signal === "SIGTERM") return true; queueMicrotask(() => { c.stdout.end(); c.stderr.end(); c.emit("close", null, signal); }); return true; } }); children.push(c);
        if (scenario.decoded && argv[0] === "checkin") c.stdout.setEncoding("utf8");
        queueMicrotask(() => {
            if (argv[0] === "checkin" && scenario.launch === "async") { c.emit("error", Object.assign(Error("PRIVATE_PATH"), { code: "ENOENT" })); return; }
            if (!(argv[0] === "checkin" && scenario.noSpawn)) c.emit("spawn");
            let out = "", err = "", code: number | null = 0;
            if (argv[0] === "status") {
                reads++; out = header;
                if (reads === 1) out += scenario.pending ?? (scenario.private ? row("PR") : scenario.fallback ? row("LD") : row());
                if (reads > 1 && (scenario.recoveryFail || scenario.afterFail)) { err = "PRIVATE_PATH read failure"; code = 1; }
            } else if (argv[0] === "add") { out = "PRIVATE_PATH native add output"; if (scenario.addFail) code = 1; }
            else {
                checkins++;
                const sep = (k: string) => argv.find(a => a.startsWith(k + "="))!.slice(k.length + 1);
                const record = (op: string, values: string[] = []) => sep("--startlineseparator") + [op, ...values].join(sep("--fieldseparator")) + sep("--endlineseparator") + "\r\n";
                out = record("CI_START") + record("STAGE", [""]);
                const failing = scenario.native && checkins === 1 || scenario.retryFail && checkins === 2 || scenario.fallback && checkins === 1;
                if (failing) { err = scenario.fallback ? "is not changed in current workspace" : scenario.native ?? "No changes in the workspace"; code = 1; }
                else out += record("CO", [path]) + record("CHANGESET", [scenario.payload ?? payload]);
                switch (scenario.mode) {
                    case "empty": out = ""; break;
                    case "bom": out = "\uFEFF" + out; break;
                    case "unknown": out += record("OTHER", ["unexpected"]); break;
                    case "extra": out += record("AD", [path, "extra"]); break;
                    case "duplicate": out += record("CHANGESET", [payload]); break;
                    case "mount": out = record("CI_START") + record("CHANGESET", [payload.replace("mount:'/'", "mount:'/other'")]); break;
                    case "repository": out = record("CI_START") + record("CHANGESET", [payload.replace("Example Repository", "Other")]); break;
                    case "bare": out = record("CI_START") + record("CHANGESET", [payload.replace("@br:", "@")]); break;
                    case "tail": out += "unframed"; break;
                    case "overflow": out = "x".repeat(65537); break;
                    case "stderrOverflow": err = "x".repeat(16385); break;
                    case "records": out = record("CI_START") + Array.from({ length: 501 }, () => record("STAGE", [""])).join(""); break;
                    case "projection": out = record("CI_START") + Array.from({ length: 101 }, (_, i) => record("AD", [cwd + "\\" + i + "-" + name])).join("") + record("CHANGESET", [payload]); break;
                    case "mv": out = record("CI_START") + record("DE", [path]) + record("MV", [path, cwd + "\\new-" + name]) + record("CHANGESET", [payload]); break;
                }
                if (scenario.stderr) err = scenario.stderr;
                if (scenario.code !== undefined) code = scenario.code;
                if (scenario.mode === "invalidUtf8") c.stdout.write(Buffer.from([255]));
                else { const b = Buffer.from(out); for (let i = 0; i < b.length; i += 3) c.stdout.write(b.subarray(i, i + 3)); }
                if (scenario.lateError) c.emit("error", Error("PRIVATE_PATH process failure"));
                if (scenario.streamError) c.stdout.emit("error", Error("PRIVATE_PATH stream failure"));
                if (scenario.abort) controller.abort();
                if (scenario.timeout) return;
                c.stdout.end(); c.stderr.end(err); c.emit("close", code, scenario.signal ?? null); return;
            }
            c.stdout.end(out); c.stderr.end(err); c.emit("close", code, null);
        }); return c;
    }) as any, setTimeout: ((cb: () => void, delay: number) => { const t = setTimeout(cb, delay); timers.add(t); if (scenario.timeout && calls.at(-1)?.[0] === "checkin" && (delay === 30000 || scenario.ignoreTerm && delay === 5000)) queueMicrotask(cb); return t; }) as any, clearTimeout: ((t: any) => { clearTimeout(t); timers.delete(t); }) as any };
    const result = await runWithAbortSignal(controller.signal, () => registered ? registered.execute("fixture", args) : core ? checkin.execute(args) : executeCheckinOutput(args), deps);
    if (core) return { result, calls, dto: null as any };
    const r = result as Awaited<ReturnType<typeof executeCheckinOutput>>, dto = r.structuredContent;
    assert(Check(checkinOutputSchema, dto)); assert(validateCheckinOutput(dto)); assert.equal(r.isError, !dto.ok); assert.deepEqual(r.details, {});
    assert.doesNotMatch(JSON.stringify(dto), /PRIVATE_PATH/); assert(Buffer.byteLength(r.content[0].text, "utf8") <= 24000); assert(Buffer.byteLength(JSON.stringify(dto)) <= 131072);
    assert.equal(timers.size, 0);
    for (const c of children) { for (const e of ["spawn", "close", "error"]) assert(c.listenerCount(e) === 0 || e === "error" && c.listeners(e).length === 1 && c.listeners(e)[0].name === "ignoreRetiredError"); for (const stream of [c.stdout, c.stderr]) for (const e of ["data", "end", "error", "close"]) assert(stream.listenerCount(e) === 0 || e === "error" && stream.listeners(e).length === 1 && stream.listeners(e)[0].name === "ignoreRetiredError"); }
    return { result, calls, dto };
}
if (process.platform !== "win32") {
    const dto = await assembleCheckinReceipt(input); assert(!dto.ok && dto.outcome === "unsupported");
    console.log("PASS: non-Windows source admission; Windows source suite not applicable");
} else {
let r = await invoke(); assert(r.dto.ok); assert.equal(r.dto.data.createdChangeset.id, "9007199254740997"); assert.equal(r.dto.data.createdChangeset.branch, "/main/café-é-日本-😀"); assert.equal(r.dto.data.createdChangeset.server, "example@unity"); assert.equal(r.calls.length, 3);
const registered = (await loadRegisteredTools()).get("plastic_checkin")!;
for (const newline of ["\n", "\r\n", "\r"]) {
    const message = `  Fixture 😀${newline}Details${newline}  `;
    for (const tool of [undefined, registered]) {
        r = await invoke({}, { ...input, message }, false, tool);
        assert(r.dto.ok);
        assert.deepEqual(r.calls.find(c => c[0] === "checkin")!.filter(a => a.startsWith("-c=")), [`-c=${message}`]);
        assert.equal(r.dto.data.command[2], `-c=${message}`);
    }
}
for (const control of ["\0", "\t", "\x1f", "\x7f", "\x85"]) {
    r = await invoke({}, { ...input, message: `Fixture\n${control}Details` }, false, registered);
    assert.equal(r.calls.length, 0); assert.equal(r.dto.error.code, "invalid_request");
}
for (const newline of ["\n", "\r\n"]) {
    for (const args of [{ ...input, paths: [`file${newline}other`] }, { ...input, workdir: `${cwd}${newline}other` }]) {
        r = await invoke({}, args); assert.equal(r.calls.length, 0); assert.equal(r.dto.error.code, "invalid_request");
    }
}
for (const format of ["text", "json"]) { r = await invoke({}, { ...input, preflight: true, format }); assert.equal(r.dto.outcome, "preflight"); assert.equal(r.calls.length, 1); }
r = await invoke({}, { ...input, updateAfter: true, preflight: true }); assert.equal(r.calls.length, 0); assert.equal(r.dto.error.code, "UNATTENDED_UPDATE_AFTER_BLOCKED");
for (const args of [{ ...input, message: "x".repeat(4097) }, { ...input, message: "bad\uD800" }, { ...input, paths: Array(101).fill("x") }, { ...input, paths: Array(10).fill("x".repeat(4096)) }, { ...input, paths: ["--private"] }, { ...input, paths: ["-"] }, { ...input, includePrivate: "true" }]) { r = await invoke({}, args); assert.equal(r.calls.length, 0); assert.equal(r.dto.outcome, "failed"); }
for (const pending of ["", "UNKNOWN", row(), row("CO"), row("CH").replace("NO_MERGES", "other"), row("CH").replace(path, path + "?"), row("CH").replace(path, path + "\uFFFD"), row("CH").replace("9007199254740995", "1.5"), row("CH").replace("False", "False\x1fEXTRA")]) { r = await invoke({ pending: pending === "" ? "" : pending }); if (pending === "") assert.equal(r.dto.error.code, "NO_PENDING_PATHS"); else if (pending === row()) assert(r.dto.ok); else assert.equal(r.dto.outcome, "unsupported"); }
for (const s of [{ mode: "empty" }, { mode: "bom" }, { noSpawn: true }, { streamError: true }, { mode: "unknown" }, { mode: "extra" }, { mode: "duplicate" }, { mode: "mount" }, { mode: "repository" }, { mode: "bare" }, { mode: "tail" }, { mode: "overflow" }, { mode: "stderrOverflow" }, { mode: "records" }, { mode: "invalidUtf8" }, { code: null }, { signal: "SIGTERM" }, { lateError: true }, { decoded: true }, { abort: true }, { timeout: true }, { timeout: true, ignoreTerm: true }, { stderr: "PRIVATE_PATH diagnostic" }, { code: 1 }] as Scenario[]) { r = await invoke(s); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.calls.filter(c => c[0] === "checkin").length, 1); assert.equal(r.dto.data.createdChangeset, null); }
for (const launch of ["sync", "async"] as const) { r = await invoke({ launch }); assert.equal(r.dto.data.effect, "not-attempted"); assert.equal(r.dto.data.steps[1].attempt.state, "not-started"); }
// General CO admission: unrelated checkouts must not block a selected CH path,
// and selected checkouts must retain their requested scope without invented bases.
const unrelatedCheckout = cwd + "\\unrelated-checked-out.txt";
const mixedPending = row() + checkedOutRow(unrelatedCheckout);
const mixedParsed = parseCheckinPending(header + mixedPending, cwd);
assert(mixedParsed.admitted);
assert.equal(mixedParsed.items[1].kind, "changed");
assert.equal(mixedParsed.items[1].revisionId, undefined);
for (const tool of [undefined, registered]) {
    r = await invoke({ pending: mixedPending }, input, false, tool);
    assert(r.dto.ok);
    assert.equal(r.dto.data.pendingBefore.changed, 2);
    assert.deepEqual(r.dto.data.includedPaths, [name]);
    assert(!r.calls.find(c => c[0] === "checkin")!.some(a => a.includes("unrelated-checked-out")));
    r = await invoke({ pending: checkedOutRow() }, input, false, tool);
    assert(r.dto.ok);
    assert.deepEqual(r.dto.data.includedPaths, [name]);
    assert.deepEqual(r.calls.map(c => c[0]), ["status", "checkin", "status"]);
}
for (const invalid of [
    checkedOutRow().replace("-1", "0"), checkedOutRow().replace("-1", "42"),
    checkedOutRow().replace("-1", "-2"), checkedOutRow().replace("NO_MERGES", "MERGE"),
    checkedOutRow().replace("False", "unknown"), checkedOutRow().replace(path, "relative.txt"),
    checkedOutRow().replace(path, path + "?"), checkedOutRow().replace(path, path + "\uFFFD"),
    checkedOutRow().replace("NO_MERGES", "NO_MERGES" + us + "extra"),
]) {
    r = await invoke({ pending: row() + invalid });
    assert.equal(r.dto.outcome, "unsupported");
    assert.equal(r.dto.error.code, "pending_source_unadmitted");
    assert.deepEqual(r.calls.map(c => c[0]), ["status"]);
}
r = await invoke({ preabort: true }); assert.equal(r.calls.length, 0); assert.equal(r.dto.outcome, "unsupported");
r = await invoke({ private: true, native: "There are no changes in the workspace" }); assert(r.dto.ok); assert.deepEqual(r.calls.map(c => c[0]), ["status", "checkin", "add", "checkin", "status"]); assert.equal(r.dto.data.steps[2].effect, "command-completed"); assert.equal(r.dto.data.usedPrivateAutoAddRecovery, true);
r = await invoke({ private: true, native: "No changes in the workspace", retryFail: true }); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.dto.data.steps[2].effect, "command-completed"); assert.equal(r.dto.data.effect, "uncertain");
r = await invoke({ private: true, native: "No changes in the workspace", addFail: true }); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.calls.filter(c => c[0] === "checkin").length, 1);
r = await invoke({ private: true, pending: row("PR", cwd + "\\.env.local"), native: "No changes in the workspace" }, { ...input, paths: [".env.local"] }); assert.equal(r.dto.error.code, "sensitive_private_paths"); assert.equal(r.calls.length, 2);
r = await invoke({ private: true, native: "No changes in the workspace" }, { message: input.message, workdir: cwd }); assert.equal(r.dto.error.code, "private_items_ineligible"); assert.equal(r.calls.length, 2);
for (const recoveryFail of [false, true]) { r = await invoke({ native: "No changes in the workspace", recoveryFail }); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.calls.length, 3); assert.equal(r.dto.data.pendingAfter?.totalPending ?? null, recoveryFail ? null : 0); }
r = await invoke({ afterFail: true }); assert(r.dto.ok); assert.equal(r.dto.data.pendingAfter, null); assert.equal(r.dto.completeness.capture, "complete");
r = await invoke({ private: true, native: "No changes in the workspace", afterFail: true }); assert(r.dto.ok); assert.equal(r.dto.data.pendingAfter, null); assert.equal(r.dto.data.steps[2].effect, "command-completed"); assert.equal(r.dto.data.steps[3].effect, "changeset-created");
for (const scenario of [{ mode: "unknown" }, { mode: "bom" }, { mode: "repository" }, { noSpawn: true }, { streamError: true }, { lateError: true }, { timeout: true }] as Scenario[]) {
    r = await invoke(scenario); assert.deepEqual(r.dto.data.itemEvents, []); assert.deepEqual(r.dto.data.observedChangesets, []);
}
r = await invoke({ fallback: true }); assert(r.dto.ok); assert.equal(r.dto.data.usedFallbackRetry, true); assert(r.calls[2].includes("--applychanged")); assert.equal(r.calls[2].filter(a => a === name).length, 0);
r = await invoke({ native: "Checkin operation cannot be started because there is a merge in progress", recoveryFail: true }); assert.equal(r.dto.error.code, "merge_in_progress"); assert.deepEqual(r.calls[2], ["status"]);
r = await invoke({ payload: `cs:9007199254740997@br:/${"日".repeat(4000)}@Example Repository@${"日".repeat(4000)} (mount:'/')` }); assert(r.dto.ok); assert.match(r.result.content[0].text, /Presentation omitted/);
r = await invoke({ mode: "projection" }); assert(r.dto.ok); assert(r.dto.data.omittedReferences > 0); assert.equal(r.dto.completeness.projection, false);
r = await invoke({ mode: "mv" }); assert(r.dto.ok); assert.equal(r.dto.data.itemEvents[1].sourcePath, path); assert.equal(r.dto.data.itemEvents[1].path, cwd + "\\new-" + name);
const damaged = structuredClone(r.dto); damaged.data.effect = "not-attempted"; assert(!validateCheckinOutput(damaged));
const raw = structuredClone(r.dto); raw.data.rawResult = "opaque"; assert(!validateCheckinOutput(raw));
const terminal = structuredClone(r.dto); terminal.data.steps[1].attempt.exitCode = null; assert(!validateCheckinOutput(terminal));
const aggregate = structuredClone(r.dto); aggregate.data.requestedPaths = Array(100).fill("x"); assert(!validateCheckinOutput(aggregate));
const core = await invoke({}, { ...input, preflight: true, format: "json" }, true); assert.equal(typeof core.result, "string"); assert.match(core.result as string, /"outcome":"preflight"/);
console.log("PASS: checkin closed receipts, native compound policy, source admission, Unicode precision, bounded full classification/projection, uncertainty and injected lifecycle cleanup");
}
const fixture = JSON.parse(readFileSync(new URL("./fixtures/plastic-checkin-source.json", import.meta.url), "utf8"));
assert(parseCheckinPending(fixture.pending, cwd).admitted);
const fixtureCreated = parseCheckinEvidence(fixture.created, fixture.separators);
assert(fixtureCreated.admitted); assert.equal(fixtureCreated.changesets[0].id, "9007199254740997"); assert.equal(fixtureCreated.events[0].path, path);
const fixtureNoChanges = parseCheckinEvidence(fixture.noChanges, fixture.separators);
assert(fixtureNoChanges.admitted); assert.deepEqual(fixtureNoChanges.changesets, []); assert.equal(fixture.noChangesExit, 1);
const seps = { start: "START", end: "END", field: "FIELD" }, framed = (op: string, ...fields: string[]) => seps.start + [op, ...fields].join(seps.field) + seps.end + "\r\n";
assert(parseCheckinEvidence(framed("CI_START") + framed("STAGE", "") + framed("CHANGESET", payload), seps).admitted);
assert(!parseCheckinEvidence(framed("CI_START") + framed("MV", path), seps).admitted);
assert(!parseCheckinEvidence(framed("CI_START") + framed("MV", path, path, "extra"), seps).admitted);
assert(!parseCheckinEvidence(framed("CI_START") + framed("CHANGESET", payload) + framed("STAGE", "late"), seps).admitted);
assert(!parseCheckinChangeset(payload.replace("9007199254740997", "1.5")));
const moved = ["MV", "100%", path, cwd + "\\new-" + name, "False", "9007199254740999", "NO_MERGES"].join(us);
const p = parseCheckinPending(header + moved + "\r\n", cwd); assert(p.admitted); assert.equal(p.items[0].sourceWorkspacePath, path); assert.equal(p.items[0].workspacePath, cwd + "\\new-" + name);
assert(!parseCheckinPending(header + moved.replace("100%", "99%"), cwd).admitted);
assert(!parseCheckinPending(header + moved + us + "extra", cwd).admitted);
assert(!parseCheckinPending(header + header, cwd).admitted);
// Comment policy is independent of platform; path/identity controls remain strict.
for (const newline of ["\n", "\r\n", "\r"]) {
    assert(checkinSafeComment(`Fixture${newline}Details 😀`));
    assert(!checkinSafeValue(`Fixture${newline}Details`));
    assert(!parseCheckinChangeset(payload.replace("Example Repository", `Example${newline}Repository`)));
}
for (let code = 0; code <= 0x9f; code++) {
    if (code > 0x1f && code < 0x7f || code === 10 || code === 13) continue;
    assert(!checkinSafeComment(`Fixture${String.fromCharCode(code)}Details`));
}
for (const comment of ["", "x".repeat(4097), "bad\ud800", "bad\udc00", "\ud800\n\udc00", "\ud800\r\n\udc00"]) assert(!checkinSafeComment(comment));
assert(checkinSafeComment("x".repeat(4096)));
await assert.rejects(captureCheckinCommand(Array(121).fill("x"), cwd), /argv/);
await assert.rejects(captureCheckinCommand(Array(10).fill("x".repeat(4096)), cwd), /argv/);
