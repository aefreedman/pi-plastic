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

async function runCanceledCloseoutFixture(pendingOutput: string): Promise<SpawnCall[]> {
  const calls: SpawnCall[] = [];
  await runWithAbortSignal(undefined, () => mergeToBranch.execute({ source: "/source", target: "/target", workdir }), {
    spawn: ((command: string, args: readonly string[], options: { cwd: string }) => {
      calls.push({ command, args: [...args], cwd: options.cwd });
      const child = new EventEmitter() as any;
      child.stdout = Readable.from([args.includes("--machinereadable") ? pendingOutput : "Branch: /source\n"]);
      child.stderr = Readable.from([]);
      child.stdin = undefined;
      child.kill = () => true;
      process.nextTick(() => child.emit("close", 0));
      return child;
    }) as any,
  });
  return calls;
}
for (const pendingOutput of ["PR private.txt False\n", "CH tracked.txt False\nPR private.txt False\n"]) {
  const calls = await runCanceledCloseoutFixture(pendingOutput);
  assert.equal(calls.filter((call) => ["switch", "update", "merge", "checkin", "shelveset"].includes(call.args[0] ?? "")).length, 0,
    "explicit cancellation must stop closeout for private-only and mixed pending changes");
}

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

for (const scenario of ["failed-switch", "wrong-target"] as const) {
  const calls: SpawnCall[] = [];
  await assert.rejects(
    runWithAbortSignal(undefined, () => mergeToBranch.execute({ source: "/source", target: "/target", workdir }), {
      spawn: ((command: string, args: readonly string[], options: { cwd: string }) => {
        calls.push({ command, args: [...args], cwd: options.cwd });
        const child = new EventEmitter() as any;
        const isSwitch = args[0] === "switch";
        const fails = scenario === "failed-switch" && isSwitch;
        child.stdout = Readable.from([args.includes("--machinereadable") ? "" : "Branch: /source\n"]);
        child.stderr = Readable.from(fails ? ["fixture switch failure"] : []);
        child.stdin = undefined;
        child.kill = () => true;
        process.nextTick(() => child.emit("close", fails ? 1 : 0));
        return child;
      }) as any,
    }),
    scenario === "failed-switch" ? /fixture switch failure/ : /branch mismatch after cm switch/,
  );
  assert.equal(calls.filter((call) => call.args[0] === "update").length, 0, `${scenario} must stop before target update`);
  assert.equal(calls.filter((call) => ["merge", "checkin"].includes(call.args[0] ?? "")).length, 0, `${scenario} must stop before merge/checkin`);
}

const resolvedLookupCalls: SpawnCall[] = [];
const resolvedLookupPreflight = await runWithAbortSignal(
  undefined,
  () => mergeToBranch.execute({ source: "br:/source@repo@server", preflight: true, workdir }),
  {
    spawn: ((command: string, args: readonly string[], options: { cwd: string }) => {
      resolvedLookupCalls.push({ command, args: [...args], cwd: options.cwd });
      const child = new EventEmitter() as any;
      const isFind = args[0] === "find";
      const isPendingQuery = args.includes("--machinereadable");
      child.stdout = Readable.from([isFind ? "/source|/parent\n" : isPendingQuery ? "" : "Branch: /source\n"]);
      child.stderr = Readable.from([]);
      child.stdin = undefined;
      child.kill = () => true;
      process.nextTick(() => child.emit("close", 0));
      return child;
    }) as any,
  },
);
assert.match(String(resolvedLookupPreflight), /Target branch: \/parent@repo@server/, "verified name|parent rows should preserve qualified parent identity");
assert.deepEqual(resolvedLookupCalls.find((call) => call.args[0] === "find")?.args.slice(-2), ["--format={name}|{parent}", "--nototal"],
  "parent lookup must request both branch identity and parent");
assert.match(resolvedLookupCalls.find((call) => call.args[0] === "find")?.args[2] ?? "", /where name = '\/source' on repository 'repo@server'/,
  "qualified selectors must query the local branch name in documented repository scope");

async function runParentLookupFixture(source: string, findOutput: string, target?: string): Promise<{ result?: unknown; error?: unknown; calls: SpawnCall[] }> {
  const calls: SpawnCall[] = [];
  try {
    const result = await runWithAbortSignal(undefined, () => mergeToBranch.execute({ source, ...(target ? { target } : {}), preflight: true, workdir }), {
      spawn: ((command: string, args: readonly string[], options: { cwd: string }) => {
        calls.push({ command, args: [...args], cwd: options.cwd });
        const child = new EventEmitter() as any;
        child.stdout = Readable.from([args[0] === "find" ? findOutput : args.includes("--machinereadable") ? "" : "Branch: /current\n"]);
        child.stderr = Readable.from([]);
        child.stdin = undefined;
        child.kill = () => true;
        process.nextTick(() => child.emit("close", 0));
        return child;
      }) as any,
    });
    return { result, calls };
  } catch (error) {
    return { error, calls };
  }
}

const rootLookup = await runParentLookupFixture("/main", "/main|\n");
assert.match(String(rootLookup.error), /\/main is a root branch with no parent/, "a matched root row must not be reported as not found");
const missingLookup = await runParentLookupFixture("/missing", "");
assert.match(String(missingLookup.error), /Plastic found no matching branch row/, "an empty result must be reported as not found");
const malformedLookup = await runParentLookupFixture("/malformed", "missing-separator\n");
assert.match(String(malformedLookup.error), /returned unusable output/, "malformed branch rows must be rejected");
const ambiguousLookup = await runParentLookupFixture("/ambiguous", "/ambiguous|/main\n/ambiguous|/other\n");
assert.match(String(ambiguousLookup.error), /returned unusable output/, "ambiguous branch rows must be rejected");
const explicitTargetLookup = await runParentLookupFixture("/source", "/not-used|/main\n", "/target");
assert.equal(explicitTargetLookup.calls.filter((call) => call.args[0] === "find").length, 0, "an explicit target must bypass parent lookup");
assert.match(String(explicitTargetLookup.result), /Target branch: \/target/, "explicit target preflight should proceed without lookup");

console.log("PASS: Plastic direct mutation execution tests passed");
