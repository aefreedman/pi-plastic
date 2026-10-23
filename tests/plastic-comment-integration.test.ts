import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { runWithAbortSignal } from "../src/execution/context";
import { loadRegisteredTools } from "./pi-tool-harness";
import { searchPlasticTools } from "../src/plastic-tool-loading";
import { MUTATING_PLASTIC_TOOLS } from "../evals/tool-loading/mutation-guard";

const guid = "00000000-0000-4000-8000-000000000001";
const workflow = { id: "1110", repository: "synthetic-repository@synthetic-org@unity" };
const cases: [string, Record<string, unknown>, string[]][] = [
  ["branchEditComment", { branch: "br:/main/feature", comment: "" }, ["branch", "editcomment", "br:/main/feature", ""]],
  ["labelEditComment", { label: "lb:feature", comment: "new" }, ["label", "editcomment", "lb:feature", "new"]],
  ["codeReviewCommentFind", { review: "1114" }, ["find", "changereviewcomment", "where reviewid=1114", "--xml", "--encoding=utf-8"]],
  ["codeReviewCommentAdd", { review: "1114", comment: "explicit" }, ["codereview", "comment", "add", "1114", "-c=explicit"]],
  ["codeReviewCommentReply", { commentGuid: guid, comment: "explicit" }, ["codereview", "comment", "reply", guid, "-c=explicit"]],
  ["codeReviewCommentEdit", { commentGuid: guid, comment: "explicit" }, ["codereview", "comment", "edit", guid, "-c=explicit"]],
  ["codeReviewCommentDelete", { commentGuids: [guid] }, ["codereview", "comment", "delete", guid]],
  ["codeReviewReviewerAdd", { ...workflow, users: ["me"] }, ["codereview", "reviewer", "add", "1110", "--users=me", `--repository=${workflow.repository}`]],
  ["codeReviewReviewerRemove", { ...workflow, groups: ["QA"] }, ["codereview", "reviewer", "remove", "1110", "--groups=QA", `--repository=${workflow.repository}`]],
  ["codeReviewReviewerList", workflow, ["codereview", "reviewer", "list", "1110", `--repository=${workflow.repository}`]],
  ["codeReviewSetStatus", { ...workflow, status: "reviewed" }, ["codereview", "review", "1110", "--reviewed", `--repository=${workflow.repository}`]],
  ["codeReviewRequestReview", { ...workflow, all: true }, ["codereview", "review", "1110", "--re-request", "--all", `--repository=${workflow.repository}`]],
];
const tools = await loadRegisteredTools();
let commands = 0;
const deps = { spawn: ((_cmd: string, argv: string[], options: any) => {
  commands++;
  assert.equal(options.shell, false);
  assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => false });
  queueMicrotask(() => { child.emit("spawn"); child.stdout.end(""); child.stderr.end("synthetic native failure"); child.emit("close", 1, null); });
  return child;
}) as any };
for (const [name, request, argv] of cases) {
  const publicName = `plastic_${name}`, tool = tools.get(publicName)!;
  assert(tool.outputSchema, publicName);
  const read = name === "codeReviewCommentFind" || name === "codeReviewReviewerList";
  assert.equal(MUTATING_PLASTIC_TOOLS.has(publicName), !read);
  assert.equal(searchPlasticTools({ toolNames: [publicName] })[0]?.name, publicName);
  const original = { ...request, cwd: process.cwd(), preflight: true, output: "json" };
  const prepared = tool.prepareArguments!(original);
  assert.equal(original.cwd, process.cwd());
  assert.equal(prepared.cwd, undefined);
  commands = 0;
  const preview = await runWithAbortSignal(undefined, () => tool.execute("preview", prepared, undefined, undefined, { cwd: process.cwd() }), deps);
  assert.equal(commands, 0);
  assert.equal(preview.structuredContent.outcome, "preflight");
  assert(Check(tool.outputSchema as any, preview.structuredContent));
  assert.deepEqual(preview.structuredContent.data.intendedArgv, argv);
  commands = 0;
  const failure = await runWithAbortSignal(undefined, () => tool.execute("native-error", request, undefined, undefined, { cwd: process.cwd() }), deps);
  assert.equal(commands, 1);
  assert.equal(failure.isError, true);
  assert(Check(tool.outputSchema as any, failure.structuredContent));
  assert.equal(failure.structuredContent.ok, false);
  commands = 0;
  const invalid = await runWithAbortSignal(undefined, () => tool.execute("invalid", { ...request, unsupported: true }, undefined, undefined, {}), deps);
  assert.equal(commands, 0);
  assert.equal(invalid.isError, true);
}
console.log("PASS: twelve registered comment/workflow facades, exact preview argv, schema admission, context aliases, native failure/no-retry and exhaustive effect classification; no SCM");
