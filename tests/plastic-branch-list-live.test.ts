// Explicit read-only LOCAL SOURCE acceptance. Expectations contain only caller-owned
// retained synthetic identities; private workspace coordinates remain outside package fixtures.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn as nativeSpawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { getCmExecutable } from "../src/execution/process";
import { branchListOutputSchema } from "../src/pi/branch-list-output";

const expectationPath = process.env.PI_PLASTIC_BRANCH_LIST_LIVE_EXPECTATIONS;
if (!expectationPath) throw Error("Explicit owned-sandbox expectations are required.");
const expected = JSON.parse(await readFile(expectationPath, "utf8")) as { workdir: string; subdirectory: string; parent: string; branches: string[]; asc: string[]; desc: string[]; dateDesc: string[] };
const registered = (await loadRegisteredTools()).get("plastic_branchList")!;
const status = () => {
    const result = spawnSync(getCmExecutable(), ["status", "--xml", "--encoding=utf-8", "--fullpaths"], { cwd: expected.workdir, encoding: null, timeout: 30000 });
    assert.equal(result.status, 0); assert.equal(result.stderr.length, 0); return result.stdout;
};
const before = status();
let probes = 0;
async function invoke(cwd: string, args: Record<string, unknown> = {}, expectedCalls = 1) {
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let calls = 0;
    const spawn = ((command: string, argv: string[], options: Parameters<typeof nativeSpawn>[2]) => {
        calls++; assert.equal(argv[0], "find"); assert.equal(argv[1], "branch"); assert(argv.includes("--format={name}")); assert(argv.includes("--encoding=utf-8"));
        const child = nativeSpawn(command, argv, options);
        child.stdout!.on("data", chunk => stdout.push(Buffer.from(chunk))); child.stderr!.on("data", chunk => stderr.push(Buffer.from(chunk))); return child;
    }) as typeof nativeSpawn;
    const result = await runWithAbortSignal(undefined, () => registered.execute("owned-live", { source: "names", parent: "br:" + expected.parent, ...args }, undefined, undefined, { cwd }), { spawn });
    assert.equal(calls, expectedCalls); assert(Check(branchListOutputSchema, result.structuredContent)); probes++;
    const raw = Buffer.concat(stdout), errors = Buffer.concat(stderr);
    if (!result.isError) {
        assert.equal(errors.length, 0); const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw); assert.deepEqual(Buffer.from(decoded), raw);
        for (const row of result.structuredContent.data.rows) assert(raw.includes(Buffer.from(row.branch, "utf8")));
    }
    return { result, raw, errors };
}
for (const cwd of [expected.workdir, expected.subdirectory]) {
    const { result, raw } = await invoke(cwd);
    const rows = result.structuredContent.data.rows.map((row: { branch: string }) => row.branch);
    assert.deepEqual([...rows].sort(), [...expected.branches].sort());
    for (const original of expected.branches) assert(raw.includes(Buffer.from(original, "utf8")));
    assert.equal(result.structuredContent.completeness.read, "complete"); assert.equal(result.structuredContent.data.scope, "workspace_repository");
    assert.deepEqual(result.structuredContent.data.counts, { observed: expected.branches.length, returned: expected.branches.length, omitted: 0, excluded: 0 });
    console.log(JSON.stringify({ localSourceRegisteredAdapter: true, subdirectory: cwd === expected.subdirectory, exactUnicodeIdentityEquality: true, snapshots: 1, rows: rows.length, stdoutBytes: raw.length, stdoutSha256: createHash("sha256").update(raw).digest("hex"), stderrBytes: 0 }));
}
for (const [args, rows] of [
    [{ parent: expected.parent }, expected.branches],
    [{ owner: "me" }, expected.branches],
    [{ nameLike: "space%" }, [expected.parent + "/space name"]],
    [{ nameLike: "synthetic-absent" }, []],
    [{ orderBy: "branchname" }, expected.asc],
    [{ orderBy: "branchname", descending: true }, expected.desc],
    [{ orderBy: "branchname", limit: 2 }, expected.asc.slice(0, 2)],
    [{ orderBy: "date", descending: true, limit: 2 }, expected.dateDesc],
] as const) {
    const { result } = await invoke(expected.workdir, args);
    assert.equal(result.isError, false);
    const actual = result.structuredContent.data.rows.map((row: { branch: string }) => row.branch);
    if ("orderBy" in args) assert.deepEqual(actual, rows); else assert.deepEqual([...actual].sort(), [...rows].sort());
}
const projected = await invoke(expected.workdir, { orderBy: "branchname", limit: 2, maxItems: 1, format: "json" });
assert.deepEqual(projected.result.structuredContent.data.counts, { observed: 2, returned: 1, omitted: 1, excluded: 0 });
assert.equal(projected.result.structuredContent.data.rows[0].branch, expected.asc[0]);
const hidden = await invoke(expected.workdir, { includeHidden: true }, 0); assert.equal(hidden.result.structuredContent.error.code, "unsupported_query");
const owner = await invoke(expected.workdir, { owner: "synthetic-no-such-owner" }); assert.equal(owner.result.structuredContent.error.code, "command_failed"); assert(owner.errors.length > 0);
assert.deepEqual(status(), before);
console.log(JSON.stringify({ probes, baselineWorkspaceStatusByteIdentical: true, branchAndChangesetUnchanged: true, mutations: 0, retainedFixtureCount: expected.branches.length + 1 }));
