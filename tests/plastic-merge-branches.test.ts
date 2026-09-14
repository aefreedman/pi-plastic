import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mergeBranches, runWithAbortSignal } from "../src/plastic-core.ts";
import { loadRegisteredTools } from "./pi-tool-harness.ts";

type SpawnCall = { args: string[] };
type Response = { stdout?: string; stderr?: string; exitCode?: number; hang?: boolean };

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

async function runScenario(response: (args: string[]) => Response, signal?: AbortSignal): Promise<{ result: string; calls: SpawnCall[] }> {
  const calls: SpawnCall[] = [];
  const spawn = createSpawn([{ stdout: capabilityHelp }, { stdout: "" }], calls);
  const wrappedSpawn = ((command: string, args: readonly string[], options: unknown) => {
    if (args[0] === "merge") {
      const next = response([...args]);
      return createSpawn([next], calls)(command, args, options);
    }
    return spawn(command, args, options);
  }) as any;
  const result = await runWithAbortSignal(signal, () => mergeBranches.execute({ source, target, message, format: "json" }), { spawn: wrappedSpawn });
  return { result: String(result), calls };
}

const registered = await loadRegisteredTools();
const publicTool = registered.get("plastic_mergeBranches");
assert.ok(publicTool, "plastic_mergeBranches must be registered through the native extension path");
assert.deepEqual(Object.keys((publicTool.parameters as any).properties).sort(), ["format", "message", "preflight", "source", "target"], "workspace-free merge must not expose a workdir identity/default");
const publicPreflight = await publicTool.execute("test", { source, target, message, preflight: true, format: "json" }, undefined, undefined, { cwd: "C:/unrelated" });
assert.match(String(publicPreflight.content?.[0]?.text), /"outcome": "preflight"/, "registered public tool must execute command-only preflight");
assert.equal(String(publicPreflight.content?.[0]?.text).includes("C:/unrelated"), false, "public preflight must not derive identity from the caller cwd");

await assert.rejects(() => mergeBranches.execute({ source: "br:/source@repo", target, message }), /fully qualified/, "source must be repository/server-qualified");
await assert.rejects(() => mergeBranches.execute({ source, target: "br:/target@other@server", message }), /same exact repository and server/, "cross-repository targets must be rejected");
await assert.rejects(() => mergeBranches.execute({ source, target, message: "   " }), /non-empty/, "message must be nonempty");

const preflightCalls: SpawnCall[] = [];
const preflight = await runWithAbortSignal(undefined, () => mergeBranches.execute({ source, target, message, preflight: true }), { spawn: createSpawn([], preflightCalls) });
assert.match(String(preflight), /Server Merge Preflight/, "preflight should render the command");
assert.equal(preflightCalls.length, 0, "preflight must not spawn help or merge commands");

const success = await runScenario((args) => ({ stdout: machineRecord(args, "CHANGESET", ["cs:42@/target@repo (mount:'/')"]) }));
assert.match(success.result, /"outcome": "completed"/, "one emitted matching root-mount changeset should complete");
assert.match(success.result, /"mergeLinkIdentity": "unverified"/, "completion must not invent merge-link identity");
assert.equal(success.calls.filter((call) => call.args[0] === "merge").length, 1, "success must dispatch exactly once");
assert.equal(success.calls.filter((call) => call.args[0] === "help").length, 1, "success must perform only the bounded local help gate before dispatch");
assert(success.calls.find((call) => call.args[0] === "merge")!.args.includes("--nointeractiveresolution"), "dispatch must retain the verified non-interactive flag");

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
  (args: string[]) => ({ stdout: `${machineRecord(args, "CHANGESET", ["cs:43@/target@repo (mount:'/')"])}${machineRecord(args, "CHANGESET", ["cs:44@/target@repo (mount:'/')"])}` }),
  (args: string[]) => ({ stdout: `${args.find((value) => value.startsWith("--startlineseparator="))!.slice("--startlineseparator=".length)}spoofed` }),
]) {
  const uncertain = await runScenario(response);
  assert.match(uncertain.result, /"outcome": "uncertain"/, "wrong target/repository/mount, duplicate, or incomplete spoofed records must fail closed");
}

const truncated = await runScenario(() => ({ stdout: "x".repeat(20_000) }));
assert.match(truncated.result, /"outcome": "uncertain"/, "truncated output must remain uncertain");

const controller = new AbortController();
const timeoutCalls: SpawnCall[] = [];
const timeoutSpawn = createSpawn([{ stdout: capabilityHelp }, { hang: true }], timeoutCalls);
setTimeout(() => controller.abort(), 1);
const timeout = await runWithAbortSignal(controller.signal, () => mergeBranches.execute({ source, target, message, format: "json" }), { spawn: timeoutSpawn });
assert.match(String(timeout), /"outcome": "uncertain"/, "aborted dispatch must retain uncertain effects");
assert.equal(timeoutCalls.filter((call) => call.args[0] === "merge").length, 1, "aborted dispatch must not retry or fall back to a workspace route");

const unsupportedCalls: SpawnCall[] = [];
const unsupported = await runWithAbortSignal(undefined, () => mergeBranches.execute({ source, target, message, format: "json" }), { spawn: createSpawn([{ stdout: "cm merge help without required flags" }], unsupportedCalls) });
assert.match(String(unsupported), /"outcome": "unsupported"/, "missing local syntax capability must stop before merge dispatch");
assert.equal(unsupportedCalls.filter((call) => call.args[0] === "merge").length, 0, "unsupported local capability must have zero merge dispatches");

console.log("PASS: plastic workspace-free merge branch tests passed");
