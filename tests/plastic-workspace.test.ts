import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverPlasticWorkspace,
  parsePlasticSelector,
  parsePlasticStatusBranch,
  sanitizePlasticBranch,
} from "../src/plastic-workspace.ts";

const fixture = async (name: string): Promise<string> => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const root = await mkdtemp(join(tmpdir(), "pi-plastic-workspace-"));
try {
  const outer = join(root, "outer");
  const inner = join(outer, "nested", "inner");
  const cwd = join(inner, "src", "feature");
  await mkdir(join(outer, ".plastic"), { recursive: true });
  await writeFile(join(outer, ".plastic", "plastic.workspace"), "sanitized workspace marker\n");
  await mkdir(join(inner, ".plastic"), { recursive: true });
  await writeFile(join(inner, ".plastic", "plastic.workspace"), "nested sanitized marker\n");
  await mkdir(cwd, { recursive: true });

  const nested = await discoverPlasticWorkspace(cwd);
  assert.equal(nested.kind, "found");
  if (nested.kind === "found") assert.equal(nested.value.root, inner);

  await rm(join(inner, ".plastic", "plastic.workspace"));
  const outerResult = await discoverPlasticWorkspace(cwd);
  assert.equal(outerResult.kind, "found");
  if (outerResult.kind === "found") assert.equal(outerResult.value.root, outer);

  const gitOnly = join(root, "git-only", ".git");
  await mkdir(gitOnly, { recursive: true });
  assert.equal((await discoverPlasticWorkspace(join(root, "git-only"))).kind, "not_found");

  const selector = parsePlasticSelector(await fixture("plastic.selector"));
  assert.deepEqual(selector, {
    kind: "found",
    value: { repository: "sanitized-repository@sanitized-server", branch: "/main/feature/footer" },
  });
  assert.equal(parsePlasticSelector("repository sample@server\n  path /\n").kind, "not_found");
  assert.equal(parsePlasticSelector("smartbranch \n").kind, "malformed");
  assert.equal(parsePlasticSelector("smartbranch /main/bad\u0007branch\n").kind, "malformed");

  const normal = parsePlasticStatusBranch(await fixture("status-normal.txt"));
  const compact = parsePlasticStatusBranch(await fixture("status-compact.txt"));
  assert.deepEqual(normal, { kind: "found", value: { branch: "/main/feature/footer" } });
  assert.deepEqual(compact, normal, "normal and compact status forms should yield the same branch path");
  assert.deepEqual(parsePlasticStatusBranch("status cs:731\n"), { kind: "found", value: { changesetId: "731" } });
  assert.equal(parsePlasticStatusBranch("unexpected output\n").kind, "malformed");
  assert.equal(parsePlasticStatusBranch("\n").kind, "not_found");

  assert.equal(sanitizePlasticBranch(" /main/feature\u0007  footer "), "/main/feature footer");
  assert.equal(sanitizePlasticBranch("x".repeat(81)), `${"x".repeat(79)}…`);
  assert.equal(sanitizePlasticBranch("界".repeat(41)), `${"界".repeat(39)}…`);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("PASS: Plastic workspace discovery and parser tests passed");
