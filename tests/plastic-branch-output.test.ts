import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { runWithAbortSignal } from "../src/execution/context";
import type { SpawnAndCollectDependencies } from "../src/execution/process";
import { currentBranch, branchExists } from "../src/operations/branches";
import { currentBranchOutputSchema, branchExistsOutputSchema, validateBranchOutput, projectBranchOutput, type BranchOutput } from "../src/pi/branch-output";
import { loadRegisteredTools } from "./pi-tool-harness";
const tools = await loadRegisteredTools();
assert.deepEqual([...tools.values()].filter(tool => tool.outputSchema).map(tool => tool.name), ["plastic_status", "plastic_currentBranch", "plastic_branchList", "plastic_branchExists", "plastic_shelvesetList", "plastic_workspaceList"]);
assert.deepEqual(tools.get("plastic_currentBranch")!.outputSchema, currentBranchOutputSchema);
assert.deepEqual(tools.get("plastic_branchExists")!.outputSchema, branchExistsOutputSchema);
assert.equal(tools.get("plastic_branchExists")!.parameters.properties.format, undefined);
const calls: string[][] = [];
type Reply = { output: string; stderr?: string; exit?: number; bytes?: boolean };
const inject = (replies: Reply[], options: SpawnAndCollectDependencies = {}): SpawnAndCollectDependencies => ({ ...options, spawn: ((_command: string, argv: string[]) => {
  calls.push(argv);
  const reply = argv[0] === "version" ? { output: "fixture-version" } : replies.shift()!;
  assert(reply, `Unexpected command ${argv}`);
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true });
  queueMicrotask(() => { void (async () => {
    if (reply.bytes) for (const byte of Buffer.from(reply.output)) { child.stdout.write(Buffer.from([byte])); await new Promise<void>(r => setImmediate(r)); }
    else child.stdout.write(reply.output);
    child.stdout.end(); child.stderr.end(reply.stderr ?? ""); child.emit("close", reply.exit ?? 0, null);
  })(); });
  return child;
}) as any });
async function invoke(name: "currentBranch" | "branchExists", replies: Reply[], args: any = {}, options: SpawnAndCollectDependencies = {}) {
  calls.length = 0;
  const result = await runWithAbortSignal(undefined, () => tools.get("plastic_" + name)!.execute("fixture", args, undefined, undefined, { cwd: "/fixture" }), inject(replies, options));
  assert(Check(name === "currentBranch" ? currentBranchOutputSchema : branchExistsOutputSchema, result.structuredContent));
  assert.equal(result.isError, !result.structuredContent.ok);
  assert.doesNotMatch(JSON.stringify(result.structuredContent), /private diagnostic|fixture-version|\/fixture/);
  return result;
}
const identity = "/main/space ü 日本 😀";
const direct = await invoke("currentBranch", [{ output: `${identity}@repo@server (cs:0 - head)\n`, bytes: true }]);
assert.equal(direct.structuredContent.data.branch, identity); assert.equal(calls.length, 1);
assert.equal(direct.details.rawResult, identity);
const json = await invoke("currentBranch", [{ output: `${identity}@repo@server (cs:0 - head)\n` }], { format: "json" });
assert.deepEqual(json.structuredContent, direct.structuredContent); assert.equal(calls.filter(c => c[0] === "status").length, 1);
for (const [replies, basis, count] of [
  [[{ output: "no branch" }, { output: "Branch /main/space branch@repo@server" }], "compact_status", 2],
  [[{ output: "no branch" }, { output: "cs:0@rep:repo@server" }, { output: "/main\n" }], "changeset_lookup", 3],
] as const) {
  const result = await invoke("currentBranch", [...replies], {});
  assert.equal(result.structuredContent.data.basis, basis); assert.equal(calls.length, count);
}
// Every offending status source is terminal: no compact retry or lookup may
// ignore embedded selectors, malformed tokens, or additional changesets.
for (const output of [
  "/main@repo br:/other@repo",
  "br:/main br:/other@repo",
  "Branch br:/main@repo br:/other@repo",
  "branch: /main br:/other",
  "/main@repo branch: /other@repo",
  "/main@repo (cs:1.5 - head)",
  "/main@repo (cs:1junk - head)",
  "/main@repo (cs:1 - head)\ncs:2.5@repo",
]) {
  for (const compact of [false, true]) {
    const replies = compact ? [{ output: "no branch" }, { output }] : [{ output }];
    const result = await invoke("currentBranch", replies);
    assert.equal(result.isError, true, output);
    assert.equal(result.structuredContent.error.code, "malformed_output", output);
    assert.equal(result.structuredContent.data, undefined);
    assert.equal(calls.length, compact ? 2 : 1, output);
    assert.equal(calls.some(call => call[0] === "find"), false, output);
  }
}
for (const output of [
  "cs:1@repo\ncs:2.5@repo",
  "cs:2.5@repo\ncs:1@repo",
  "cs:1@repo\ncs:2@repo",
  "cs:1@repo\ncs:1@repo",
  "cs:1@repo CS:2junk@repo",
  "cs:1@repo\ncs:@repo",
  "cs:1.5@repo", "cs:1junk@repo", "cs:1/2@repo", "cs:+1@repo", "cs:1,@repo",
]) {
  const result = await invoke("currentBranch", [{ output: "no branch" }, { output }]);
  assert.equal(result.isError, true, output);
  assert.equal(result.structuredContent.error.code, "malformed_output", output);
  assert.equal(result.structuredContent.data, undefined);
  assert.deepEqual(calls, [["status"], ["status", "--compact"]], output);
}
const spacedHeader = await invoke("currentBranch", [{ output: `${identity}@Cloud Repositories/example-repository@example-server@unity (cs:16 - head)\n` }]);
assert.equal(spacedHeader.structuredContent.data.branch, identity);
assert.equal(calls.length, 1);
const spacedCompact = await invoke("currentBranch", [{ output: "no branch" }, { output: `cs:16@rep:Cloud Repositories/example-repository@repserver:example-server@unity\nBranch ${identity}@Cloud Repositories/example-repository@1111111111111@cloud\n` }]);
assert.equal(spacedCompact.structuredContent.data.branch, identity);
assert.equal(spacedCompact.structuredContent.data.basis, "compact_status");
assert.equal(calls.length, 2);
for (const replies of [
  [{ output: "no branch" }, { output: "", exit: 1 }],
  [{ output: "no branch" }, { output: "cs:0@repo" }, { output: "/main", exit: 1 }],
  [{ output: "no branch" }, { output: "cs:0@repo" }, { output: "/one\n/two" }],
  [{ output: "no branch" }, { output: "cs:0.5@repo" }],
]) {
  const count = replies.length;
  const result = await invoke("currentBranch", replies);
  assert(!result.structuredContent.ok); assert.equal(calls.length, count);
}
for (const output of ["garbage", "/main/test\nmalformed", "/main/test\n/main/test", "/main/test\n \n", "/main/other", " /main/test", "/main/te\uFFFDst", "/main/" + "x".repeat(4096)]) {
  const result = await invoke("branchExists", [{ output }], { branch: "/main/test" });
  assert.equal(result.structuredContent.ok, false, output);
}
for (const [branch, output, exists] of [["/main/test", "/other/test\n", false], ["/main/test", "", false], ["br:/main/test@other-repo@custom:server", "/main/test\n", true], ["br:/main/test@other-repo@custom:server", "/other/test\n", false], [identity, identity, true]] as const) {
  const result = await invoke("branchExists", [{ output, bytes: true }], { branch });
  assert.equal(result.structuredContent.data.exists, exists);
  assert.equal(result.structuredContent.data.requestedBranch, branch);
  assert.equal(result.structuredContent.data.scope, "workspace_repository");
  assert.equal(result.structuredContent.data.qualifierVerified, branch.includes("@") ? false : undefined);
  assert.equal(result.details.rawResult, String(exists)); assert.equal(calls.length, 1);
  assert.match(calls[0][2], /name = '/);
}
for (const name of ["currentBranch", "branchExists"] as const) {
  for (const reply of [{ output: "/main@repo", exit: 1, stderr: "private diagnostic" }, { output: "/main", stderr: "private diagnostic" }]) {
    const result = await invoke(name, [reply], { branch: "/main" });
    assert.equal(result.structuredContent.ok, false); assert.equal(calls.length, 1);
  }
  calls.length = 0;
  const spawnFailure = await runWithAbortSignal(undefined, () => tools.get("plastic_" + name)!.execute("fixture", { branch: "/main" }, undefined, undefined, { cwd: "/fixture" }), { spawn: (() => { throw Error("private diagnostic"); }) as any });
  assert.equal(spawnFailure.structuredContent.error.code, "command_failed");
  const timedOut = await invoke(name, [{ output: "/main@repo".repeat(100), bytes: true }], { branch: "/main" }, { timeoutMs: 0 });
  assert.equal(timedOut.structuredContent.error.code, "capture_incomplete");
  const truncated = await invoke(name, [{ output: "/main@repo" }], { branch: "/main" }, { outputLimitChars: 3 });
  assert.equal(truncated.structuredContent.error.code, "capture_incomplete"); assert.equal(calls.length, 1);
  const stderrTruncated = await invoke(name, [{ output: "", stderr: "private diagnostic" }], { branch: "/main" }, { outputLimitChars: 3 });
  assert.equal(stderrTruncated.structuredContent.error.code, "capture_incomplete");
  const controller = new AbortController(); controller.abort(); calls.length = 0;
  const aborted = await runWithAbortSignal(controller.signal, () => tools.get("plastic_" + name)!.execute("fixture", { branch: "/main" }, undefined, undefined, { cwd: "/fixture" }), inject([]));
  assert.equal(aborted.structuredContent.error.code, "aborted"); assert.equal(calls.length, 0);
}
for (const output of ["br:/main (cs:1)", "branch: /one\nbranch: /two", "/main\uFFFD@repo", "/" + "a".repeat(4096) + "@repo"]) {
  const result = await invoke("currentBranch", [{ output }]); assert.equal(result.structuredContent.ok, false, output); assert.equal(calls.length, 1);
}
for (const branch of [undefined, "", "/main@", "/main@@server", " /main", "/main\uFFFD", "/" + "x".repeat(4096)]) {
  const result = await invoke("branchExists", [], { branch }); assert.equal(result.structuredContent.ok, false); assert.equal(calls.length, 0);
}
if (process.platform === "win32") {
  assert.equal((await invoke("branchExists", [{ output: "/main/a?" }], { branch: "/main/a" })).structuredContent.ok, false);
  assert.equal((await invoke("currentBranch", [{ output: "/main/a?@repo" }])).structuredContent.ok, false);
}
assert.equal(validateBranchOutput("current-branch", { ...direct.structuredContent, data: { ...direct.structuredContent.data, branch: "" } }).ok, false);
assert.equal(validateBranchOutput("branch-exists", { ...direct.structuredContent, action: "branch-exists", data: { exists: "false" } }).ok, false);
const overflow = projectBranchOutput({ action: "branch-exists", requestedBranch: "/" + "界".repeat(4095), comparisonBranch: "/" + "界".repeat(4095), exists: false, scope: "workspace_repository" });
assert(!overflow.ok); assert.equal(overflow.error.code, "output_overflow");
const boundary = await invoke("branchExists", [{ output: "/" + "x".repeat(4095) }], { branch: "/" + "x".repeat(4095) }); assert(boundary.structuredContent.ok);
assert.equal(validateBranchOutput("current-branch", { ...direct.structuredContent, data: { ...direct.structuredContent.data, branch: "/main/\uD800" } }).ok, false);
// Core API keeps string results; no adapter reexecution or text parsing.
calls.length = 0;
assert.equal(await runWithAbortSignal(undefined, () => currentBranch.execute({}), inject([{ output: "/main@repo" }])), "/main");
assert.equal(calls.length, 1);
assert.equal(await runWithAbortSignal(undefined, () => branchExists.execute({ branch: "/main" }), inject([{ output: "" }])), "false");
const narrow = (dto: BranchOutput): string | boolean => !dto.ok ? dto.error.code : dto.action === "current-branch" ? dto.data.branch : dto.data.exists;
assert.equal(narrow(direct.structuredContent), identity);
console.log("PASS: branch-read contracts, scoped comparisons, strict identities, resolver routes, bounded capture, shared abort and string compatibility");

// Branch-list is the only new schema-bearing adapter in this tranche.
await import("./plastic-branch-list-output.test");
