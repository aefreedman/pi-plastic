import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mergeBranches, runWithAbortSignal } from "../src/plastic-core.ts";
import { loadRegisteredTools } from "./pi-tool-harness.ts";

type SpawnCall = { args: string[] };
type Response = { stdout?: string; stderr?: string; exitCode?: number; hang?: boolean };
type CommandDependencies = { spawn: any; setTimeout?: any; clearTimeout?: any };

const source = "br:/source@repo@server";
const target = "br:/target@repo@server";
const message = "P3 test merge";
const capabilityHelp = ["--to", "--merge", "--nointeractiveresolution", "--machinereadable", "--startlineseparator", "--endlineseparator", "--fieldseparator"].join(" ");

function createSpawn(responses: Response[], calls: SpawnCall[]) {
  return ((_: string, args: readonly string[]) => {
    calls.push({ args: [...args] });
    const response = responses.shift() ?? {};
    const child = new EventEmitter() as any;
    child.stdout = Readable.from(response.stdout ? [response.stdout] : []);
    child.stderr = Readable.from(response.stderr ? [response.stderr] : []);
    child.stdin = undefined;
    child.kill = () => {
      process.nextTick(() => child.emit("close", response.exitCode ?? 1));
      return true;
    };
    if (!response.hang) process.nextTick(() => child.emit("close", response.exitCode ?? 0));
    return child;
  }) as any;
}

function machineRecord(args: string[], operation: string, fields: string[]): string {
  const start = args.find((value) => value.startsWith("--startlineseparator="))!.slice("--startlineseparator=".length);
  const end = args.find((value) => value.startsWith("--endlineseparator="))!.slice("--endlineseparator=".length);
  const field = args.find((value) => value.startsWith("--fieldseparator="))!.slice("--fieldseparator=".length);
  return `${start}${[operation, ...fields].join(field)}${end}`;
}

function scenarioDependencies(response: (args: string[]) => Response, calls: SpawnCall[], clock?: Pick<CommandDependencies, "setTimeout" | "clearTimeout">): CommandDependencies {
  const helpSpawn = createSpawn([{ stdout: capabilityHelp }], calls);
  return {
    spawn: ((command: string, args: readonly string[], options: unknown) => {
      if (args[0] === "merge") return createSpawn([response([...args])], calls)(command, args, options);
      return helpSpawn(command, args, options);
    }) as any,
    ...clock,
  };
}

async function runScenario(response: (args: string[]) => Response, clock?: Pick<CommandDependencies, "setTimeout" | "clearTimeout">): Promise<{ result: string; calls: SpawnCall[] }> {
  const calls: SpawnCall[] = [];
  const result = await runWithAbortSignal(undefined, () => mergeBranches.execute({ source, target, message, format: "json" }), scenarioDependencies(response, calls, clock));
  return { result: String(result), calls };
}

const registered = await loadRegisteredTools();
const publicTool = registered.get("plastic_mergeBranches");
assert.ok(publicTool, "plastic_mergeBranches must be registered through the native extension path");
assert.deepEqual(Object.keys((publicTool.parameters as any).properties).sort(), ["format", "message", "preflight", "source", "target"], "workspace-free merge must not expose a workdir identity/default");
for (const format of ["text", "json"] as const) {
  const preflightCalls: SpawnCall[] = [];
  const publicPreflight = await runWithAbortSignal(undefined, () => publicTool.execute("test", { source, target, message, preflight: true, format }, undefined, undefined, { cwd: "C:/unrelated" }), { spawn: createSpawn([], preflightCalls) });
  assert.match(String(publicPreflight.content?.[0]?.text), format === "json" ? /"outcome": "preflight"/ : /Server Merge Preflight/, `registered ${format} preflight should render`);
  assert.equal(preflightCalls.length, 0, `registered ${format} preflight must not spawn help, merge, or version`);
  assert.equal(String(publicPreflight.content?.[0]?.text).includes("C:/unrelated"), false, "public preflight must not derive identity from the caller cwd");
}

await assert.rejects(() => mergeBranches.execute({ source: "br:/source@repo", target, message }), /fully qualified/, "source must be repository/server-qualified");
await assert.rejects(() => mergeBranches.execute({ source, target: "br:/target@other@server", message }), /same exact repository and server/, "cross-repository targets must be rejected");
await assert.rejects(() => mergeBranches.execute({ source, target, message: "   " }), /non-empty/, "message must be nonempty");

const publicCalls: SpawnCall[] = [];
const publicSuccess = await runWithAbortSignal(undefined, () => publicTool.execute("test", { source, target, message, format: "json" }, undefined, undefined, { cwd: "C:/unrelated" }), scenarioDependencies((args) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:42@/target@repo (mount:'/')"]) }), publicCalls));
assert.match(String(publicSuccess.content?.[0]?.text), /"outcome": "completed"/, "registered public tool must expose completed JSON result");
assert.equal(publicCalls.length, 2, "public JSON result must spawn only bounded help and merge, never cm version");

const noOp = await runScenario((args) => ({ stdout: machineRecord(args, "STATUS", ["ALREADY_CONNECTED", "No merges detected"]) }));
assert.match(noOp.result, /"outcome": "no-op"/, "exact ALREADY_CONNECTED record should be classified as no-op");
assert.match(noOp.result, /"effect": "not-proven"/, "no-op must not promise absent effects");

const conflict = await runScenario((args) => ({ stdout: machineRecord(args, "FILE_CONFLICT", ["/file.txt", "1", "2", "3", "4"]), stderr: "native conflict diagnostic", exitCode: 1 }));
assert.match(conflict.result, /"outcome": "conflict"/, "file conflict must retain a typed conflict classification");
assert.match(conflict.result, /"effect": "uncertain"/, "conflict must retain uncertain effects");

for (const response of [
  (args: string[]) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:43@/wrong@repo (mount:'/')"]) }),
  (args: string[]) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:43@/target@other (mount:'/')"]) }),
  (args: string[]) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:43@/target@repo (mount:'/other')"]) }),
  (args: string[]) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:43@/target@repo (mount:'/')", "extra-field"]) }),
  (args: string[]) => ({ stdout: `${machineRecord(args, "CHANGESET", ["cs:43@/target@repo (mount:'/')"])}${machineRecord(args, "STATUS", ["OTHER_STATUS", "unexpected"])}` }),
  (args: string[]) => ({ stdout: `${machineRecord(args, "CHANGESET", ["cs:43@/target@repo (mount:'/')"])}${machineRecord(args, "STATUS", ["ALREADY_CONNECTED", "No merges detected"])}` }),
  (args: string[]) => ({ stdout: `${machineRecord(args, "CHANGESET", ["cs:43@/target@repo (mount:'/')"])}${machineRecord(args, "CHANGESET", ["cs:44@/target@repo (mount:'/')"])}` }),
  (args: string[]) => ({ stdout: `${args.find((value) => value.startsWith("--fieldseparator="))!.slice("--fieldseparator=".length)}stray${machineRecord(args, "CHANGESET", ["cs:43@/target@repo (mount:'/')"])}` }),
  (args: string[]) => ({ stdout: `${args.find((value) => value.startsWith("--startlineseparator="))!.slice("--startlineseparator=".length)}spoofed` }),
]) {
  const uncertain = await runScenario(response);
  assert.match(uncertain.result, /"outcome": "uncertain"/, "wrong target/repository/mount, extra/contradictory records, or stray framing must fail closed");
}

const truncated = await runScenario(() => ({ stdout: "x".repeat(20_000) }));
assert.match(truncated.result, /"outcome": "uncertain"/, "truncated output must remain uncertain");

const immediateClock = {
  setTimeout(callback: () => void, delay: number) {
    if (delay === 30_000) process.nextTick(callback);
    return setTimeout(callback, delay) as unknown as NodeJS.Timeout;
  },
  clearTimeout(timeout: NodeJS.Timeout) { clearTimeout(timeout as unknown as ReturnType<typeof setTimeout>); },
};
const timedOut = await runScenario((args) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:77@/target@repo (mount:'/')"]), hang: true }), immediateClock);
assert.match(timedOut.result, /"outcome": "uncertain"/, "internal merge deadline must preserve uncertain effects rather than complete");
assert.match(timedOut.result, /"timedOut": true/, "deadline expiration must be observable");
assert.match(timedOut.result, /"id": "77"/, "deadline result must retain any bounded observed changeset identity");
assert.equal(timedOut.calls.filter((call) => call.args[0] === "merge").length, 1, "deadline expiration must not replay or fall back");

const controller = new AbortController();
const abortCalls: SpawnCall[] = [];
const abortDependencies = scenarioDependencies((args) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:78@/target@repo (mount:'/')"]), hang: true }), abortCalls, {
  setTimeout(callback: () => void) { return setTimeout(callback, 60_000) as unknown as NodeJS.Timeout; },
  clearTimeout(timeout: NodeJS.Timeout) { clearTimeout(timeout as unknown as ReturnType<typeof setTimeout>); },
});
setTimeout(() => controller.abort(), 1);
const aborted = await runWithAbortSignal(controller.signal, () => mergeBranches.execute({ source, target, message, format: "json" }), abortDependencies);
assert.match(String(aborted), /"outcome": "uncertain"/, "external abort must compose with the internal deadline boundary");
assert.match(String(aborted), /"aborted": true/, "external abort must remain distinguishable");
assert.equal(abortCalls.filter((call) => call.args[0] === "merge").length, 1, "external abort must not retry");

const unsupportedCalls: SpawnCall[] = [];
const unsupported = await runWithAbortSignal(undefined, () => mergeBranches.execute({ source, target, message, format: "json" }), { spawn: createSpawn([{ stdout: "cm merge help without required flags" }], unsupportedCalls) });
assert.match(String(unsupported), /"outcome": "unsupported"/, "missing local syntax capability must stop before merge dispatch");
assert.equal(unsupportedCalls.filter((call) => call.args[0] === "merge").length, 0, "unsupported local capability must have zero merge dispatches");

console.log("PASS: plastic workspace-free merge branch tests passed");
