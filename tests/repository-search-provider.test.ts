import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertRepositoryPolicyConformanceV1 } from "@aefree/pi-repo-search/contracts/v1/conformance";
import { createPlasticRepositorySearchPolicyV1, loadPlasticOwnerV1 } from "../src/repository-search-provider.ts";

const root = await mkdtemp(join(tmpdir(), "pi-plastic-repo-policy-"));
try {
  const plastic = join(root, "plastic"); const source = join(plastic, "Assets", "Code"); const gitOnly = join(root, "git-only");
  await mkdir(join(plastic, ".plastic"), { recursive: true }); await writeFile(join(plastic, ".plastic", "plastic.workspace"), "fixture");
  await mkdir(source, { recursive: true }); await writeFile(join(plastic, "ignore.conf"), "ignored.txt\n"); await writeFile(join(plastic, "Assets", "cloaked.conf"), "cache/**\n");
  await mkdir(join(gitOnly, ".git"), { recursive: true });
  const owner = await loadPlasticOwnerV1(new URL("../extensions/repository-search-provider.ts", import.meta.url).href);
  assert.equal(owner.packageVersion, "0.3.0");
  assert.equal(owner.packageRoot, await realpath(join(import.meta.dirname, "..")));
  const policy = createPlasticRepositorySearchPolicyV1(owner);
  const result = await policy.evaluate({ cwd: root, signal: new AbortController().signal }, { workspaceRoot: root, roots: [source], includeHidden: false, signal: new AbortController().signal });
  assert.equal(result.outcome, "applied");
  if (result.outcome === "applied") {
    assert.equal(result.roots[0]?.policyOwnedRoot, plastic);
    assert.deepEqual(result.roots[0]?.ignoreFiles.map((file) => file.slice(plastic.length + 1).replaceAll("\\", "/")), ["ignore.conf", "Assets/cloaked.conf"]);
  }

  // Frozen conformance helpers also prove cancellation/fresh context behavior with a marker fixture.
  await assertRepositoryPolicyConformanceV1({ createPolicy: () => createPlasticRepositorySearchPolicyV1(owner), applicableRequest: { workspaceRoot: plastic, roots: [plastic] }, nonApplicableRequest: { workspaceRoot: gitOnly, roots: [gitOnly] } });
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS: Plastic repository-search policy");
