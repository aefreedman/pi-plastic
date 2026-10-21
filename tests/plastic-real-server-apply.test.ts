import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm, mkdir, symlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { runWithAbortSignal } from "../src/execution/context";
import { parseServerMergeOutput } from "../src/domain/merge-output";
import { serverMergeCapabilityTokens, mergeBranches } from "../src/operations/server-merge";
import { executeServerMergeOutput, validateServerMergeOutput } from "../src/pi/server-merge-output";
import { loadRegisteredTools } from "./pi-tool-harness";
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/plastic-real-server-apply.json", import.meta.url), "utf8"));
const native = fixtures.find((f: any) => f.label === "073-server-apply");
const seps = { start: "__EV_S__", end: "__EV_E__", field: "__EV_F__" };
const parsed = parseServerMergeOutput(native.stdout, seps);
assert.equal(native.provenance.client, "11.0.16.10484");
assert.equal(native.exit, 0); assert.equal(native.stderr, "");
assert.equal(parsed.records.length, 6); assert.equal(parsed.hasConflict, true);
assert.deepEqual(parsed.unknownOperations, []); assert.equal(parsed.malformed, false);
const analysisNative = fixtures.find((f: any) => f.label === "071-server-analyze");
const analysisParsed = parseServerMergeOutput(analysisNative.stdout, seps, "analyze");
assert.equal(analysisNative.exit, 0); assert.equal(analysisNative.stderr, "");
assert.equal(analysisParsed.malformed, false); assert.deepEqual(analysisParsed.unknownOperations, []);
assert.equal(analysisParsed.hasConflict, true); assert.deepEqual(analysisParsed.changesets, []);
for (const text of [analysisNative.stdout.replace("APPLY__EV_F__RM", "APPLY__EV_F__UNKNOWN"), analysisNative.stdout.replace("/fixtures/evidence/new/Widget2.cs", "relative")]) {
    const bad = parseServerMergeOutput(text, seps, "analyze"); assert(bad.malformed || bad.unknownOperations.length > 0);
}
// Hosted TMPDIR may traverse macOS /var aliases or Windows short names.
// Positive inputs must satisfy the production canonical-path guard; keep the
// explicit alias negative below to prove the guard itself is not relaxed.
const root = await realpath(await mkdtemp(join(tmpdir(), "pi-server-real-")));
const json = join(root, "resolution.json"), result = join(root, "result.txt");
const path = "/fixtures/evidence/changed1.txt";
const mapping = () => ({ resolutions: [{ path, resultFile: result }] });
const input = { source: "br:/main/evidence/server-source@Example Repository@example@unity", target: "br:/main/evidence/server-target@Example Repository@example@unity", message: "Reviewed\r\nserver result", fileConflictsResolutionsFile: json };
const registered = (await loadRegisteredTools()).get("plastic_mergeBranches")!;
type Options = { output?: string; code?: number; stderr?: string; afterHelp?: () => Promise<void>; afterMerge?: () => Promise<void>; api?: "registered" | "core" };
async function invoke(options: Options = {}, args: any = input) {
    const calls: string[][] = [];
    const value = await runWithAbortSignal(undefined, () => options.api === "core" ? mergeBranches.execute({ ...args, format: "json" }) : options.api === "registered" ? registered.execute("fixture", args, undefined, undefined, { cwd: "/unused" }) : executeServerMergeOutput(args), {
        spawn: ((_: string, argv: string[]) => {
            calls.push([...argv]);
            const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return true; } });
            queueMicrotask(() => { void (async () => {
                c.emit("spawn");
                if (argv[0] === "help") {
                    await options.afterHelp?.(); c.stdout.end([...serverMergeCapabilityTokens, "--fileconflictsresolutionsfile", "--keepsource"].join(" ")); c.stderr.end(); c.emit("close", 0, null); return;
                }
                let out = options.output ?? native.stdout;
                for (const [key, flag] of [["start", "--startlineseparator"], ["end", "--endlineseparator"], ["field", "--fieldseparator"]] as const) out = out.split(seps[key]).join(argv.find(a => a.startsWith(flag + "="))!.slice(flag.length + 1));
                await options.afterMerge?.(); c.stdout.end(out); c.stderr.end(options.stderr ?? ""); c.emit("close", options.code ?? 0, null);
            })(); }); return c;
        }) as any,
    });
    assert(calls.filter(c => c[0] === "merge").length <= 1);
    if (typeof value === "string") return { text: value, calls };
    const dto = value.structuredContent as any;
    assert(validateServerMergeOutput(dto), JSON.stringify(dto));
    return { dto, text: value.content[0].text, calls };
}
const frame = (fields: string[]) => seps.start + fields.join(seps.field) + seps.end + "\r\n";
for (const count of [500, 501]) {
    const output = Array.from({ length: count }, (_, i) => frame(["FILE_SRC", "/" + i, "1", "2", "3"])).join("");
    assert.equal(parseServerMergeOutput(output, seps).malformed, count === 501);
}
assert.equal(parseServerMergeOutput(native.stdout, { ...seps, start: "" }).malformed, true);
try {
    await writeFile(result, "reviewed synthetic result\n"); await writeFile(json, JSON.stringify(mapping()));
    let r = await invoke(); assert.equal(r.dto.outcome, "completed", JSON.stringify(r.dto)); assert.equal(r.dto.data.parse.resolvedConflictsVerified, 1); assert.equal(r.dto.data.createdChangeset.id, "61"); assert(r.calls[1].includes("-c=Reviewed\r\nserver result"));
    const actualAnalysis = await invoke({ output: analysisNative.stdout }, { source: input.source, target: input.target, mode: "analyze" }); assert.equal(actualAnalysis.dto.outcome, "analyzed"); assert.equal(actualAnalysis.dto.data.parse.conflictsObserved, 1);
    for (const api of ["registered", "core"] as const) for (const format of ["text", "json"]) { const v = await invoke({ api }, { ...input, format }); assert.match(v.text, /61/); }
    for (const mutate of [
        (d: any) => d.data.parse.resolvedConflictsVerified = 0,
        (d: any) => d.data.resolutionsFile = null,
        (d: any) => d.data.resolutionsFile.resultFiles = 0,
        (d: any) => d.data.createdChangeset.server = "foreign",
        (d: any) => d.data.capture.merge.stderrBytes = 1,
        (d: any) => d.data.parse.unknownOperations = 1,
        (d: any) => d.data.command = [],
        (d: any) => d.data.command[2] = "br:/foreign@repo@server",
        (d: any) => d.data.capability.state = "not-checked",
        (d: any) => d.data.parse.unknownOperationClasses = ["raw-private-op"],
        (d: any) => d.data.conflictPaths[0] = "/a/../b",
        (d: any) => d.data.observedChangesets = [],
    ]) { const forged = structuredClone(r.dto); mutate(forged); assert(!validateServerMergeOutput(forged)); }
    const last = native.stdout.lastIndexOf(seps.start);
    const noTerminal = native.stdout.slice(0, last);
    for (const output of [
        noTerminal, native.stdout + frame(["OTHER_PRIVATE_PATH", "/private"]),
        native.stdout.replace("APPLY__EV_F__ADD", "APPLY__EV_F__EVIL_PRIVATE"),
        native.stdout + frame(["DIS_OP_WARN", "CHG", "/warning"]),
        native.stdout + native.stdout.slice(last), native.stdout.replace("cs:61@/main/evidence/server-target", "cs:61@/foreign"),
        native.stdout.replace("@example@unity (mount", "@foreign@unity (mount"),
        native.stdout.replace("mount:'/'", "mount:'/linked'"), native.stdout.slice(0, -15),
        native.stdout.replace("/fixtures/evidence/replace1.txt", "/fixtures/../escape"),
        native.stdout + frame(["APPLY", "ADD", "/after-terminal"]),
        native.stdout.slice(last) + noTerminal,
        noTerminal + frame(["FILE_CONFLICT", path, "56", "59", "60", "988"]) + native.stdout.slice(last),
        native.stdout.replace("@Example Repository@", "@Foreign Repository@"),
        native.stdout.replace("APPLY__EV_F__RM__EV_F__", "APPLY__EV_F__RM__EV_F__extra__EV_F__"),
        native.stdout.replace("FILE_SRC__EV_F__/fixtures/evidence/replace1.txt", "FILE_SRC__EV_F__/FIXTURES/EVIDENCE/CHANGED1.TXT"),
        "foreign text" + native.stdout, "\t" + native.stdout, "x".repeat(65537),
    ]) { r = await invoke({ output }); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.dto.data.createdChangeset, null); assert.doesNotMatch(JSON.stringify(r.dto.data.parse), /PRIVATE|private|\/fixtures/); }
    r = await invoke({ output: noTerminal + frame(["UNKNOWN_PRIVATE_IDENTITY", "/private/output"]) + native.stdout.slice(last) });
    assert.equal(r.dto.outcome, "uncertain"); assert.deepEqual(r.dto.data.parse.unknownOperationClasses, ["unsupported-operation"]);
    assert.match(r.text, /Unsupported operation classes: unsupported-operation/); assert.doesNotMatch(r.text, /UNKNOWN_PRIVATE_IDENTITY|private\/output/);
    for (const options of [{ stderr: "warning" }, { code: 1 }]) { r = await invoke(options); assert.equal(r.dto.outcome, "uncertain"); }
    r = await invoke({ output: noTerminal, code: 1 }); assert.equal(r.dto.outcome, "conflict");
    r = await invoke({}, { ...input, fileConflictsResolutionsFile: undefined }); assert.equal(r.dto.outcome, "uncertain");
    r = await invoke({}, { ...input, unlistedConflictPolicy: "source" }); assert.equal(r.dto.outcome, "uncertain");
    for (const resolutions of [[], [{ path: "/other", resultFile: result }], [{ path, keep: "source" }], [{ path, resultFile: result }, { path: "/extra", resultFile: result }]]) {
        await writeFile(json, JSON.stringify({ resolutions })); r = await invoke(); assert.equal(r.dto.outcome, "uncertain");
    }
    for (const resolutions of [[{ path, resultFile: result }, { path: path.toUpperCase(), resultFile: result }], [{ path: "/a/../b", resultFile: result }]]) {
        await writeFile(json, JSON.stringify({ resolutions })); r = await invoke(); assert.equal(r.dto.outcome, "failed"); assert.equal(r.calls.length, 0);
    }
    await writeFile(json, JSON.stringify(mapping()));
    r = await invoke({ afterHelp: () => writeFile(result, "changed") }); assert.equal(r.dto.outcome, "failed"); assert.equal(r.calls.length, 1);
    await writeFile(result, "reviewed synthetic result\n");
    for (const change of [() => writeFile(result, "changed"), () => writeFile(json, JSON.stringify({ resolutions: [] }))]) {
        await writeFile(json, JSON.stringify(mapping())); await writeFile(result, "reviewed synthetic result\n");
        r = await invoke({ afterMerge: change }); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.dto.data.observedChangesets[0].id, "61");
    }
    await writeFile(json, JSON.stringify(mapping())); await writeFile(result, Buffer.alloc(4 * 1024 * 1024 + 1));
    r = await invoke(); assert.equal(r.dto.outcome, "failed"); assert.equal(r.calls.length, 0);
    for (const message of ["bad\tcomment", "bad\u0000", "bad\uD800"]) { r = await invoke({}, { ...input, message }); assert.equal(r.dto.error.code, "invalid_request"); }
    await writeFile(result, "small reviewed result"); await writeFile(json, JSON.stringify(mapping()));
    await mkdir(join(root, "regular")); await writeFile(join(root, "regular", "result.txt"), "reviewed");
    await symlink(join(root, "regular"), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(json, JSON.stringify({ resolutions: [{ path, resultFile: join(root, "alias", "result.txt") }] }));
    r = await invoke(); assert.equal(r.dto.outcome, "failed"); assert.equal(r.calls.length, 0);
    await mkdir(join(root, "directory")); await writeFile(json, JSON.stringify({ resolutions: [{ path, resultFile: join(root, "directory") }] }));
    r = await invoke(); assert.equal(r.dto.outcome, "failed");
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS: exact native server apply, reviewed result snapshots, candidate/terminal separation, bounded unknown classes, strict completion and no replay");
