import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertRepositoryPolicyConformanceV1 } from "@aefree/pi-repo-search/contracts/v1/conformance";
import { assertWorkflowProviderConformanceV1 } from "@aefree/pi-workflow/contracts/v1/conformance";
import { createPlasticRepositorySearchPolicyV1, createPlasticWorkflowProviderV1, loadPlasticOwnerV1 } from "../src/repository-search-provider.ts";

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
  const ready = async () => ({ outcome: "ready" as const });
  const provider = createPlasticWorkflowProviderV1(owner, { checkCmReadiness: ready });
  const detected = await provider.detect({ cwd: root, signal: new AbortController().signal }, { targetPath: source, operation: "read", signal: new AbortController().signal });
  assert.equal(detected.outcome, "match");
  if (detected.outcome === "match") assert.equal(detected.workspaceRoot, plastic, "marker ownership must not depend on cm readiness");
  assert.deepEqual(await provider.detect({ cwd: root, signal: new AbortController().signal }, { targetPath: gitOnly, operation: "read", signal: new AbortController().signal }), { outcome: "no_match" });
  const unavailable = await provider.detect({ cwd: root, signal: new AbortController().signal }, { targetPath: join(root, "missing"), operation: "read", signal: new AbortController().signal });
  assert.equal(unavailable.outcome, "unavailable", "missing/indeterminate marker probes must not become no_match");

  // Frozen conformance helpers also prove cancellation/fresh context behavior with a fake marker fixture.
  const fixturePolicy = createPlasticRepositorySearchPolicyV1(owner);
  await assertRepositoryPolicyConformanceV1({ createPolicy: () => fixturePolicy, applicableRequest: { workspaceRoot: plastic, roots: [plastic] }, nonApplicableRequest: { workspaceRoot: gitOnly, roots: [gitOnly] } });
  await assertWorkflowProviderConformanceV1({ createProvider: () => createPlasticWorkflowProviderV1(owner, { checkCmReadiness: ready }), matchingTarget: source, nonMatchingTarget: gitOnly, guidanceResourceId: "vcs-workflow" });

  const originalCm = process.env.PI_PLASTIC_CM_EXECUTABLE;
  try {
    process.env.PI_PLASTIC_CM_EXECUTABLE = join(root, "definitely-missing-cm.exe");
    const missingCm = createPlasticWorkflowProviderV1(owner);
    assert.deepEqual(await missingCm.preflight?.({ cwd: root, signal: new AbortController().signal }, { targetPath: source, workspaceRoot: plastic, operation: "read", signal: new AbortController().signal }), { outcome: "blocked", code: "plastic_cm_missing", retryable: false });

    await writeFile(join(plastic, "status"), "setInterval(() => {}, 1000);\n");
    process.env.PI_PLASTIC_CM_EXECUTABLE = process.execPath;
    const controller = new AbortController();
    const cancellable = createPlasticWorkflowProviderV1(owner).preflight?.({ cwd: root, signal: controller.signal }, { targetPath: source, workspaceRoot: plastic, operation: "read", signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(cancellable, (error: unknown) => error instanceof Error && error.name === "AbortError");
  } finally {
    if (originalCm === undefined) delete process.env.PI_PLASTIC_CM_EXECUTABLE; else process.env.PI_PLASTIC_CM_EXECUTABLE = originalCm;
  }
  assert.deepEqual(await provider.preflight?.({ cwd: root, signal: new AbortController().signal }, { targetPath: source, workspaceRoot: root, operation: "read", signal: new AbortController().signal }), { outcome: "blocked", code: "plastic_workspace_changed", retryable: true });
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS: Plastic repository-search and VCS providers");
