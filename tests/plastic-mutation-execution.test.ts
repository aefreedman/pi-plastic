import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mergeToBranch, runWithAbortSignal, update } from "../src/plastic-core.ts";
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

const canceledCloseoutCalls: SpawnCall[] = [];
const canceledCloseoutOutput = await runWithAbortSignal(
  undefined,
  () => mergeToBranch.execute({ source: "/source", target: "/target", workdir, format: "json" }),
  {
    spawn: ((command: string, args: readonly string[], options: { cwd: string }) => {
      canceledCloseoutCalls.push({ command, args: [...args], cwd: options.cwd });
      const child = new EventEmitter() as any;
      const isPendingQuery = args.includes("--machinereadable");
      child.stdout = Readable.from([isPendingQuery ? "CH pending.txt False\n" : "Branch: /source\n"]);
      child.stderr = Readable.from([]);
      child.stdin = undefined;
      child.kill = () => true;
      process.nextTick(() => child.emit("close", 0));
      return child;
    }) as any,
  },
);
assert.match(String(canceledCloseoutOutput), /"strategy": "cancel-with-pending"/, "canceled closeout must return a typed canceled outcome");
assert.match(String(canceledCloseoutOutput), /"checkedIn": false/, "canceled closeout must report checkedIn=false");
assert.equal(canceledCloseoutCalls.filter((call) => ["switch", "update", "merge", "checkin", "shelveset"].includes(call.args[0] ?? "")).length, 0,
  "canceled closeout must not dispatch any mutation command");
assert.equal(canceledCloseoutCalls.filter((call) => call.args[0] === "status").length, 2,
  "canceled closeout should only inspect branch identity and pending state");

const failedLookupCalls: SpawnCall[] = [];
await assert.rejects(
  runWithAbortSignal(
    undefined,
    () => mergeToBranch.execute({ source: "/source", workdir }),
    {
      spawn: ((command: string, args: readonly string[], options: { cwd: string }) => {
        failedLookupCalls.push({ command, args: [...args], cwd: options.cwd });
        const child = new EventEmitter() as any;
        const failedLookup = args[0] === "find";
        child.stdout = Readable.from([failedLookup ? "" : "Branch: /source\n"]);
        child.stderr = Readable.from(failedLookup ? ["fixture parent lookup failure"] : []);
        child.stdin = undefined;
        child.kill = () => true;
        process.nextTick(() => child.emit("close", failedLookup ? 1 : 0));
        return child;
      }) as any,
    },
  ),
  /Plastic lookup failed: fixture parent lookup failure/,
  "failed parent lookup must remain diagnostic rather than silently becoming a missing parent",
);
assert.equal(failedLookupCalls.filter((call) => ["switch", "update", "merge", "checkin", "shelveset"].includes(call.args[0] ?? "")).length, 0,
  "failed parent lookup must not dispatch a closeout mutation");

console.log("PASS: Plastic direct mutation execution tests passed");
