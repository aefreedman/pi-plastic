import assert from "node:assert/strict";
import { loadRegisteredTools } from "./pi-tool-harness.ts";

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
};

const collectOpenAiStrictIssues = (schema: JsonSchema, path = "$", issues: string[] = []): string[] => {
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      issues.push(`${path} must set additionalProperties to false`);
    }

    const propertyNames = Object.keys(schema.properties ?? {});
    const required = new Set(schema.required ?? []);
    for (const propertyName of propertyNames) {
      if (!required.has(propertyName)) {
        issues.push(`${path}.${propertyName} is optional`);
      }
      collectOpenAiStrictIssues(schema.properties![propertyName], `${path}.${propertyName}`, issues);
    }
  }

  if (schema.items) {
    collectOpenAiStrictIssues(schema.items, `${path}[]`, issues);
  }
  for (const [index, variant] of (schema.anyOf ?? []).entries()) {
    collectOpenAiStrictIssues(variant, `${path}.anyOf[${index}]`, issues);
  }

  return issues;
};

const main = async (): Promise<void> => {
  const tools = await loadRegisteredTools();
  const report = [...tools.values()].map((tool) => {
    const schema = tool.parameters as JsonSchema;
    return {
      name: tool.name,
      issues: collectOpenAiStrictIssues(schema),
      constrainedSampling: tool.constrainedSampling,
    };
  });

  assert(report.length > 0, "Expected registered Plastic tools to audit.");

  const optedIn = report.filter((entry) => entry.constrainedSampling !== undefined && entry.constrainedSampling !== false);
  for (const entry of optedIn) {
    if (entry.constrainedSampling && entry.constrainedSampling.type === "json_schema") {
      assert.deepEqual(entry.issues, [], `${entry.name} must be OpenAI strict-schema compatible before opting in`);
    }
  }

  // Pi 0.82 forwards a strict tool's schema without normalizing it. Every current
  // Plastic schema has optional fields (at minimum workdir), and TypeBox objects
  // currently allow unspecified additional properties. Enabling strict sampling
  // would therefore make direct OpenAI requests fail or require a breaking public
  // argument-schema redesign.
  assert.equal(optedIn.length, 0, "No Plastic tool should opt in until its ordinary public schema is strict-compatible.");
  assert.equal(report.filter((entry) => entry.issues.length === 0).length, 0, "The current catalog should be classified as blocked, not strict-ready.");

  for (const pilotName of ["plastic_status", "plastic_branchExists", "plastic_branchCreate"]) {
    const pilot = report.find((entry) => entry.name === pilotName);
    assert(pilot, `Missing pilot tool ${pilotName}`);
    assert(pilot.issues.some((issue) => issue.includes("additionalProperties")), `${pilotName} should report its closed-object blocker`);
    assert(pilot.issues.some((issue) => issue.endsWith("workdir is optional")), `${pilotName} should report its optional workdir blocker`);
  }

  console.log(`PASS: audited ${report.length} Plastic schemas; 0 are currently OpenAI strict-ready`);
};

void main();
