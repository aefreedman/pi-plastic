import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  __plasticProcessInternals,
  runWithAbortSignal,
} from "../src/plastic-core.ts";
import {
  PLASTIC_MUTATION_COMMANDS_V1,
  classifyPlasticCommandAuthorizationV1,
} from "../src/mutation-authorization.ts";
import { issueWorkflowAuthorizationTokenV1 } from "@aefree/pi-workflow/authorization/v1";
import { loadRegisteredTools } from "./pi-tool-harness.ts";

const registeredTools = await loadRegisteredTools();
for (const name of ["plastic_update", "plastic_checkin", "plastic_branchCreate", "plastic_switchBranch", "plastic_merge", "plastic_codeReviewCreate"]) {
  assert.ok((registeredTools.get(name)?.parameters as any)?.properties?.authorizationToken, `${name} must expose optional authorizationToken`);
}
assert.equal((registeredTools.get("plastic_status")?.parameters as any)?.properties?.authorizationToken, undefined, "legacy reads remain unchanged");

const root = process.cwd();
const commandVectors: Record<(typeof PLASTIC_MUTATION_COMMANDS_V1)[number], string[]> = {
  "update": ["update", "--dontmerge", "--noinput"],
  "add": ["add", "Assets/Foo.cs"],
  "checkin": ["checkin", "-c=fixture"],
  "undo": ["undo", "Assets/Foo.cs"],
  "remove": ["remove", "Assets/Foo.cs"],
  "switch": ["switch", "/main/task-auth"],
  "merge": ["merge", "br:/main/source", "--merge", "--nointeractiveresolution", "--mergetype=try"],
  "branch create": ["branch", "create", "/main/task-auth"],
  "branch delete": ["branch", "delete", "/main/task-auth"],
  "shelveset create": ["shelveset", "create", "--all", "-c=fixture"],
  "shelveset apply": ["shelveset", "apply", "sh:3"],
  "shelveset delete": ["shelveset", "delete", "sh:3"],
  "codereview create": ["codereview", "br:/main/task-auth", "Fixture review"],
  "codereview update": ["codereview", "-e", "review-1", "--status=closed"],
  "codereview delete": ["codereview", "-d", "review-1"],
  "workspace create": ["workspace", "create", "fixture", `${root}/fixture-workspace`],
};
assert.deepEqual(Object.keys(commandVectors).sort(), [...PLASTIC_MUTATION_COMMANDS_V1].sort(), "mutation sink inventory must remain exhaustive");

function makeSpawnSpy(counter: { calls: number }, exitCode = 0, stderr = "") {
  return ((_command: string, _args: readonly string[]) => {
    counter.calls += 1;
    const child = new EventEmitter() as any;
    child.stdout = Readable.from([]);
    child.stderr = Readable.from(stderr ? [stderr] : []);
    child.stdin = undefined;
    child.kill = () => true;
    process.nextTick(() => child.emit("close", exitCode));
    return child;
  }) as any;
}

async function run(args: string[], context?: any, counter = { calls: 0 }, processResult?: { exitCode: number; stderr?: string }) {
  return runWithAbortSignal(
    undefined,
    () => __plasticProcessInternals.runCm(args, root),
    context,
    { spawn: makeSpawnSpy(counter, processResult?.exitCode ?? 0, processResult?.stderr ?? "") },
  );
}

for (const [operation, args] of Object.entries(commandVectors)) {
  const counter = { calls: 0 };
  await assert.rejects(run(args, undefined, counter), /authorization_context_required/);
  assert.equal(counter.calls, 0, `${operation} must block before spawn without context/token`);
}

for (const [operation, args] of Object.entries(commandVectors)) {
  const counter = { calls: 0 };
  let confirmations = 0;
  await run(args, {
    sessionManager: {}, mode: "tui", hasUI: true,
    async confirm(_title: string, message: string) {
      confirmations += 1;
      assert.match(message, /Exact target: plastic:/);
      return true;
    },
  }, counter);
  assert.equal(counter.calls, 1, `${operation} must spawn once after direct confirmation`);
  assert.equal(confirmations, 1, `${operation} must obtain one direct confirmation`);
}

const repeatedDirectCounter = { calls: 0 };
let repeatedDirectConfirmations = 0;
const repeatedDirectContext = {
  sessionManager: {}, mode: "tui", hasUI: true,
  async confirm() { repeatedDirectConfirmations += 1; return true; },
};
await run(commandVectors.update, repeatedDirectContext, repeatedDirectCounter);
await run(commandVectors.update, repeatedDirectContext, repeatedDirectCounter);
assert.equal(repeatedDirectCounter.calls, 2);
assert.equal(repeatedDirectConfirmations, 2, "direct confirmation must not be cached across separate cm mutation spawns");

const args = commandVectors.checkin;
const command = classifyPlasticCommandAuthorizationV1(args, root);
assert.equal(command.action, "commit", "Plastic checkin maps to commit");
assert.equal(classifyPlasticCommandAuthorizationV1(commandVectors["branch create"], root).action, "publish");
assert.equal(classifyPlasticCommandAuthorizationV1(commandVectors.merge, root).action, "vcs_mutation");
const sessionManager = {};
const token = issueWorkflowAuthorizationTokenV1(sessionManager, command.action!, [command.target!]);
let counter = { calls: 0 };
const sinkContext = { sessionManager, mode: "json", hasUI: false, authorizationToken: token.authorizationToken };
await run(args, sinkContext, counter);
assert.equal(counter.calls, 1, "one matching token permits exactly one checkin spawn");
assert.deepEqual(sinkContext.authorizationProvenance, [{
  authoritySource: "authorization_token_consumed", action: "commit", canonicalTargets: [command.target], consumed: true,
}]);
assert.doesNotMatch(JSON.stringify(sinkContext.authorizationProvenance), new RegExp(token.authorizationToken));
counter = { calls: 0 };
await assert.rejects(run(args, { sessionManager, mode: "json", hasUI: false, authorizationToken: token.authorizationToken }, counter), /authorization_token_replayed/);
assert.equal(counter.calls, 0, "replay must fail before spawn");

const ambiguousSession = {};
const ambiguousToken = issueWorkflowAuthorizationTokenV1(ambiguousSession, command.action!, [command.target!]);
const ambiguousContext = { sessionManager: ambiguousSession, mode: "json", hasUI: false, authorizationToken: ambiguousToken.authorizationToken };
counter = { calls: 0 };
await assert.rejects(
  run(args, ambiguousContext, counter, { exitCode: 1, stderr: "mock transport timeout after cm started" }),
  /mock transport timeout/,
);
assert.equal(counter.calls, 1, "one token permits one ambiguous side-effecting cm process attempt");
await assert.rejects(
  run(args, ambiguousContext, counter),
  /authorization_token_replayed.*inspect Plastic status.*fresh token or direct TUI\/RPC confirmation/i,
);
assert.equal(counter.calls, 1, "ambiguous retry with the consumed token must block before a second process spawn");

for (const [label, authorizationToken, scope] of [
  ["wrong action", issueWorkflowAuthorizationTokenV1(sessionManager, "push", [command.target!]).authorizationToken, sessionManager],
  ["wrong target", issueWorkflowAuthorizationTokenV1(sessionManager, "commit", [`${command.target!}-other`]).authorizationToken, sessionManager],
  ["wrong session", issueWorkflowAuthorizationTokenV1({}, "commit", [command.target!]).authorizationToken, sessionManager],
  ["expired", issueWorkflowAuthorizationTokenV1(sessionManager, "commit", [command.target!], 0).authorizationToken, sessionManager],
] as const) {
  counter = { calls: 0 };
  await assert.rejects(run(args, { sessionManager: scope, mode: "json", hasUI: false, authorizationToken }, counter));
  assert.equal(counter.calls, 0, `${label} must fail before spawn`);
}

const unknownArgs = ["future-mutator", "target"];
const unknown = classifyPlasticCommandAuthorizationV1(unknownArgs, root);
assert.equal(unknown.mutation, true);
assert.equal(unknown.classified, false);
const unknownToken = issueWorkflowAuthorizationTokenV1(sessionManager, unknown.action!, [unknown.target!]);
counter = { calls: 0 };
await assert.rejects(run(unknownArgs, { sessionManager, mode: "json", hasUI: false, authorizationToken: unknownToken.authorizationToken }, counter), /unclassified_confirmation_required/);
assert.equal(counter.calls, 0, "unclassified low-level mutation must reject token-only execution before spawn");
let unknownConfirmed = false;
counter = { calls: 0 };
await run(unknownArgs, {
  sessionManager: {}, mode: "rpc", hasUI: true,
  async confirm() { unknownConfirmed = true; return true; },
}, counter);
assert.equal(unknownConfirmed, true);
assert.equal(counter.calls, 1, "unclassified low-level mutation may spawn only after direct confirmation");

for (const readArgs of [["status"], ["find", "branch"], ["version"], ["cat", "file#cs:1"], ["workspace", "list"], ["shelveset", "apply", "sh:3", "--preview"]]) {
  counter = { calls: 0 };
  await run(readArgs, undefined, counter);
  assert.equal(counter.calls, 1, `${readArgs.join(" ")} remains an unaffected legacy read/preview`);
}

console.log("Plastic mutation authorization sink tests passed");
