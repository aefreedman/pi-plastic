import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function main(): void {
  const indexText = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(indexText, /parameters:\s*buildParameters\(coreTool\.args\)/, "plastic tools should derive schemas from core args");
  assert.match(indexText, /prepareArguments:\s*config\.prepareArguments/, "plastic tools should wire prepareArguments");
  assert.match(indexText, /core\.runWithAbortSignal\(signal, async \(\) => coreTool\.execute\(normalizedParams\)\)/, "plastic tools should propagate abort signals into core execution");

  assert.match(indexText, /assignAlias\(input, "message", \["comment", "comments"\]\);/, "plastic_checkin should normalize comment aliases");
  assert.match(indexText, /assignAlias\(input, "pendingChanges", \["pending_changes"\]\);/, "plastic_switchBranch should normalize pending_changes");
  assert.match(indexText, /"patch",/, "plastic_patch should be included in registered exports");
  assert.match(indexText, /"mergeToBranch",/, "plastic_mergeToBranch should be included in registered exports");
  assert.match(indexText, /assignAlias\(input, "toolPath", \["tool_path", "tool"\]\);/, "plastic_patch should normalize toolPath aliases");
  assert.match(indexText, /assignAlias\(input, "output", \["output_file", "outputFile"\]\);/, "plastic_patch should normalize output aliases");
  assert.match(indexText, /assignAlias\(input, "titleLike", \["title_like"\]\);/, "plastic_codeReviewFind should normalize title_like");
  assert.match(indexText, /assignAlias\(input, "keepOnDisk", \["keep_on_disk", "keepOnDisk", "nodisk"\]\);/, "plastic_resolveDeleteChangeConflict should normalize keepOnDisk aliases");
  assert.match(indexText, /assignAlias\(input, "source", \["sourceBranch", "source_branch", "branch"\]\);/, "plastic_mergeToBranch should normalize source branch aliases");
  assert.match(indexText, /assignAlias\(input, "cardRef", \["card", "cardCode", "card_code", "codecksCard", "codecks_card"\]\);/, "plastic_mergeToBranch should normalize card aliases");
  assert.match(indexText, /assignAlias\(input, "source", \["mergeSource", "merge_source"\]\);/, "plastic_finalizeMerge should normalize merge source aliases");
  assert.match(indexText, /assignAlias\(input, "workdir", \["cwd", "workingDirectory", "working_directory"\]\);/, "plastic tools should normalize workdir aliases");
  assert.match(indexText, /const enumSchema =/, "plastic tools should expose explicit enum schemas");

  console.log("PASS: plastic extension registration test succeeded");
}

main();
