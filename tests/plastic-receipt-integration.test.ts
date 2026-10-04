import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { checkin, branchCreate, runWithAbortSignal } from "../src/plastic-core";
import { PLASTIC_TOOL_REGISTRY } from "../src/pi/tool-registry";
import { validateCheckinOutput } from "../src/pi/checkin-output";
import { validateBranchCreateOutput } from "../src/pi/branch-create-output";
import { PiToolHarness } from "./pi-tool-harness";

assert.equal(PLASTIC_TOOL_REGISTRY.checkin, checkin);
assert.equal(PLASTIC_TOOL_REGISTRY.branchCreate, branchCreate);
const cwd = "C:\\Example\\workspace";
const request = { message: "Fixture", preflight: true, format: "json" as const, workdir: cwd };
const branchRequest = { branch: "/main/fixture", workdir: cwd };
const calls: string[][] = [];
const deps = { spawn: ((_: string, argv: string[]) => {
  calls.push(argv);
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return true; } });
  queueMicrotask(() => {
    child.emit("spawn");
    child.stdout.end(argv[0] === "status" ? "STATUS\x1f9007199254740993\x1fExample Repository\x1fexample@unity\r\n" : "");
    child.stderr.end(); child.emit("close", 0, null);
  });
  return child;
}) as any };
const coreCheckin = await runWithAbortSignal(undefined, () => checkin.execute(request), deps);
const coreBranch = await runWithAbortSignal(undefined, () => branchCreate.execute(branchRequest), deps);
assert.equal(typeof coreCheckin, "string"); assert.equal(typeof coreBranch, "string");
if (process.platform === "win32") {
  assert.equal(JSON.parse(coreCheckin).outcome, "preflight");
  assert.match(coreBranch, /command completed.*unverified/);
  assert.deepEqual(calls.map(c => c[0]), ["status", "branch"]);
}
await assert.rejects(() => checkin.execute({...request, preflight:false,updateAfter:true}), /updateAfter/);
await assert.rejects(() => branchCreate.execute({branch:""}), /non-empty/);

// Dedicated registered output must never recover DTOs by invoking/parsing core presentation.
const originals = [checkin.execute, branchCreate.execute];
checkin.execute = async () => { throw Error("Core presentation must not execute"); };
branchCreate.execute = async () => { throw Error("Core presentation must not execute"); };
try {
  const harness = new PiToolHarness({activeTools:[]}); await harness.load();
  assert.equal(harness.registry.size,28);
  assert.equal([...harness.registry.values()].filter(t => t.outputSchema).length,22);
  const registeredCheckin = await runWithAbortSignal(undefined, () => harness.registry.get("plastic_checkin")!.execute("fixture",request),deps);
  const registeredBranch = await runWithAbortSignal(undefined, () => harness.registry.get("plastic_branchCreate")!.execute("fixture",branchRequest),deps);
  assert(validateCheckinOutput(registeredCheckin.structuredContent));
  assert(validateBranchCreateOutput(registeredBranch.structuredContent));
  assert.deepEqual(registeredCheckin.details,{}); assert.deepEqual(registeredBranch.details,{});
  if (process.platform === "win32") {
    const normalize = (d: any) => { const copy = structuredClone(d); copy.data.command = copy.data.command.map((a: string) => a.replace(/[a-f0-9]{32}/g,"nonce")); return copy; };
    assert.deepEqual(normalize(JSON.parse(coreCheckin)),normalize(registeredCheckin.structuredContent),"Core/registered preflight derive identical facts apart from random command framing");
    assert.equal(coreBranch,registeredBranch.content[0].text);
  }
} finally { [checkin.execute,branchCreate.execute] = originals; }
console.log("PASS: public core facade string/input-error behavior, dedicated producer routing, empty details and exact registry/schema counts");
