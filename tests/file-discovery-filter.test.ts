import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createPlasticFileDiscoveryFilterV1, loadPlasticOwnerV1, PLASTIC_IGNORE_FILES_APPLIED_CODE } from "../src/file-discovery-filter.ts";

const root = await mkdtemp(join(tmpdir(), "pi-plastic-file-discovery-filter-"));
try {
  const plastic = join(root, "plastic"); const source = join(plastic, "Assets", "Code"); const noIgnorePlastic = join(root, "no-ignore-plastic"); const gitOnly = join(root, "git-only");
  await mkdir(join(plastic, ".plastic"), { recursive: true }); await writeFile(join(plastic, ".plastic", "plastic.workspace"), "fixture");
  await mkdir(source, { recursive: true }); await writeFile(join(plastic, "ignore.conf"), "ignored.txt\n"); await writeFile(join(plastic, "Assets", "cloaked.conf"), "cache/**\n");
  await mkdir(join(gitOnly, ".git"), { recursive: true });
  const owner = await loadPlasticOwnerV1(new URL("../extensions/file-discovery-filter.ts", import.meta.url).href);
  const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(owner.packageVersion, packageManifest.version);
  assert.equal(owner.packageRoot, await realpath(join(import.meta.dirname, "..")));
  const filter = createPlasticFileDiscoveryFilterV1(owner);
  const canonicalPlastic = await realpath(plastic);
  const result = await filter.evaluate({ cwd: root, signal: new AbortController().signal }, { workspaceRoot: root, roots: [source], includeHidden: false, signal: new AbortController().signal });
  assert.equal(result.outcome, "applied");
  if (result.outcome === "applied") {
    assert.equal(result.roots[0]?.filterDecision, "applied");
    assert.equal(result.roots[0]?.decisionCode, PLASTIC_IGNORE_FILES_APPLIED_CODE);
    assert.equal(result.roots[0]?.filterBoundary, canonicalPlastic);
    assert.deepEqual(result.roots[0]?.ignoreFiles.map((file) => relative(canonicalPlastic, file).replaceAll("\\", "/")), ["ignore.conf", "Assets/cloaked.conf"]);
    assert.match(result.roots[0]?.disclosures[0] ?? "", /filter applied.*readable files/i);
  }

  await mkdir(join(noIgnorePlastic, ".plastic"), { recursive: true }); await writeFile(join(noIgnorePlastic, ".plastic", "plastic.workspace"), "fixture");
  const noIgnoreResult = await filter.evaluate({ cwd: root, signal: new AbortController().signal }, { workspaceRoot: root, roots: [noIgnorePlastic], includeHidden: false, signal: new AbortController().signal });
  assert.equal(noIgnoreResult.outcome, "not_applicable", "A Plastic root without readable ignore/cloak files must not emit a no-op applied record.");
  assert.equal("roots" in noIgnoreResult, false, "A not_applicable result must not include an applied record.");

  const mixedResult = await filter.evaluate({ cwd: root, signal: new AbortController().signal }, { workspaceRoot: root, roots: [source, noIgnorePlastic, gitOnly], includeHidden: false, signal: new AbortController().signal });
  assert.equal(mixedResult.outcome, "applied");
  if (mixedResult.outcome === "applied") {
    assert.equal(mixedResult.roots.length, 1, "Mixed requests must omit no-op roots.");
    assert.equal(mixedResult.roots[0]?.root, await realpath(source));
    assert.equal(mixedResult.roots[0]?.filterDecision, "applied");
  }

  const nonApplicable = await filter.evaluate({ cwd: root, signal: new AbortController().signal }, { workspaceRoot: root, roots: [gitOnly], includeHidden: false, signal: new AbortController().signal });
  assert.equal(nonApplicable.outcome, "not_applicable");
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS: Plastic advisory file-discovery filter");
