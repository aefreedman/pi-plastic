import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { serverMergeCapabilityTokens } from "../src/operations/server-merge";
import { validateServerMergeOutput } from "../src/pi/server-merge-output";
import { inspectResolutionFile, RESOLUTIONS_MAX_BYTES } from "../src/domain/server-merge-resolutions";

const tool = (await loadRegisteredTools()).get("plastic_mergeBranches")!;
const identity = { source: "br:/main/source@repo@server", target: "br:/main@repo@server" };
const root = await mkdtemp(join(tmpdir(), "pi-server-resolutions-"));
const jsonPath = join(root, "resolutions 日本 😀.json"), resultPath = join(root, "merged 日本 😀.bin");
const payload = { resolutions: [{ path: "/src/Player 日本.cs", resultFile: resultPath }, { path: "/art/logo.png", keep: "source" }, { path: "/README.md", keep: "destination" }] };
const original = Buffer.from([0, 255, 10, 13, 128]);
async function invoke(input: Record<string, unknown>, options: { help?: string; records?: Array<[string, string[]]>; exitCode?: number; stderr?: string; afterHelp?: () => Promise<void> } = {}) {
    const calls: string[][] = [];
    const result = await runWithAbortSignal(undefined, () => tool.execute("test", input, undefined, undefined, { cwd: "/unrelated" }), {
        spawn: ((_: string, argv: string[]) => {
            calls.push([...argv]);
            const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return true; } });
            queueMicrotask(() => { void (async () => {
                child.emit("spawn");
                if (argv[0] === "help") {
                    if (options.afterHelp) await options.afterHelp();
                    child.stdout.end(options.help ?? [...serverMergeCapabilityTokens, "--fileconflictsresolutionsfile", "--keepsource", "--keepdestination"].join(" "));
                    child.stderr.end(); child.emit("close", 0, null); return;
                }
                const sep = (name: string) => argv.find(a => a.startsWith(name + "="))!.slice(name.length + 1);
                const records = options.records ?? [["CHANGESET", ["cs:42@/main@repo@server (mount:'/')"]]];
                child.stdout.end(records.map(([op, fields]) => sep("--startlineseparator") + [op, ...fields].join(sep("--fieldseparator")) + sep("--endlineseparator")).join("\n"));
                child.stderr.end(options.stderr ?? ""); child.emit("close", options.exitCode ?? 0, null);
            })(); });
            return child;
        }) as any,
    });
    const dto = result.structuredContent as any;
    assert(validateServerMergeOutput(dto), JSON.stringify(dto));
    assert.equal(result.isError, !dto.ok);
    return { dto, calls, result };
}
try {
    await writeFile(resultPath, original);
    await writeFile(jsonPath, JSON.stringify(payload));
    const apply = { ...identity, message: "Resolve reviewed conflicts", fileConflictsResolutionsFile: jsonPath };
    let r = await invoke(apply);
    assert.equal(r.dto.outcome, "completed"); assert.equal(r.calls.length, 2);
    assert(r.calls[1].includes(`--fileconflictsresolutionsfile=${jsonPath}`));
    assert(r.calls[1].includes("--nointeractiveresolution"));
    assert(!r.calls[1].some(a => /--keep(source|destination)/.test(a)));
    assert.equal(r.dto.data.resolutionsFile.entries, 3); assert.equal(r.dto.data.resolutionsFile.resultFiles, 1);
    assert.equal(r.dto.data.resolutionsFile.keepSource, 1); assert.equal(r.dto.data.resolutionsFile.keepDestination, 1);
    assert.match(r.dto.data.resolutionsFile.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readFile(resultPath), original); assert.equal(await readFile(jsonPath, "utf8"), JSON.stringify(payload));
    for (const policy of ["source", "destination"]) {
        r = await invoke({ ...apply, unlistedConflictPolicy: policy });
        assert(r.calls[1].includes(policy === "source" ? "--keepsource" : "--keepdestination"));
    }
    r = await invoke({ ...apply, preflight: true }); assert.equal(r.calls.length, 0); assert.equal(r.dto.outcome, "preflight");
    r = await invoke(apply, { help: serverMergeCapabilityTokens.join(" ") }); assert.equal(r.dto.outcome, "unsupported"); assert.equal(r.calls.length, 1);
    assert.deepEqual(r.dto.data.capability.missingTokens, ["--fileconflictsresolutionsfile"]);
    // New installed merge help is ~19 KiB: retain a bounded expanded help gate.
    const advertised = [...serverMergeCapabilityTokens, "--fileconflictsresolutionsfile"].join(" ");
    r = await invoke(apply, { help: advertised + " ".repeat(19000) }); assert.equal(r.dto.outcome, "completed");
    r = await invoke(apply, { help: advertised + " ".repeat(32769) }); assert.equal(r.dto.error.code, "capability_unavailable"); assert.equal(r.calls.length, 1);
    // Old behavior needs only the old capabilities.
    r = await invoke({ ...identity, message: "No resolutions" }, { help: serverMergeCapabilityTokens.join(" ") }); assert.equal(r.dto.outcome, "completed");
    const analyze = { ...identity, mode: "analyze" };
    for (const records of [
        [["FILE_CONFLICT", ["/src/Player 日本.cs", "13", "15", "16", "533"]]],
        [["FILE_SRC", ["/only-source.cs", "13", "15", "533"]]],
        [["STATUS", ["ALREADY_CONNECTED", "No merges detected"]]],
    ] as Array<Array<[string, string[]]>>) {
        r = await invoke(analyze, { records }); assert.equal(r.dto.outcome, "analyzed"); assert.equal(r.dto.data.effect, "not-attempted");
        assert.equal(r.dto.data.remoteAnalysis, "performed"); assert(!r.calls[1].includes("--merge")); assert(!r.calls[1].some(a => a.startsWith("-c=")));
        assert.equal(r.dto.data.conflictPaths.length, records[0][0] === "FILE_CONFLICT" ? 1 : 0);
        const forged = structuredClone(r.dto); forged.data.command.push("--merge"); assert(!validateServerMergeOutput(forged));
    }
    r = await invoke({ ...analyze, preflight: true }); assert.equal(r.calls.length, 0); assert.equal(r.dto.data.remoteAnalysis, "not-performed");
    for (const extra of [{ message: "bad" }, { fileConflictsResolutionsFile: jsonPath }, { unlistedConflictPolicy: "destination" }]) {
        r = await invoke({ ...analyze, ...extra }); assert.equal(r.dto.error.code, "invalid_request"); assert.equal(r.calls.length, 0);
    }
    for (const options of [{ records: [] }, { exitCode: 1, records: [["FILE_CONFLICT", ["/file", "1", "2", "3", "4"]]] }, { records: [["DIRECTORY_CONFLICT", ["/folder"]]] }, { stderr: "warning" }, {}] as Parameters<typeof invoke>[1][]) {
        r = await invoke(analyze, options); assert.equal(r.dto.outcome, "uncertain"); assert.equal(r.calls.length, 2);
    }
    for (const input of [{ ...identity }, { ...apply, mode: "other" }, { ...apply, unlistedConflictPolicy: "auto" }, { ...apply, fileConflictsResolutionsFile: "relative.json" }]) {
        r = await invoke(input); assert.equal(r.calls.length, 0); assert.equal(r.dto.error.code, "invalid_request");
    }
    await mkdir(join(root, "directory"));
    const invalid = [
        null, {}, { resolutions: {}, extra: true }, { resolutions: [], extra: true },
        { resolutions: [{ path: "relative", keep: "source" }] },
        { resolutions: [{ path: "/file", keep: "source", resultFile: resultPath }] },
        { resolutions: [{ path: "/file" }] }, { resolutions: [{ path: "/file", keep: "auto" }] },
        { resolutions: [{ path: "/file", keep: "source", extra: true }] },
        { resolutions: [{ path: "/file", resultFile: "relative" }] },
        { resolutions: [{ path: "/file", resultFile: join(root, "missing") }] },
        { resolutions: [{ path: "/file", resultFile: join(root, "directory") }] },
        { resolutions: [{ path: "/file", keep: "source" }, { path: "/file", keep: "destination" }] },
        { resolutions: [{ path: "/bad\u0000", keep: "source" }] },
        { resolutions: Array.from({ length: 501 }, (_, i) => ({ path: "/" + i, keep: "source" })) },
    ];
    for (const value of invalid) {
        await writeFile(jsonPath, JSON.stringify(value)); r = await invoke(apply);
        assert.equal(r.calls.length, 0); assert.equal(r.dto.error.code, "invalid_request");
    }
    for (const bytes of [Buffer.from([255]), Buffer.from("{"), Buffer.alloc(RESOLUTIONS_MAX_BYTES + 1, 32)]) {
        await writeFile(jsonPath, bytes); r = await invoke(apply); assert.equal(r.calls.length, 0); assert.equal(r.dto.error.code, "invalid_request");
    }
    await writeFile(jsonPath, JSON.stringify(payload));
    r = await invoke(apply, { afterHelp: () => writeFile(jsonPath, JSON.stringify({ resolutions: [] })) });
    assert.equal(r.dto.error.code, "invalid_request"); assert.equal(r.calls.length, 1);
    await writeFile(jsonPath, JSON.stringify(payload));
    await assert.rejects(inspectResolutionFile(join(root, "directory")));
    // Writable-xlink paths are kept exactly; no root-repository contributor guesses.
    await writeFile(jsonPath, JSON.stringify({ resolutions: [{ path: "/Linked Repo/file.cs", keep: "destination" }] }));
    r = await invoke(apply); assert.equal(r.dto.outcome, "completed"); assert.equal(r.dto.data.xlinkEffects, "unverified");
    assert.deepEqual(await readFile(resultPath), original);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS: read-only conflict analysis, guarded JSON submission, explicit fallback policies, capability gating, input preservation and no retries");
