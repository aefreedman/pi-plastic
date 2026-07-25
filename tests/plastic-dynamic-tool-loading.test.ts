import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PiToolHarness, type RegisteredTool, type ToolSourceInfo } from "./pi-tool-harness.ts";
import {
  BALANCED_ACTIVE_PLASTIC_TOOL_NAMES,
  PLASTIC_SEARCH_CATALOG,
  PLASTIC_TOOL_LOADING_MODE_ENV,
  PLASTIC_TOOL_NAMES,
  PLASTIC_TOOL_SEARCH_NAME,
  searchPlasticTools,
} from "../src/plastic-tool-loading.ts";

const publicToolNames = [...PLASTIC_TOOL_NAMES];
const foreignSource: ToolSourceInfo = { path: "/extensions/foreign.ts", source: "extension", scope: "project", origin: "package" };

async function withMode<T>(mode: string | undefined, action: () => Promise<T>): Promise<T> {
  const previous = process.env[PLASTIC_TOOL_LOADING_MODE_ENV];
  if (mode === undefined) delete process.env[PLASTIC_TOOL_LOADING_MODE_ENV];
  else process.env[PLASTIC_TOOL_LOADING_MODE_ENV] = mode;
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env[PLASTIC_TOOL_LOADING_MODE_ENV];
    else process.env[PLASTIC_TOOL_LOADING_MODE_ENV] = previous;
  }
}

async function loadHarness(activeTools: string[], branchEntries: unknown[] = [], options: ConstructorParameters<typeof PiToolHarness>[0] = {}): Promise<PiToolHarness> {
  const harness = new PiToolHarness({ activeTools, branchEntries, ...options });
  await harness.load();
  await harness.startSession();
  return harness;
}

async function main(): Promise<void> {
  await withMode(undefined, async () => {
    const harness = await loadHarness(["read", "foreign_tool", ...publicToolNames]);
    assert.equal(harness.registry.size, 30, "all 29 compatibility Plastic tools plus the loader should be registered");
    assert(harness.registry.has(PLASTIC_TOOL_SEARCH_NAME));
    assert.deepEqual(new Set(harness.getActiveTools()), new Set(["read", "foreign_tool", PLASTIC_TOOL_SEARCH_NAME, ...BALANCED_ACTIVE_PLASTIC_TOOL_NAMES]));
  });

  await withMode("loader-only", async () => {
    const harness = await loadHarness(["read", "foreign_tool", ...publicToolNames]);
    assert.deepEqual(new Set(harness.getActiveTools()), new Set(["read", "foreign_tool", PLASTIC_TOOL_SEARCH_NAME]));
  });

  await withMode("all-active", async () => {
    const harness = await loadHarness(["read", "foreign_tool", ...publicToolNames]);
    assert.deepEqual(new Set(harness.getActiveTools()), new Set(["read", "foreign_tool", ...publicToolNames]), "all-active should reproduce the legacy 29-tool surface without the new loader");
  });

  await withMode("balanced", async () => {
    const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
    const relativeSource: ToolSourceInfo = {
      path: "./index.ts",
      source: "local",
      scope: "project",
      origin: "cli",
      baseDir: dirname(extensionPath),
    };
    const harness = await loadHarness(["read", ...publicToolNames], [], { extensionSourceInfo: relativeSource });
    assert.deepEqual(new Set(harness.getActiveTools()), new Set(["read", PLASTIC_TOOL_SEARCH_NAME, ...BALANCED_ACTIVE_PLASTIC_TOOL_NAMES]), "relative configured extension paths should resolve to the package-owned source");
    const result = await harness.registry.get(PLASTIC_TOOL_SEARCH_NAME)!.execute("loader", { toolNames: ["plastic_branchList"] });
    assert.deepEqual(result.details.added, ["plastic_branchList"], "relative-path provenance should still allow deferred activation");
  });

  assert.deepEqual(searchPlasticTools({ toolNames: ["plastic_branchDelete"] }).map((match) => match.name), ["plastic_branchDelete"], "exact public names should select one known tool");
  assert(searchPlasticTools({ query: "shelveset" }).every((match) => match.name.includes("shelveset")), "keyword search should find the requested capability");
  assert.equal(searchPlasticTools({ query: "branch", limit: 99 }).length, 4, "search results should have a hard upper bound");
  assert.deepEqual(searchPlasticTools({ query: "branch", limit: 3 }).map((match) => match.name), ["plastic_branchList", "plastic_branchExists", "plastic_currentBranch"], "ambiguous branch searches should prioritize inspection and query tools when multiple results are requested");
  assert.deepEqual(searchPlasticTools({ query: "list available branches" }).map((match) => match.name), ["plastic_branchList"], "multi-term branch discovery should not activate unrelated list tools");
  assert.deepEqual(searchPlasticTools({ query: "list branches in a specified workspace read-only", limit: 1 }).map((match) => match.name), ["plastic_branchList"], "the first capability domain should outrank incidental workspace context");
  assert.deepEqual(searchPlasticTools({ query: "find existing code reviews" }).map((match) => match.name), ["plastic_codeReviewFind"], "contextual review discovery should select the smallest sufficient query tool");
  const diffMatches = searchPlasticTools({ query: "diff" }).map((match) => match.name);
  assert(!diffMatches.includes("plastic_diff"), "the disabled compatibility diff alias must never be executable through search");
  assert.deepEqual(diffMatches.slice(0, 2), ["plastic_diffRevisions", "plastic_diffFile"], "generic diff searches should prefer safe text-only alternatives");
  assert.deepEqual(searchPlasticTools({ toolNames: ["plastic_diff"] }).map((match) => match.name), [], "the disabled diff alias must not be exactly selectable");
  assert.deepEqual(searchPlasticTools({ toolNames: ["foreign_tool"] }).map((match) => match.name), [], "unknown names must not be selectable");
  assert.equal(searchPlasticTools({ toolNames: ["plastic_branchDelete", "plastic_branchCreate", "plastic_branchList", "plastic_currentBranch"] }).length, 4, "up to four exact names should all be selected when no limit is supplied");

  await withMode("loader-only", async () => {
    const harness = await loadHarness(["read", "foreign_tool"]);
    const loader = harness.registry.get(PLASTIC_TOOL_SEARCH_NAME)!;

    const browseCallsBefore = harness.setActiveToolsCalls.length;
    for (const query of [undefined, "Unity Version Control", "version control", "UVCS", "VCS"]) {
      const browse = await loader.execute("loader", query === undefined ? {} : { query });
      assert.equal(browse.details.browse, true, `${String(query)} should provide a browse response`);
      assert.match(browse.content[0].text, /Browse Plastic capabilities/, "browse output should give concise recovery categories");
    }
    assert.equal(harness.setActiveToolsCalls.length, browseCallsBefore, "browse and recovery responses must not activate tools");

    const setCallsBefore = harness.setActiveToolsCalls.length;
    const result = await loader.execute("loader", { toolNames: ["plastic_branchDelete", "plastic_branchCreate", "plastic_branchList", "plastic_currentBranch"] });
    assert.equal(result.details.added.length, 4, "all requested exact tools should activate by default");
    assert(harness.getActiveTools().includes("read") && harness.getActiveTools().includes("foreign_tool"), "activation must preserve foreign tools");
    assert.equal(harness.setActiveToolsCalls.length, setCallsBefore + 1, "new matches should be activated once");
    assert.match(result.content[0].text, /Confirm the full branch path/, "loader results should return selected safety guidance");

    const repeatCallsBefore = harness.setActiveToolsCalls.length;
    const repeat = await loader.execute("loader", { toolNames: ["plastic_branchDelete"] });
    assert.deepEqual(repeat.details.alreadyActive, ["plastic_branchDelete"]);
    assert.equal(harness.setActiveToolsCalls.length, repeatCallsBefore, "already-active matches must not replace the active set");

    const noMatchCallsBefore = harness.setActiveToolsCalls.length;
    const noMatch = await loader.execute("loader", { toolNames: ["unknown_tool"] });
    assert.deepEqual(noMatch.details.matches, []);
    assert.deepEqual(noMatch.details.unknownToolNames, ["unknown_tool"]);
    assert.match(noMatch.content[0].text, /unknown_tool/, "unknown exact requests must be reported clearly");
    assert.equal(harness.setActiveToolsCalls.length, noMatchCallsBefore, "no-match searches must not change active tools");

    const disabledDiff = await loader.execute("loader", { toolNames: ["plastic_diff"] });
    assert.deepEqual(disabledDiff.details.matches, []);
    assert.deepEqual(disabledDiff.details.unavailableToolNames, ["plastic_diff"], "the compatibility diff alias must be reported as unavailable rather than activated");
  });

  await withMode("loader-only", async () => {
    const activeBranch = [
      { type: "message", message: { role: "toolResult", addedToolNames: ["plastic_diff", "plastic_merge", "plastic_branchList", "foreign_tool", "removed_tool"] } },
    ];
    const harness = await loadHarness(["read", "foreign_tool", ...publicToolNames], activeBranch);
    assert(harness.getActiveTools().includes("plastic_diff"), "the disabled compatibility diff alias should remain restorable from active history");
    assert(harness.getActiveTools().includes("plastic_merge") && harness.getActiveTools().includes("plastic_branchList"), "valid active-branch loader additions should be restored");
    assert(!harness.getActiveTools().includes("removed_tool"), "unknown historical names must not be restored");
    assert(harness.getActiveTools().includes("foreign_tool"), "foreign active tools must survive restoration");
  });

  await withMode("loader-only", async () => {
    const foreignBranchCreate: RegisteredTool = {
      name: "plastic_branchCreate",
      label: "Foreign branch create",
      description: "Foreign collision",
      sourceInfo: foreignSource,
      execute: () => ({}),
    };
    const harness = await loadHarness(["read", "plastic_branchCreate"], [], { sourceInfoAvailable: true, foreignTools: [foreignBranchCreate] });
    assert(harness.getActiveTools().includes("plastic_branchCreate"), "sourceInfo ownership must preserve a name-colliding foreign active tool");

    const loader = harness.registry.get(PLASTIC_TOOL_SEARCH_NAME)!;
    const callsBefore = harness.setActiveToolsCalls.length;
    const collision = await loader.execute("loader", { toolNames: ["plastic_branchCreate", "plastic_branchList"] });
    assert.deepEqual(collision.details.added, ["plastic_branchList"], "only the same-source effective tool may be activated");
    assert.deepEqual(collision.details.unavailableToolNames, ["plastic_branchCreate"], "foreign collisions should be reported as unavailable from this extension");
    assert.equal(harness.setActiveToolsCalls.length, callsBefore + 1);

    const restoredHarness = await loadHarness(["read"], [
      { type: "message", message: { role: "toolResult", addedToolNames: ["plastic_branchCreate", "plastic_branchList"] } },
    ], { sourceInfoAvailable: true, foreignTools: [foreignBranchCreate] });
    assert(!restoredHarness.getActiveTools().includes("plastic_branchCreate"), "foreign same-name tools must not be restored from this loader's history");
    assert(restoredHarness.getActiveTools().includes("plastic_branchList"), "same-source historical loader additions should still restore");
  });

  await withMode("loader-only", async () => {
    const compatibilityHarness = await loadHarness(["read", ...publicToolNames], [], { sourceInfoAvailable: false });
    assert.deepEqual(
      compatibilityHarness.getActiveTools(),
      ["read", ...publicToolNames],
      "without sourceInfo, loader-only mode must preserve the active legacy set exactly",
    );
    assert.equal(compatibilityHarness.setActiveToolsCalls.length, 0, "unproven loader ownership must not rewrite the active set");

    const foreignBranchCreate: RegisteredTool = {
      name: "plastic_branchCreate",
      label: "Foreign branch create without provenance",
      description: "Foreign collision",
      sourceInfo: foreignSource,
      execute: () => ({}),
    };
    const initiallyActive = ["read", "foreign_tool", PLASTIC_TOOL_SEARCH_NAME, "plastic_status", "plastic_branchCreate"];
    const harness = await loadHarness(initiallyActive, [], { sourceInfoAvailable: false, foreignTools: [foreignBranchCreate] });
    assert.deepEqual(harness.getActiveTools(), initiallyActive, "without sourceInfo, startup must preserve every active Plastic-named tool");
    assert.equal(harness.setActiveToolsCalls.length, 0, "without sourceInfo, startup must not defer or otherwise rewrite the active set when the loader is already active");

    const loader = harness.registry.get(PLASTIC_TOOL_SEARCH_NAME)!;
    const collision = await loader.execute("loader", { toolNames: ["plastic_branchCreate", "plastic_branchList"] });
    assert.deepEqual(collision.details.matches, ["plastic_branchCreate"], "without provenance, the loader may report only already-active known matches");
    assert.deepEqual(collision.details.added, [], "without provenance, the loader must not activate inactive Plastic names");
    assert.deepEqual(collision.details.unavailableToolNames, ["plastic_branchList"]);
    assert.deepEqual(harness.getActiveTools(), initiallyActive, "a foreign colliding plastic_* tool must not cause deactivation or activation without sourceInfo");
    assert.equal(harness.setActiveToolsCalls.length, 0, "a no-sourceInfo loader request must not change the active set");
  });

  for (const mode of ["loader-only", "all-active"] as const) await withMode(mode, async () => {
    const foreignLoader: RegisteredTool = {
      name: PLASTIC_TOOL_SEARCH_NAME,
      label: "Foreign Plastic loader",
      description: "Foreign collision",
      sourceInfo: foreignSource,
      execute: () => ({}),
    };
    const foreignBranchList: RegisteredTool = {
      name: "plastic_branchList",
      label: "Foreign branch list",
      description: "Foreign collision from the same source as the foreign loader",
      sourceInfo: foreignSource,
      execute: () => ({}),
    };
    const active = ["read", PLASTIC_TOOL_SEARCH_NAME, "plastic_branchList", "plastic_status"];
    const harness = await loadHarness(active, [], { sourceInfoAvailable: true, foreignTools: [foreignLoader, foreignBranchList] });
    assert.deepEqual(harness.getActiveTools(), active, `${mode} must preserve an active foreign loader and same-source Plastic collision`);
    assert.equal(harness.setActiveToolsCalls.length, 0, `${mode} must not rewrite tools when this extension does not own the effective loader`);
  });

  await withMode("loader-only", async () => {
    const harness = await loadHarness(["read"]);
    for (const name of PLASTIC_SEARCH_CATALOG.map((entry) => entry.name)) {
      const tool = harness.registry.get(name)!;
      assert.equal(tool.promptSnippet, undefined, `${name} should not rebuild the prompt after deferred activation`);
      assert.equal(tool.promptGuidelines, undefined, `${name} should not add deferred prompt guidance`);
    }
    assert(harness.registry.get(PLASTIC_TOOL_SEARCH_NAME)?.promptSnippet, "the always-active loader should explain discovery");
    assert(harness.registry.get(PLASTIC_TOOL_SEARCH_NAME)?.promptGuidelines?.length, "the always-active loader should retain universal safety guidance");
  });

  console.log("PASS: plastic dynamic tool loading test succeeded");
}

void main();
