import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLASTIC_TOOL_NAMES } from "../src/plastic-tool-loading";
import { getRegisteredPlasticExportNames, PLASTIC_TOOL_REGISTRY, toToolName } from "../src/pi/tool-registry";

const root = fileURLToPath(new URL("../", import.meta.url));
const collect = (directory: string): string[] => readdirSync(resolve(root, directory), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? collect(`${directory}/${entry.name}`) : entry.name.endsWith(".ts") ? [`${directory}/${entry.name}`] : [])
  .sort();
const owners = ["index.ts", ...collect("src"), ...collect("extensions")];
const sources = new Map(owners.map((owner) => [owner, readFileSync(resolve(root, owner), "utf8")]));
const edges = new Map<string, string[]>();
const storageOwners: string[] = [];
const cacheOwners: string[] = [];
const inFlightOwners: string[] = [];
const allowedLayers: Record<string, string[]> = {
  execution: ["execution"],
  domain: ["execution", "domain"],
  diff: ["execution", "domain", "diff"],
  presentation: ["domain", "diff", "presentation"],
  operations: ["execution", "domain", "diff", "presentation", "operations"],
  pi: ["execution", "operations", "pi"],
};
for (const owner of owners) {
  const source = sources.get(owner)!;
  // Source policy check for this source-only package: include static, side-effect,
  // re-export and literal dynamic/type imports (rather than only `from` edges).
  const dependencies = [
    ...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*[^;]*?|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  assert.doesNotMatch(source, /\b(?:import|require)\s*\(\s*[^\s"']/g, `${owner} must use statically inspectable module loads`);
  for (const _ of source.matchAll(/\bnew\s+AsyncLocalStorage\b/g)) storageOwners.push(owner);
  for (const _ of source.matchAll(/\b(?:let|const|var)\s+cachedCmVersion\b/g)) cacheOwners.push(owner);
  for (const _ of source.matchAll(/\b(?:let|const|var)\s+cmVersionPromise\b/g)) inFlightOwners.push(owner);
  const layer = owner.startsWith("src/") ? owner.split("/")[1] : undefined;
  const localEdges: string[] = [];
  for (const dependency of dependencies) {
    if (!dependency.startsWith(".")) {
      if (layer && allowedLayers[layer]) {
        const hostImports = layer === "pi" ? ["typebox", "@earendil-works/pi-coding-agent", ...(["src/pi/status-output.ts", "src/pi/branch-output.ts", "src/pi/branch-list-output.ts", "src/pi/workspace-list-output.ts", "src/pi/shelveset-list-output.ts", "src/pi/code-review-find-output.ts", "src/pi/diff-revisions-output.ts", "src/pi/diff-output.ts", "src/pi/server-merge-output.ts", "src/pi/checkin-output.ts", "src/pi/branch-create-output.ts", "src/pi/switch-output.ts", "src/pi/update-output.ts"].includes(owner) ? ["typebox/value"] : [])] : [];
        assert(dependency.startsWith("node:") || ["path", "os", ...(["src/domain/status-xml.ts", "src/domain/diff-base-xml.ts", "src/domain/diff-pending-xml.ts"].includes(owner) ? ["@xmldom/xmldom"] : []), ...hostImports].includes(dependency), `${owner} must not import unapproved host packages`);
      }
      continue;
    }
    const target = relative(root, resolve(dirname(resolve(root, owner)), dependency.replace(/\.ts$/, "") + ".ts")).replaceAll("\\", "/");
    assert(sources.has(target), `${owner} has an unresolved local dependency: ${dependency}`);
    assert(target !== "src/plastic-core.ts", `${owner} must not import the core facade`);
    if (layer && allowedLayers[layer]) {
      const permitted = owners.filter((candidate) => candidate.startsWith("src/") && allowedLayers[layer].includes(candidate.split("/")[1]));
      if (layer !== "execution") permitted.push("src/plastic-workspace.ts");
      if (["operations", "presentation"].includes(layer)) permitted.push("src/tool-definition.ts");
      // Presentation may retain only the existing dedicated version metadata lookup.
      if (layer === "presentation") permitted.push("src/execution/cli-version.ts");
      if (layer === "pi") permitted.push("src/plastic-tool-loading.ts", "src/plastic-renderers.ts");
      if (owner !== "src/operations/closeout.ts" && layer !== "pi") {
        assert(target !== "src/operations/closeout.ts", `${owner} must not depend on closeout`);
      }
      assert(permitted.includes(target), `${owner} has an upward dependency: ${dependency}`);
    }
    localEdges.push(target);
  }
  if (layer === "pi") assert(!source.includes("import.meta.url"), `${owner} must not derive root provenance from a helper URL`);
  edges.set(owner, [...new Set(localEdges)].sort());
}
const visited = new Set<string>();
const visit = (owner: string, stack: string[]): void => {
  assert(!stack.includes(owner), `Module cycle: ${[...stack, owner].join(" -> ")}`);
  if (visited.has(owner)) return;
  for (const dependency of edges.get(owner) ?? []) visit(dependency, [...stack, owner]);
  visited.add(owner);
};
for (const owner of owners) visit(owner, []);
assert.deepEqual(storageOwners, ["src/execution/context.ts", "src/execution/context.ts"], "Only the shared context may own abort and injected execution storage");
assert.deepEqual(cacheOwners, ["src/execution/cli-version.ts"], "Only the CLI metadata owner may cache versions");
assert.deepEqual(inFlightOwners, ["src/execution/cli-version.ts"], "Only the CLI metadata owner may share in-flight version lookups");
const facade = sources.get("src/plastic-core.ts")!;
assert(facade.split(/\r?\n/).every((line) => !line.trim() || /^export \{ .+ \} from "\.\//.test(line)), "Core must remain an explicit export-only facade");
const entry = sources.get("index.ts")!;
assert.match(entry, /const EXTENSION_SOURCE_PATH = fileURLToPath\(import\.meta\.url\)/, "Canonical provenance must belong to the manifest root");
assert.match(entry, /registerPlasticTools\(pi, EXTENSION_SOURCE_PATH\)/, "Root must pass canonical provenance explicitly");
assert.doesNotMatch(entry, /registerTool|pi\.on|prepareArguments|normalizeArgs|Type\.Object/, "Root must contain wiring, not adapter implementation");
const registered = getRegisteredPlasticExportNames();
assert.deepEqual(registered, Object.keys(PLASTIC_TOOL_REGISTRY), "Registry order must come from the explicit mapping");
assert.deepEqual(registered.map(toToolName).sort(), [...PLASTIC_TOOL_NAMES].sort(), "Registry and loading vocabulary must have exact parity");
assert(!Object.hasOwn(PLASTIC_TOOL_REGISTRY, "workspaceCreate"), "workspaceCreate must remain unregistered");
assert(!PLASTIC_TOOL_NAMES.has("plastic_workspaceCreate"), "workspaceCreate must remain undiscoverable");
console.log(`PASS: ${owners.length} runtime source owners have deterministic acyclic imports, enforced layering, single context/version owners, canonical root wiring and registry parity`);
