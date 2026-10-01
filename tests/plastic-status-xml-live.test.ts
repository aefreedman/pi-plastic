// Opt-in LOCAL SOURCE adapter proof. The caller owns synthetic controlled sandbox preparation/cleanup.
// Expectations/captures stay outside the package; no real local paths are fixtures here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn as nativeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { statusOutputSchema } from "../src/pi/status-output";

const expectationPath = process.env.PI_PLASTIC_XML_LIVE_EXPECTATIONS;
if (!expectationPath) throw Error("Explicit owned-sandbox expectations are required.");
const expected = JSON.parse(await readFile(expectationPath, "utf8")) as { workdir: string; subdirectory: string; items: Array<{ statusCode: string; kind: string; path: string; sourcePath?: string; isDirectory: boolean }> };
const status = (await loadRegisteredTools()).get("plastic_status")!;
for (const cwd of [expected.workdir, expected.subdirectory]) {
    let calls = 0;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const spawn = ((command: string, args: string[], options: Parameters<typeof nativeSpawn>[2]) => {
        calls++;
        assert.deepEqual(args, ["status", "--xml", "--encoding=utf-8", "--fullpaths"]);
        const child = nativeSpawn(command, args, options);
        child.stdout!.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr!.on("data", chunk => stderr.push(Buffer.from(chunk)));
        return child;
    }) as typeof nativeSpawn;
    const result = await runWithAbortSignal(undefined, () => status.execute("owned-live", { source: "xml", format: "json", maxItems: 500 }, undefined, undefined, { cwd }), { spawn });
    assert.equal(calls, 1); assert.equal(result.isError, false); assert(Check(statusOutputSchema, result.structuredContent));
    const dto = result.structuredContent;
    assert.equal(dto.schemaVersion, 2); assert.equal(dto.data.source.scope, "workspace"); assert.equal(dto.data.source.baseRevisionAvailability, "unavailable");
    assert.equal(dto.completeness.read, "complete"); assert.equal(dto.completeness.projection, true);
    const rows = dto.data.items;
    assert.deepEqual([...rows].sort((a, b) => a.path.localeCompare(b.path)), [...expected.items].sort((a, b) => a.path.localeCompare(b.path)));
    const raw = Buffer.concat(stdout); assert.equal(Buffer.concat(stderr).length, 0);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw); assert.deepEqual(Buffer.from(decoded), raw);
    for (const row of expected.items) {
        assert(raw.includes(Buffer.from(row.path, "utf8")));
        if (row.sourcePath) assert(raw.includes(Buffer.from(row.sourcePath, "utf8")));
    }
    assert.equal(dto.data.itemCount.parsed, expected.items.length);
    assert.equal(JSON.parse(result.details.rawResult).data.items.length, expected.items.length);
    console.log(JSON.stringify({ localSourceRegisteredAdapter: true, subdirectory: cwd === expected.subdirectory, records: rows.length, exactUnicodeIdentityEquality: true, snapshots: calls, stdoutBytes: raw.length, stdoutSha256: createHash("sha256").update(raw).digest("hex"), stderrBytes: 0 }));
}
