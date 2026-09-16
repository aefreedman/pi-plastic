import assert from "node:assert/strict";
import { tool } from "../src/tool-definition";
import { loadRegisteredTools } from "./pi-tool-harness";

const node = tool.schema.string();
assert.equal(node.optional().describe("Path").min(1), node, "Fluent schemas retain runtime identity.");
assert.deepEqual(node.metadata, { optional: true, description: "Path", min: 1 });
assert(!("valueType" in node) && !("optionalField" in node), "Type-only carriers must not change schema payloads.");
const example = { description: "Example", args: { path: node }, execute: () => "ok" };
assert.equal(tool(example), example, "The tool helper still returns the original definition.");

const tools = await loadRegisteredTools();
const status = tools.get("plastic_status")!;
assert.equal(status.parameters.properties?.maxItems?.type, "integer");
assert.equal(status.parameters.properties?.maxItems?.minimum, 1);
assert.equal(status.parameters.properties?.maxItems?.maximum, 500);
assert(!status.parameters.required?.includes("maxItems"));
const add = tools.get("plastic_add")!;
assert.equal(add.parameters.properties?.paths?.type, "array");
assert.deepEqual(add.parameters.properties?.paths?.items, { type: "string" });
assert(add.parameters.required?.includes("paths"));
const merge = tools.get("plastic_merge")!;
assert.deepEqual(merge.parameters.properties?.strategy?.anyOf?.map((entry: { const?: unknown }) => entry.const), ["auto", "source", "destination"]);
assert(merge.parameters.required?.includes("source"));
assert(!merge.parameters.required?.includes("strategy"));
console.log("PASS: Plastic schema helper runtime identity and registered metadata");
