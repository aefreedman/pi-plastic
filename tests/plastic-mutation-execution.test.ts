import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { runWithAbortSignal, update } from "../src/plastic-core.ts";
import { loadRegisteredTools } from "./pi-tool-harness.ts";

const registeredTools = await loadRegisteredTools();
for (const [name, registeredTool] of registeredTools) {
  if (!name.startsWith("plastic_") || name === "plastic_tool_search") continue;
  assert.equal(
    (registeredTool.parameters as any)?.properties?.authorizationToken,
    undefined,
    `${name} must not expose mutation authorization tokens`,
  );
}

type SpawnCall = {
  command: string;
  args: string[];
  cwd: string;
};

function makeSpawn(calls: SpawnCall[], exitCode: number, stderr = "") {
  return ((command: string, args: readonly string[], options: { cwd: string }) => {
    calls.push({ command, args: [...args], cwd: options.cwd });
    const child = new EventEmitter() as any;
    child.stdout = Readable.from(exitCode === 0 ? ["Updated successfully"] : []);
    child.stderr = Readable.from(stderr ? [stderr] : []);
    child.stdin = undefined;
    child.kill = () => true;
    process.nextTick(() => child.emit("close", exitCode));
    return child;
  }) as any;
}

const workdir = process.cwd();
const successfulCalls: SpawnCall[] = [];
const output = await runWithAbortSignal(
  undefined,
  () => update.execute({ workdir }),
  { spawn: makeSpawn(successfulCalls, 0) },
);
assert.equal(output, "Updated successfully");
assert.deepEqual(successfulCalls, [{
  command: process.env.PI_PLASTIC_CM_EXECUTABLE?.trim() || "cm",
  args: ["update", "--dontmerge", "--noinput"],
  cwd: workdir,
}], "a directly invoked mutation tool must make one exact cm spawn without approval context");

const failedCalls: SpawnCall[] = [];
await assert.rejects(
  runWithAbortSignal(
    undefined,
    () => update.execute({ workdir }),
    { spawn: makeSpawn(failedCalls, 1, "fixture mutation failure") },
  ),
  /fixture mutation failure/,
);
assert.equal(failedCalls.length, 1, "a failed mutation process must not be retried implicitly");

console.log("PASS: Plastic direct mutation execution tests passed");
