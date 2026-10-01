import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRegisteredTools } from "./pi-tool-harness.ts";

async function main(): Promise<void> {
  const tools = await loadRegisteredTools();
  const shape = [...tools.values()].map(({ name, label, description, parameters, prepareArguments, promptSnippet, promptGuidelines, constrainedSampling }) => ({
    name, label, description, parameters, defaults: prepareArguments?.({}), promptSnippet, promptGuidelines, constrainedSampling,
  }));
  const expectedShape = JSON.parse(readFileSync(new URL("./fixtures/plastic-registration-shape.json", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(shape)), expectedShape, "Registered order, descriptions, schemas and argument defaults must preserve the characterized tool surface");
  assert(!tools.has("plastic_workspaceCreate"), "workspaceCreate must remain unregistered");
  const indexText = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const branchStatusText = readFileSync(new URL("../extensions/plastic-branch-status.ts", import.meta.url), "utf8");

  assert.match(indexText, /parameters:\s*buildParameters\(coreTool\.args\)/, "plastic tools should derive schemas from core args without approval-only parameters");
  assert.match(indexText, /prepareArguments:\s*config\.prepareArguments/, "plastic tools should wire prepareArguments");
  assert.match(indexText, /core\.runWithAbortSignal\(signal, async \(\) => coreTool\.execute\(normalizedParams\)\)/, "plastic tools should propagate abort signals into core execution");
  assert.doesNotMatch(indexText, /authorizationToken|authorizationProvenance|ctx\.ui\.confirm/, "Plastic tool registration must not implement token or UI-confirmation approvals");

  assert.match(indexText, /assignAlias\(input, "includeRaw", \["include_raw"\]\);/, "plastic_status should normalize include_raw");
  assert.match(indexText, /assignAlias\(input, "maxItems", \["max_items"\]\);/, "plastic_status should normalize max_items");
  assert.match(indexText, /assignAlias\(input, "message", \["comment", "comments"\]\);/, "plastic_checkin should normalize comment aliases");
  assert.match(indexText, /assignAlias\(input, "pendingChanges", \["pending_changes"\]\);/, "plastic_switchBranch should normalize pending_changes");
  assert.match(indexText, /"patch",/, "plastic_patch should be included in registered exports");
  assert.match(indexText, /"mergeToBranch",/, "plastic_mergeToBranch should be included in registered exports");
  assert.doesNotMatch(indexText, /"workspaceCreate",/, "plastic_workspaceCreate should remain unregistered until paired cleanup is available");
  assert.match(indexText, /assignAlias\(input, "toolPath", \["tool_path", "tool"\]\);/, "plastic_patch should normalize toolPath aliases");
  assert.match(indexText, /assignAlias\(input, "output", \["output_file", "outputFile"\]\);/, "plastic_patch should normalize output aliases");
  assert.match(indexText, /assignAlias\(input, "titleLike", \["title_like"\]\);/, "plastic_codeReviewFind should normalize title_like");
  assert.match(indexText, /assignAlias\(input, "keepOnDisk", \["keep_on_disk", "keepOnDisk", "nodisk"\]\);/, "plastic_resolveDeleteChangeConflict should normalize keepOnDisk aliases");
  assert.match(indexText, /assignAlias\(input, "source", \["sourceBranch", "source_branch", "branch"\]\);/, "plastic_mergeToBranch should normalize source branch aliases");
  assert.match(indexText, /assignAlias\(input, "cardRef", \["card", "cardCode", "card_code", "codecksCard", "codecks_card"\]\);/, "plastic_mergeToBranch should normalize card aliases");
  assert.match(indexText, /assignAlias\(input, "source", \["mergeSource", "merge_source"\]\);/, "plastic_finalizeMerge should normalize merge source aliases");
  assert.match(indexText, /assignAlias\(input, "workdir", \["cwd", "workingDirectory", "working_directory"\]\);/, "plastic tools should normalize workdir aliases");
  assert.match(indexText, /const enumSchema =/, "plastic tools should expose explicit enum schemas");
  assert.ok(packageManifest.pi.extensions.includes("./extensions/plastic-branch-status.ts"), "package should register the Plastic branch status extension");
  assert.doesNotMatch(branchStatusText, /\.setFooter\s*\(/, "Plastic branch status must compose through setStatus rather than replace the footer");

  console.log("PASS: plastic extension registration test succeeded");
}

void main();
