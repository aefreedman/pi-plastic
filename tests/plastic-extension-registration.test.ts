import { checkinOutputSchema } from "../src/pi/checkin-output";
import { branchCreateOutputSchema } from "../src/pi/branch-create-output";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRegisteredTools } from "./pi-tool-harness.ts";
import { PLASTIC_TOOL_REGISTRY, getRegisteredPlasticExportNames, toToolName } from "../src/pi/tool-registry.ts";
import { PLASTIC_TOOL_NAMES } from "../src/plastic-tool-loading.ts";
import { getActiveAbortSignal } from "../src/execution/context.ts";
import { statusOutputSchema } from "../src/pi/status-output.ts";
import { diffOutputSchema } from "../src/pi/diff-output";
import { serverMergeOutputSchema } from "../src/pi/server-merge-output";
import { codeReviewFindOutputSchema } from "../src/pi/code-review-find-output";
import { shelvesetListOutputSchema } from "../src/pi/shelveset-list-output";
import { workspaceListOutputSchema } from "../src/pi/workspace-list-output";
import { branchListOutputSchema } from "../src/pi/branch-list-output";
import { currentBranchOutputSchema, branchExistsOutputSchema } from "../src/pi/branch-output.ts";

async function main(): Promise<void> {
  const tools = await loadRegisteredTools();
  for (const tool of tools.values()) {
    assert.deepEqual(tool.outputSchema, tool.name === "plastic_status" ? statusOutputSchema : tool.name === "plastic_currentBranch" ? currentBranchOutputSchema : tool.name === "plastic_branchExists" ? branchExistsOutputSchema : tool.name === "plastic_branchList" ? branchListOutputSchema : tool.name === "plastic_workspaceList" ? workspaceListOutputSchema : tool.name === "plastic_shelvesetList" ? shelvesetListOutputSchema : tool.name === "plastic_codeReviewFind" ? codeReviewFindOutputSchema : tool.name === "plastic_diff" ? diffOutputSchema : tool.name === "plastic_mergeBranches" ? serverMergeOutputSchema : tool.name === "plastic_checkin" ? checkinOutputSchema : tool.name === "plastic_branchCreate" ? branchCreateOutputSchema : undefined, "Exactly eleven selected tools own structured output schemas");
  }
  assert.equal(tools.size, 28, "27 core registrations plus loader");
  assert.equal([...tools.values()].filter(t => t.outputSchema).length, 11);
  const shape = [...tools.values()].map(({ name, label, description, parameters, prepareArguments, promptSnippet, promptGuidelines, constrainedSampling, outputSchema }) => ({
    name, label, description, parameters, defaults: prepareArguments?.({}), promptSnippet, promptGuidelines, constrainedSampling, hasOutputSchema: outputSchema !== undefined,
  }));
  const expectedShape = JSON.parse(readFileSync(new URL("./fixtures/plastic-registration-shape.json", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(shape)), expectedShape, "Registered order, descriptions, schemas and argument defaults must preserve the characterized tool surface");
  assert(!tools.has("plastic_workspaceCreate"), "workspaceCreate must remain unregistered");
  const registerText = readFileSync(new URL("../src/pi/register.ts", import.meta.url), "utf8");
  const argumentsText = readFileSync(new URL("../src/pi/arguments.ts", import.meta.url), "utf8");
  const schemaText = readFileSync(new URL("../src/pi/schemas.ts", import.meta.url), "utf8");
  const registryText = readFileSync(new URL("../src/pi/tool-registry.ts", import.meta.url), "utf8");
  const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const branchStatusText = readFileSync(new URL("../extensions/plastic-branch-status.ts", import.meta.url), "utf8");

  assert.match(registerText, /buildParameters\(coreTool\.args\)/, "plastic tools should derive schemas from core args without approval-only parameters");
  assert.match(registerText, /prepareArguments:\s*config\.prepareArguments/, "plastic tools should wire prepareArguments");
  assert.match(registerText, /runWithAbortSignal\(signal, async \(\) => coreTool\.execute\(normalizedParams\)\)/, "plastic tools should propagate abort signals into core execution");
  assert.doesNotMatch(registerText, /authorizationToken|authorizationProvenance|ctx\.ui\.confirm/, "Plastic tool registration must not implement token or UI-confirmation approvals");

  assert.match(argumentsText, /assignAlias\(input, "includeRaw", \["include_raw"\]\);/, "plastic_status should normalize include_raw");
  assert.match(argumentsText, /assignAlias\(input, "maxItems", \["max_items"\]\);/, "plastic_status should normalize max_items");
  assert.match(argumentsText, /assignAlias\(input, "message", \["comment", "comments"\]\);/, "plastic_checkin should normalize comment aliases");
  assert.match(argumentsText, /assignAlias\(input, "pendingChanges", \["pending_changes"\]\);/, "plastic_switchBranch should normalize pending_changes");
  assert(tools.has("plastic_patch"), "plastic_patch should be included in registered exports");
  assert(tools.has("plastic_mergeToBranch"), "plastic_mergeToBranch should be included in registered exports");
  assert.doesNotMatch(registryText, /\bworkspaceCreate\b/, "plastic_workspaceCreate should remain unregistered until paired cleanup is available");
  assert.match(argumentsText, /assignAlias\(input, "toolPath", \["tool_path", "tool"\]\);/, "plastic_patch should normalize toolPath aliases");
  assert.match(argumentsText, /assignAlias\(input, "output", \["output_file", "outputFile"\]\);/, "plastic_patch should normalize output aliases");
  assert.match(argumentsText, /assignAlias\(input, "titleLike", \["title_like"\]\);/, "plastic_codeReviewFind should normalize title_like");
  assert.match(argumentsText, /assignAlias\(input, "keepOnDisk", \["keep_on_disk", "keepOnDisk", "nodisk"\]\);/, "plastic_resolveDeleteChangeConflict should normalize keepOnDisk aliases");
  assert.match(argumentsText, /assignAlias\(input, "source", \["sourceBranch", "source_branch", "branch"\]\);/, "plastic_mergeToBranch should normalize source branch aliases");
  assert.match(argumentsText, /assignAlias\(input, "cardRef", \["card", "cardCode", "card_code", "codecksCard", "codecks_card"\]\);/, "plastic_mergeToBranch should normalize card aliases");
  assert.match(argumentsText, /assignAlias\(input, "source", \["mergeSource", "merge_source"\]\);/, "plastic_finalizeMerge should normalize merge source aliases");
  assert.match(argumentsText, /assignAlias\(input, "workdir", \["cwd", "workingDirectory", "working_directory"\]\);/, "plastic tools should normalize workdir aliases");
  assert.match(schemaText, /const enumSchema =/, "plastic tools should expose explicit enum schemas");
  assert.ok(packageManifest.pi.extensions.includes("./extensions/plastic-branch-status.ts"), "package should register the Plastic branch status extension");
  assert.doesNotMatch(branchStatusText, /\.setFooter\s*\(/, "Plastic branch status must compose through setStatus rather than replace the footer");

  assert.deepEqual(new Set(getRegisteredPlasticExportNames().map(toToolName)), PLASTIC_TOOL_NAMES, "Explicit registry must exactly match searchable and compatibility loading names");
  assert.doesNotMatch([registerText, argumentsText, schemaText, registryText].join("\n"), /authorizationToken|authorizationProvenance|ctx\.ui\.confirm/, "Extracted adapter owners must retain approval-free registration");

  for (const [name, input, expected] of [
    ["plastic_status", { cwd: "/alias", include_raw: true, max_items: 5, format: "markdown" }, { workdir: "/alias", includeRaw: true, maxItems: 5, format: "text" }],
    ["plastic_checkin", { comment: "message", file: "one", include_private: true }, { message: "message", paths: ["one"], includePrivate: true }],
    ["plastic_mergeToBranch", { source_branch: "/source", destination_branch: "/target", card_code: "card" }, { source: "/source", target: "/target", cardRef: "card" }],
    ["plastic_codeReviewUpdate", { review_id: 42 }, { reviewId: 42, id: 42 }],
    ["plastic_codeReviewDelete", { id: 42 }, { ids: ["42"] }],
  ] as const) {
    const original = structuredClone(input);
    const prepared = tools.get(name)!.prepareArguments!(input);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(prepared[key], value, `${name} should prepare ${key}`);
    assert.deepEqual(input, original, "Argument preparation must not mutate input");
  }
  const canonical = tools.get("plastic_status")!.prepareArguments!({ workdir: "/canonical", cwd: "/alias", maxItems: 7, max_items: 5 });
  assert.equal(canonical.workdir, "/canonical");
  assert.equal(canonical.maxItems, 7, "Canonical arguments must win over aliases");

  // Intercept only the operation boundary: adapter tests must never start cm.
  for (const exportName of ["update"] as const) {
    const definition = PLASTIC_TOOL_REGISTRY[exportName];
    const originalExecute = definition.execute;
    const signal = new AbortController().signal;
    let received: unknown;
    let receivedSignal: AbortSignal | undefined;
    definition.execute = async (args) => {
      received = args;
      receivedSignal = getActiveAbortSignal();
      return "synthetic adapter result";
    };
    try {
      const tool = tools.get(toToolName(exportName))!;
      const params = {};
      const result = await tool.execute("adapter", params, signal, undefined, { cwd: "/session-cwd" });
      assert.deepEqual(received, { workdir: "/session-cwd" }, "Only workspace tools default workdir to ctx.cwd");
      assert.equal(receivedSignal, signal, "Adapter must use the sole shared abort context");
      assert.deepEqual(params, {}, "Execution defaulting must not mutate caller params");
      assert.equal(result.content[0].text, "synthetic adapter result");
      assert.equal(result.details.exportName, exportName);
      assert.equal(result.details.rawResult, "synthetic adapter result");
      assert.equal(result.details.workdir, "/session-cwd");
      await tool.execute("explicit-workdir", { workdir: "/explicit" }, signal, undefined, { cwd: "/session-cwd" });
      assert.deepEqual(received, { workdir: "/explicit" }, "Explicit workdir must survive even on the server merge adapter");
    } finally {
      definition.execute = originalExecute;
    }
  }

  console.log("PASS: plastic extension registration test succeeded");
}

void main();
