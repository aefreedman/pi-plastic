import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness.ts";
import { runWithAbortSignal } from "../src/execution/context.ts";

export type NativeResult = { args: string[]; status: number | null; stdout: string; stderr: string; error: string | null };
export type LiveState = { branch: string; changeset: string; pendingPaths: string[]; standard: string; markers: NativeResult };
export function configuredLiveWorkspace(mutation = false): string | null {
  const configured = process.env.PI_PLASTIC_TEST_WORKSPACE?.trim();
  if (!configured) return null;
  assert(isAbsolute(configured), "PI_PLASTIC_TEST_WORKSPACE must be absolute; do not infer a production workspace.");
  if (mutation) {
    assert.equal(process.env.PI_PLASTIC_ALLOW_MUTATION_TESTS, "true", "Mutation suite requires PI_PLASTIC_ALLOW_MUTATION_TESTS=true.");
    assert.equal(process.env.PI_PLASTIC_SANDBOX_ATTESTATION, "disposable-synthetic-only", "Attest that this exact sandbox contains disposable synthetic content only.");
  }
  return realpathSync(configured);
}
export function parseLiveXml(text: string) {
  const diagnostics: string[] = [];
  assert(!/<!DOCTYPE|<!ENTITY/i.test(text), "Independent CLI XML must not declare entities or a document type.");
  const document = new DOMParser({ onError: (_level, message) => diagnostics.push(message) }).parseFromString(text, "application/xml");
  assert(document && !document.doctype && diagnostics.length === 0, "Independent CLI XML must be well formed.");
  return document;
}
export function xmlTexts(document: ReturnType<typeof parseLiveXml>, tag: string): string[] {
  return Array.from(document.getElementsByTagName(tag)).map(node => node.textContent ?? "");
}
export function nativeXmlPendingPaths(document: ReturnType<typeof parseLiveXml>): string[] {
  assert.equal(document.documentElement?.tagName, "StatusOutput", "Not a native workspace status XML document.");
  // This independent guard validates the envelope before absence of Changes can
  // mean empty. A renamed/nested future inventory must never authorize mutation.
  const children = (element: Element, allowed: readonly string[]): Map<string, Element> => {
    const entries = new Map<string, Element>();
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 1) {
        const child = node as Element;
        assert(allowed.includes(child.tagName) && !entries.has(child.tagName), "Unknown or duplicate independent XML element.");
        entries.set(child.tagName, child);
      } else assert(node.nodeType === 8 || !node.nodeValue?.trim(), "Unexpected independent XML text.");
    }
    return entries;
  };
  const leaf = (element: Element | undefined): string => {
    assert(element && element.getElementsByTagName("*").length === 0, "Missing or nested independent XML scalar.");
    return element.textContent ?? "";
  };
  const envelope = children(document.documentElement, ["WorkspaceStatus", "WkConfigType", "WkConfigName", "Changes"]);
  const workspace = envelope.get("WorkspaceStatus");
  assert(workspace, "Independent XML workspace identity is missing.");
  const status = children(workspace, ["Status"]).get("Status");
  assert(status, "Independent XML status identity is missing.");
  const context = children(status, ["RepSpec", "Changeset"]), repository = context.get("RepSpec");
  assert(repository && /^(0|[1-9][0-9]*)$/.test(leaf(context.get("Changeset"))), "Independent XML changeset identity is invalid.");
  const spec = children(repository, ["Server", "Name"]);
  assert(leaf(spec.get("Server")) && leaf(spec.get("Name")) && leaf(envelope.get("WkConfigType")) && leaf(envelope.get("WkConfigName")), "Independent XML workspace metadata is incomplete.");
  const container = envelope.get("Changes");
  if (!container) return [];
  const paths: string[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType !== 1) { assert(node.nodeType === 8 || !node.nodeValue?.trim(), "Unexpected independent pending text."); continue; }
    assert.equal(node.nodeName, "Change", "Unknown independent pending element must not imply clean state.");
    const fields = children(node as Element, ["Type", "TypeVerbose", "Path", "OldPath", "PrintableMovedPath", "MergesInfo", "SimilarityPerUnit", "Similarity", "Size", "PrintableSize", "PrintableLastModified", "RevisionType", "LastModified"]);
    for (const field of fields.values()) leaf(field);
    const path = leaf(fields.get("Path")), type = leaf(fields.get("Type"));
    assert(path && type, "Independent XML pending row is incomplete.");
    paths.push(path);
  }
  return paths;
}
export class PlasticLiveHarness {
  readonly runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}`;
  readonly evidenceDirectory: string;
  readonly outcomes: Array<{ name: string; outcome: "passed" | "failed"; detail: string }> = [];
  readonly toolCommands: Array<{ tool: string; args: string[]; cwd: string }> = [];
  private constructor(readonly workspace: string, readonly tools: Awaited<ReturnType<typeof loadRegisteredTools>>, evidenceDirectory: string) {
    this.evidenceDirectory = evidenceDirectory;
  }
  static async create(workspace: string): Promise<PlasticLiveHarness> {
    const configuredEvidence = process.env.PI_PLASTIC_LIVE_EVIDENCE_DIR?.trim();
    const directory = configuredEvidence ? resolve(configuredEvidence) : mkdtempSync(join(tmpdir(), "pi-plastic-live-"));
    // Raw evidence can contain private server coordinates; it never belongs in a
    // source checkout, the controlled workspace, or an npm tarball.
    const packageRoot = resolve(import.meta.dirname, "..");
    for (const root of [packageRoot, workspace]) {
      const rel = relative(root, directory);
      assert(rel.startsWith("..") || isAbsolute(rel), "Live evidence directory must be outside package and sandbox.");
    }
    mkdirSync(directory, { recursive: true });
    const tools = await loadRegisteredTools();
    for (const tool of tools.values()) {
      assert.equal(realpathSync(tool.sourceInfo!.path), realpathSync(join(packageRoot, "index.ts")), "Live tools must be registered from this exact source checkout.");
    }
    const harness = new PlasticLiveHarness(workspace, tools, directory);
    harness.record("source", { packageRoot, head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: packageRoot, encoding: "utf8" }).stdout.trim(), dirty: spawnSync("git", ["status", "--short"], { cwd: packageRoot, encoding: "utf8" }).stdout });
    return harness;
  }
  record(kind: string, value: unknown) {
    appendFileSync(join(this.evidenceDirectory, "observations.jsonl"), JSON.stringify({ time: new Date().toISOString(), runId: this.runId, kind, value }) + "\n");
  }
  native(args: string[], allowNonzero = false): NativeResult {
    const child = spawnSync("cm", args, { cwd: this.workspace, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    const observation = { args, status: child.status, stdout: child.stdout ?? "", stderr: child.stderr ?? "", error: child.error?.message ?? null };
    this.record("native", observation);
    assert.equal(observation.error, null, "CLI timeout/start/capture failure; preserve sandbox and inspect evidence, never retry automatically.");
    if (!allowNonzero) {
      assert.equal(observation.status, 0, `Independent CLI command failed: cm ${args[0]}; inspect private evidence.`);
      assert.equal(observation.stderr, "", `Independent CLI stderr is not silently accepted: cm ${args[0]}.`);
    }
    return observation;
  }
  async tool(name: string, args: Record<string, unknown> = {}, expectedSuccess = true): Promise<any> {
    const tool = this.tools.get(name);
    assert(tool?.outputSchema, `Expected registered structured tool ${name}.`);
    args = { workdir: this.workspace, ...args };
    let result: any;
    try {
      // Observe the real process seam, without synthetic stdout or a fake CM.
      // This proves negative controls did not secretly check in/replay/force.
      result = await runWithAbortSignal(undefined, () => tool.execute(`live-${this.runId}`, args, undefined, undefined, { cwd: this.workspace }), {
        spawn: ((command: string, argv: string[], options: any) => {
          const observation = { tool: name, args: [...argv], cwd: String(options.cwd) };
          this.toolCommands.push(observation);
          this.record("tool-process", observation);
          return spawn(command, argv, options);
        }) as typeof spawn,
      });
    }
    catch (error) { this.record("tool-threw", { name, args, error: String(error) }); throw error; }
    this.record("tool", { name, args, result });
    assert(result.structuredContent, `${name} must deliver native structuredContent, not presentation text.`);
    assert(Check(tool.outputSchema as any, result.structuredContent), `${name} returned data outside its declared output schema.`);
    assert.equal(result.isError === true, result.structuredContent.ok === false, `${name} error/DTO mismatch.`);
    if (expectedSuccess) assert.equal(result.structuredContent.ok, true, `${name} failed; inspect private receipt, no replay/CLI workaround.`);
    return result.structuredContent;
  }
  state(): LiveState {
    const standard = this.native(["status"]).stdout;
    const branchMatch = /^(\/[^\r\n]+?)@[^\r\n]+ \(cs:([0-9]+) - head\)\r?$/m.exec(standard);
    assert(branchMatch, "Independent standard status must identify loaded branch and changeset.");
    const xml = parseLiveXml(this.native(["status", "--xml", "--encoding=utf-8", "--fullpaths"]).stdout);
    const pendingPaths = nativeXmlPendingPaths(xml);
    assert.equal(xmlTexts(xml, "Changeset")[0], branchMatch[2], "Independent observations changed identity during inspection.");
    const markers = this.native(["merge", "--list-conflict-markers"], true);
    return { branch: branchMatch[1], changeset: branchMatch[2], pendingPaths, standard, markers };
  }
  clean(expectedBranch?: string): LiveState {
    const state = this.state();
    if (expectedBranch) assert.equal(state.branch, expectedBranch);
    assert.equal(state.pendingPaths.length, 0, "Sandbox must be clean; existing work is never undone.");
    assert(!/Pending merge links|Merge in progress|Conflicts/i.test(state.standard), "Sandbox has existing merge/conflict state; stop before mutation.");
    assert.equal(state.markers.status, 0, "Marker read failed or pending.");
    assert.equal(state.markers.stdout, "");
    assert.equal(state.markers.stderr, "");
    return state;
  }
  createBranch(branch: string) { this.native(["branch", "create", branch, "-c=pi-plastic isolated live regression fixture"]); }
  switch(branch: string) { this.clean(); this.native(["switch", `br:${branch}`]); this.clean(branch); }
  setupCheckin(paths: string[], message: string): string {
    // Fixture setup deliberately includes changed-but-not-checked-out bytes.
    // This is not merge resolution/force and is never used to recover a tool
    // under test after an uncertain applying call.
    const output = this.native(["checkin", ...paths, `-c=${message}`, "--applychanged", "--machinereadable"]).stdout;
    const changeset = /CHANGESET cs:([0-9]+)@br:/.exec(output)?.[1];
    assert(changeset, "Native fixture setup must emit one created changeset.");
    this.clean();
    return changeset;
  }
  verifyIntegration(created: string, target: string, source: string, baseline: string, expectedPaths: string[]) {
    const log = parseLiveXml(this.native(["log", `cs:${created}`, "--xml"]).stdout);
    assert.equal(xmlTexts(log, "ChangesetId")[0], created);
    assert.equal(xmlTexts(log, "Branch")[0], target, "Merge changeset belongs to target, not just a later workspace switch.");
    const paths = xmlTexts(log, "DstCmPath");
    for (const expected of expectedPaths) assert(paths.some(path => path.replaceAll("\\", "/").endsWith("/" + expected.replaceAll("\\", "/"))), "Committed history omitted an expected source path.");
    const ancestors = parseLiveXml(this.native(["log", `cs:${created}`, "--ancestors", `--from=cs:${baseline}`, "--xml"]).stdout);
    assert(xmlTexts(ancestors, "ChangesetId").includes(source), "Source changeset must be reachable through actual target history.");
    this.clean(target);
  }
  async scenario(name: string, body: () => Promise<void>) {
    try { await body(); this.outcomes.push({ name, outcome: "passed", detail: "Assertions and independent resulting-state observations passed." }); }
    catch (error) { this.outcomes.push({ name, outcome: "failed", detail: String(error) }); throw error; }
    finally { this.saveSummary(); }
  }
  saveSummary(extra: Record<string, unknown> = {}) {
    writeFileSync(join(this.evidenceDirectory, "summary.json"), JSON.stringify({ runId: this.runId, workspace: this.workspace, outcomes: this.outcomes, ...extra }, null, 2) + "\n");
  }
}
