import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { isRegistryError } from "@aefree/pi-capability-registry";
import { createRepositoryPolicyRegistryV1, REPOSITORY_POLICY_REGISTRY_KEY_V1 } from "@aefree/pi-repo-search/contracts/v1";
import { createPlasticRepositorySearchPolicyV1, loadPlasticOwnerV1 } from "../src/repository-search-provider.ts";

const temp = await mkdtemp(path.join(tmpdir(), "pi-plastic-packed-copies-"));
try {
  const npmCli = process.env.npm_execpath ?? (process.platform === "win32" ? path.join(process.env.APPDATA!, "npm", "node_modules", "npm", "bin", "npm-cli.js") : "/usr/lib/node_modules/npm/bin/npm-cli.js");
  const packed = spawnSync(process.execPath, [npmCli, "pack", "--json", "--pack-destination", temp], { cwd: path.join(import.meta.dirname, ".."), encoding: "utf8", shell: false });
  assert.equal(packed.status, 0, packed.stderr);
  const filename = JSON.parse(packed.stdout)[0].filename as string;
  const first = path.join(temp, "first"); const second = path.join(temp, "second");
  await mkdir(first); await mkdir(second);
  for (const destination of [first, second]) {
    const extracted = spawnSync("tar", ["-xf", filename, "-C", path.basename(destination), "package/package.json", "package/extensions/repository-search-provider.ts"], { cwd: temp, encoding: "utf8", shell: false });
    assert.equal(extracted.status, 0, extracted.stderr);
  }
  const entry = (root: string) => pathToFileURL(path.join(root, "package", "extensions", "repository-search-provider.ts")).href;
  const ownerOne = await loadPlasticOwnerV1(entry(first));
  const ownerTwo = await loadPlasticOwnerV1(entry(second));
  assert.notEqual(ownerOne.packageRoot, ownerTwo.packageRoot);
  assert.equal(ownerOne.packageVersion, ownerTwo.packageVersion);
  const scope = {};
  createRepositoryPolicyRegistryV1().register(scope, createPlasticRepositorySearchPolicyV1(ownerOne));
  assert.throws(() => createRepositoryPolicyRegistryV1().register(scope, createPlasticRepositorySearchPolicyV1(ownerTwo)), (error) => isRegistryError(error, "PROVIDER_ID_CONFLICT"));
  delete globalThis[Symbol.for(REPOSITORY_POLICY_REGISTRY_KEY_V1)];
} finally { await rm(temp, { recursive: true, force: true }); }
console.log("PASS: two packed physical pi-plastic copies retain distinct roots and conflict");
