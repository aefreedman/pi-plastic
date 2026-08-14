import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal, status } from "../src/plastic-core.ts";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  kill(): boolean { return true; }
  close(code: number): void { this.stdout.end(); this.stderr.end(); this.emit("close", code, null); }
}

type Call = { command: string; args: string[] };
const separator = "\x1f";
const machineOutput = [
  `CH${separator}changed.txt${separator}False${separator}41${separator}NO_MERGES`,
  `AD${separator}added.txt${separator}False${separator}42${separator}NO_MERGES`,
  `DE${separator}deleted.txt${separator}False${separator}43${separator}NO_MERGES`,
  `MV${separator}100%${separator}old name.txt${separator}new name.txt${separator}False${separator}44${separator}NO_MERGES`,
  `PR${separator}private.txt${separator}False${separator}0${separator}NO_MERGES`,
].join("\n");

function fakeCommands(calls: Call[]) {
  return ((command: string, args: string[]) => {
    const proc = new FakeChildProcess();
    calls.push({ command, args });
    queueMicrotask(() => {
      if (command === "cm" && args[0] === "status") proc.stdout.write(machineOutput);
      if (command === "cm" && args[0] === "version") proc.stdout.write("Plastic SCM version 11.0\n");
      proc.close(0);
    });
    return proc as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as typeof import("node:child_process").spawn;
}

const jsonPayload = (result: unknown): Record<string, unknown> => {
  const match = String(result).match(/```json\n([\s\S]*)\n```$/);
  assert(match, "Expected a fenced JSON result.");
  return JSON.parse(match[1]) as Record<string, unknown>;
};

const root = "/repo/workspace";
const calls: Call[] = [];
const defaultJson = await runWithAbortSignal(undefined, () => status.execute({ machineReadable: true, format: "json", workdir: root }), { spawn: fakeCommands(calls) });
const defaultData = jsonPayload(defaultJson).data as Record<string, unknown>;
const items = defaultData.items as Array<Record<string, unknown>>;
const summary = defaultData.summary as Record<string, unknown>;

assert.equal(defaultData.machineReadable, true, "Machine-readable JSON must identify its source format.");
assert.equal(items.length, 5, "Machine-readable JSON must parse changed, added, deleted, moved, and private records.");
assert.deepEqual(items.map((item) => item.kind), ["changed", "added", "deleted", "moved", "private"], "Parsed records must retain each pending-item kind.");
assert.deepEqual(items[3], {
  statusCode: "MV",
  kind: "moved",
  path: "new name.txt",
  isDirectory: false,
  revisionId: "44",
  sourcePath: "old name.txt",
}, "Moved records must expose destination path, source path, and revision metadata.");
assert.deepEqual(summary, {
  totalPending: 5,
  added: 1,
  changed: 1,
  moved: 1,
  deleted: 1,
  private: 1,
  other: 0,
  tracked: 4,
}, "Machine-readable JSON must provide an accurate compact pending summary without duplicating private paths.");
assert.deepEqual(defaultData.itemCount, { total: 5, returned: 5, omitted: 0 }, "Machine-readable JSON must identify the complete returned-item count.");
assert.equal("privatePaths" in summary, false, "Machine-readable JSON must not duplicate private paths already present in item records.");
assert.equal("rawOutput" in defaultData, false, "Raw machine output must be omitted from JSON unless explicitly requested.");

const statusCalls = calls.filter((call) => call.command === "cm" && call.args[0] === "status");
assert.equal(statusCalls.length, 1, "Status must invoke cm exactly once for the request.");
assert.deepEqual(statusCalls[0].args, ["status", "--includeRevId", "--machinereadable", `--fieldseparator=${separator}`], "Machine-readable status must request revision IDs and the package-owned explicit separator.");

const boundedJson = await runWithAbortSignal(undefined, () => status.execute({ machineReadable: true, maxItems: 2, format: "json", workdir: root }), { spawn: fakeCommands([]) });
const boundedData = jsonPayload(boundedJson).data as Record<string, unknown>;
assert.equal((boundedData.items as unknown[]).length, 2, "maxItems must bound parsed machine-readable JSON records.");
assert.deepEqual(boundedData.itemCount, { total: 5, returned: 2, omitted: 3 }, "Bounded machine-readable JSON must report omitted-item metadata.");
assert.equal((boundedData.summary as Record<string, unknown>).totalPending, 5, "Summary counts must describe all pending records, even when item records are bounded.");

const rawJson = await runWithAbortSignal(undefined, () => status.execute({ machineReadable: true, includeRaw: true, format: "json", workdir: root }), { spawn: fakeCommands([]) });
assert.equal((jsonPayload(rawJson).data as Record<string, unknown>).rawOutput, machineOutput, "includeRaw must expose unmodified and intentionally unbounded Plastic output for diagnostics.");

const textResult = await runWithAbortSignal(undefined, () => status.execute({ machineReadable: true, workdir: root }), { spawn: fakeCommands([]) });
assert.equal(textResult, machineOutput, "Machine-readable text output must preserve the raw Plastic output for backward compatibility.");

console.log("PASS: plastic machine-readable status test succeeded");
