import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const owners = ["execution", "domain", "diff", "presentation", "operations"].flatMap((layer) =>
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
    const layer = owner.split("/")[0];
    const allowedLayers: Record<string, string[]> = {
      execution: ["execution"],
      domain: ["execution", "domain"],
      diff: ["execution", "domain", "diff"],
      presentation: ["execution", "domain", "diff", "presentation"],
      operations: ["execution", "domain", "diff", "presentation", "operations"],
    };
    const permitted = owners.filter((candidate) => allowedLayers[layer].includes(candidate.split("/")[0]));
    if (layer !== "execution") permitted.push("plastic-workspace.ts");
    if (["operations", "presentation"].includes(layer)) permitted.push("tool-definition.ts");
    if (owner !== "operations/closeout.ts") {
      assert(target !== resolve(root, "operations/closeout.ts"), `${owner} must not depend on closeout`);
    }
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
const facade = readFileSync(resolve(root, "plastic-core.ts"), "utf8");
assert(facade.split(/\r?\n/).every((line) => !line.trim() || /^export \{ .+ \} from "\.\//.test(line)), "Core must remain an explicit export-only facade");
console.log("PASS: Plastic execution/domain/diff/presentation/operations layering, facade and acyclic ownership");
