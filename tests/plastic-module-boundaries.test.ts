import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const owners = ["execution", "domain"].flatMap((layer) =>
  readdirSync(resolve(root, layer)).filter((file) => file.endsWith(".ts")).map((file) => `${layer}/${file}`));
const edges = new Map<string, string[]>();
for (const owner of owners) {
  const source = readFileSync(resolve(root, owner), "utf8");
  const dependencies = [...source.matchAll(/(?:import|export)\s+[\s\S]*?\sfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
  const localEdges: string[] = [];
  for (const dependency of dependencies) {
    if (!dependency.startsWith(".")) {
      assert(dependency.startsWith("node:") || ["path", "os"].includes(dependency), `${owner} must not import Pi or presentation packages`);
      continue;
    }
    const target = resolve(dirname(resolve(root, owner)), dependency.replace(/\.ts$/, "") + ".ts");
    const permitted = owner.startsWith("execution/")
      ? owners.filter((candidate) => candidate.startsWith("execution/"))
      : [...owners, "plastic-workspace.ts"];
    assert(permitted.some((candidate) => resolve(root, candidate) === target), `${owner} has an upward dependency: ${dependency}`);
    const candidate = owners.find((candidate) => resolve(root, candidate) === target);
    if (candidate) localEdges.push(candidate);
  }
  edges.set(owner, localEdges);
}
const visit = (owner: string, stack: string[]): void => {
  assert(!stack.includes(owner), `Module cycle: ${[...stack, owner].join(" -> ")}`);
  for (const dependency of edges.get(owner) ?? []) visit(dependency, [...stack, owner]);
};
for (const owner of owners) visit(owner, []);
const execution = owners.filter((owner) => owner.startsWith("execution/")).map((owner) => readFileSync(resolve(root, owner), "utf8")).join("\n");
assert.equal((execution.match(/new AsyncLocalStorage/g) ?? []).length, 2, "There must be exactly one abort and one injected execution storage");
assert.equal((execution.match(/let cachedCmVersion/g) ?? []).length, 1, "There must be exactly one CLI version cache owner");
console.log("PASS: Plastic execution/domain layering and acyclic ownership");
