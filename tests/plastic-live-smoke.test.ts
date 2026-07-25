import assert from "node:assert/strict";
import { resolve } from "node:path";
import { invokeRegisteredTool } from "./pi-tool-harness.ts";

type ToolEnvelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
};

const parseToolEnvelope = (text: string): ToolEnvelope => {
  const fencedJson = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(fencedJson, "Expected a structured JSON tool result.");
  return JSON.parse(fencedJson[1]) as ToolEnvelope;
};

const configuredWorkspace = process.env.PI_PLASTIC_TEST_WORKSPACE?.trim();

if (!configuredWorkspace) {
  console.log("SKIP: set PI_PLASTIC_TEST_WORKSPACE to run opt-in Plastic live smoke tests");
  process.exit(0);
}

const workspace = resolve(configuredWorkspace);
const status = parseToolEnvelope(await invokeRegisteredTool("plastic_status", { short: true, format: "json" }, workspace));
assert.equal(status.ok, true, "Expected Plastic status to succeed.");
const summary = status.data?.summary as Record<string, unknown> | undefined;
const mergeState = status.data?.mergeState as Record<string, unknown> | undefined;
assert.equal(summary?.totalPending, 0, "Live smoke tests require a clean workspace.");
assert.equal(mergeState?.hasMergeInProgress, false, "Live smoke tests require no merge in progress.");

const currentBranch = parseToolEnvelope(await invokeRegisteredTool("plastic_currentBranch", { format: "json" }, workspace));
assert.equal(currentBranch.data?.branch, "/main", "Live sandbox must be on /main.");

const mainExists = await invokeRegisteredTool("plastic_branchExists", { branch: "/main" }, workspace);
assert.equal(mainExists.trim(), "true", "Expected plastic_branchExists to find the full /main path.");

console.log("PASS: read-only Plastic live smoke tests passed for the configured sandbox");
