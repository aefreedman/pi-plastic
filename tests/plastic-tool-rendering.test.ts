import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { initTheme, type ExtensionAPI, type ExtensionContext, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import registerPlastic from "../index";
import { renderPlasticCall, renderPlasticResult, renderPlasticSearchResult } from "../src/plastic-renderers";

initTheme("dark");
// The host's shrinkwrap may keep a separate TUI copy; keyHint reads that copy's registry.
const hostRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { getKeybindings, setKeybindings, KeybindingsManager }: typeof import("@earendil-works/pi-tui") = await import(pathToFileURL(hostRequire.resolve("@earendil-works/pi-tui")).href);
const previousBindings = getKeybindings();
setKeybindings(new KeybindingsManager({ "app.tools.expand": { defaultKeys: "ctrl+o" } }, { "app.tools.expand": "ctrl+e" }));
const colors: Array<{ color: string; text: string }> = [];
const theme: Pick<Theme, "fg" | "bold"> = { fg: (color, text) => { colors.push({ color, text }); return text; }, bold: text => text };
const plain = (component: { render(width: number): string[] }, width = 100) => component.render(width).map(line => stripVTControlCharacters(line).trimEnd()).join("\n");
const textResult = (text: string) => ({ content: [{ type: "text", text }] });
const structured = (action: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const raw = `## ${action}\n\n\`\`\`json\n${JSON.stringify({ ok: true, action, data, ...extra }, null, 2)}\n\`\`\``;
  return { ...textResult(raw), details: { rawResult: raw, workdir: "C:/Projects/MyGame" } };
};
const components: Text[] = [];
const render = (name: string, result: Parameters<typeof renderPlasticResult>[1], expanded = false, context?: Parameters<typeof renderPlasticResult>[4]) => {
  const component = renderPlasticResult(name, result, { expanded }, theme, context);
  components.push(component);
  return plain(component);
};

try {
  const call = renderPlasticCall("mergeBranches", { source: "br:/main/task@Game@cloud", target: "br:/main@Game@cloud", preflight: true }, theme);
  assert.match(plain(call), /Plastic.*Server merge.*server.*preview\n.*task@Game@cloud -> br:\/main@Game@cloud/);
  const workspaceCall = renderPlasticCall("workspaceDiff", { workdir: "C:\\Projects\\MyGame", paths: ["Assets/Player.cs", "Assets/UI.cs", "Assets/Game.cs"] }, theme);
  assert.match(plain(workspaceCall), /Workspace diff.*MyGame\nAssets\/Player.cs, Assets\/UI.cs \(\+1 more\)/);
  assert(!plain(workspaceCall).includes("C:\\Projects"));
  const revisionCall = renderPlasticCall("diffRevisions", { leftRevision: "Assets/A.cs#cs:1", rightRevision: "Assets/A.cs#cs:2" }, theme);
  assert.match(plain(revisionCall), /cs:1 -> Assets\/A.cs#cs:2/);
  components.push(call, workspaceCall, revisionCall);

  const status = structured("status", {
    summary: { totalPending: 4, changed: 2, added: 1, moved: 1 },
    itemCount: { total: 4, returned: 3, omitted: 1 },
    items: [
      { statusCode: "CH", path: "Assets/Player.cs" },
      { statusCode: "MV", sourcePath: "Assets/Old.cs", path: "Assets/New.cs" },
      { statusCode: "AD", path: "Assets/UI.cs" },
    ],
    mergeState: { hasMergeInProgress: true, pendingMergeLinks: ["Merge from /main/task"] },
  });
  const collapsedStatus = render("status", status);
  assert.match(collapsedStatus, /4 pending.*2 changed.*1 added.*1 moved/);
  assert.match(collapsedStatus, /Merge still in progress/);
  assert.match(collapsedStatus, /1 status records omitted/);
  assert.match(collapsedStatus, /Assets\/Old.cs -> Assets\/New.cs/);
  assert.match(collapsedStatus, /ctrl\+e details/);
  assert(!collapsedStatus.includes("ctrl+o"));
  assert(!collapsedStatus.includes('"ok"'));
  const expandedStatus = render("status", status, true);
  assert.match(expandedStatus, /Workspace\nC:\/Projects\/MyGame/);
  assert(expandedStatus.includes(status.content[0].text), "Expanded evidence retains the entire original envelope.");

  assert.match(render("branchExists", textResult("false")), /Branch not found/);
  assert(!render("branchExists", textResult("false")).startsWith("\u2713"));
  assert.match(render("currentBranch", structured("current-branch", { branch: "/main/task" })), /\/main\/task/);
  assert.match(render("checkin", structured("checkin-preflight", { wouldRun: false, errorCode: "NO_PENDING_PATHS" })), /Preview: would not run[\s\S]*NO_PENDING_PATHS/);
  assert.match(render("checkin", textResult("## Checkin Preflight\n\n- Would run: no\n- Reason: no matching pending paths"), false, { args: { preflight: true } }), /Preview: would not run[\s\S]*no matching pending paths/);
  assert.match(render("switchBranch", structured("switch-branch", { strategy: "cancel-with-pending", branchAfter: "/main" })), /Switch cancelled/);
  const blocked = render("mergeToBranch", structured("merge-to-branch", { checkedIn: false, switchOutcome: { kind: "canceled", reason: "Pending changes block the switch" } }));
  assert.match(blocked, /Checkin not performed[\s\S]*Pending changes block/);
  assert(!blocked.startsWith("\u2713"));

  for (const outcome of ["completed", "no-op", "conflict", "uncertain", "unsupported"]) {
    const output = render("mergeBranches", structured("merge-branches", { effect: "not-proven", mergeLinkIdentity: "unverified", xlinkEffects: "unverified" }, { ok: outcome === "completed", outcome }));
    assert.match(output, new RegExp(`Server merge: ${outcome}`));
    assert.match(output, /Effects not proven/);
    assert(!output.startsWith("\u2713"), "An ok envelope must not hide unverified effects.");
  }
  const textUncertain = render("mergeBranches", textResult("## Server Merge Uncertain\n\n- The command may have had an effect.\n- Do not retry automatically; inspect server state first."));
  assert(textUncertain.startsWith("!"));
  const noChangesRecovery = render("checkin", structured("checkin", { usedNoChangesRecovery: true, rawOutput: "Checkin completed with clean-workspace recovery" }));
  assert(noChangesRecovery.startsWith("!"));
  assert.match(noChangesRecovery, /clean-workspace recovery/);

  const diff = "--- Assets/Player.cs (base)\n+++ Assets/Player.cs (workspace)\n@@ -1 +1 @@\n-old\n+new";
  const workspaceDiff = structured("workspaceDiff", { outcomes: [
    ...Array.from({ length: 8 }, (_, index) => ({ path: `Assets/Skip${index}`, status: "skipped-directory" })),
    { path: "Assets/Unavailable.cs", status: "unavailable", error: "Base repository unresolved" },
    { path: "Assets/Player.cs", status: "changed", changed: true, diff, truncated: true },
  ], omittedOutcomes: 2, skippedByLimit: 3 });
  const diffCollapsed = render("workspaceDiff", workspaceDiff);
  assert.match(diffCollapsed, /1 changed.*1 unavailable/);
  assert.match(diffCollapsed, /Assets\/Unavailable.cs: unavailable - Base repository unresolved/);
  const textDiff = render("workspaceDiff", textResult("## Workspace Diff\n- Warning: private files excluded\n- Warning: file limit reached\n- Warning: more skipped\n### Assets/Broken.cs\nUnavailable: cannot resolve historical bytes"));
  assert.match(textDiff, /Unavailable: cannot resolve historical bytes/);
  const diffExpanded = render("workspaceDiff", workspaceDiff, true);
  assert.match(diffExpanded, /Assets\/Player.cs\n--- Assets\/Player.cs/);
  assert.match(diffExpanded, /2 outcomes omitted/);
  assert.match(diffExpanded, /3 pending items skipped/);
  assert(colors.some(row => row.color === "toolDiffAdded" && row.text === "+new"));
  assert(colors.some(row => row.color === "toolDiffRemoved" && row.text === "-old"));
  assert.match(render("diffFile", structured("diffFile", { status: "binary-different", binary: true, truncated: false })), /Binary content differs/);
  assert.match(render("diffFile", structured("diffFile", { status: "changed", diff, truncated: true })), /Output truncated/);
  assert.match(render("patch", textResult('{"status":"generated","output":"review.patch","bytes":200,"binaryLimited":true,"truncated":false}')), /Patch generated.*200 bytes[\s\S]*Binary content/);

  const exact = '{"id":9007199254740993,"number":1.2300e+5,"zero":-0,"key":"a","key":"b","escaped":"\\u0061\\n","empty":{}}';
  const exactExpanded = render("patch", textResult(exact), true);
  assert(exactExpanded.replace(/\n/g, "").includes(exact), "Wrapped evidence retains every original JSON lexeme.");
  assert(!exactExpanded.includes("9007199254740992"));
  const malformed = '{"status":"generated",';
  assert(render("patch", textResult(malformed), true).includes(malformed));
  const redacted = render("checkin", textResult('password="secret value"\n{"apiKey":"hidden-json-secret"}\n\x1b]0;terminal-title\x07\x1b[31mOriginal output\x1b[0m'), true);
  assert(!/secret value|hidden-json-secret|terminal-title/.test(redacted));
  assert.match(redacted, /\[redacted\]/);
  assert.match(redacted, /Original output/);
  assert.match(render("update", textResult("")), /No output/);
  const longText = Array.from({ length: 30 }, (_, i) => `row ${i}`).join("\n");
  const truncatedDisplay = render("branchList", textResult(longText));
  assert.match(truncatedDisplay, /27 more rows/);
  assert(render("branchList", textResult(longText), true).includes(longText));

  const progress = renderPlasticResult("update", textResult("Fetching changes"), { isPartial: true }, theme);
  assert.match(plain(progress), /Running.*Fetching changes/);
  const failed = renderPlasticResult("update", textResult("Connection refused"), {}, theme, { isError: true, lastComponent: progress });
  assert.equal(failed, progress);
  assert.match(plain(failed), /Failed[\s\S]*Connection refused/);
  assert(colors.some(row => row.color === "error" && row.text.includes("Failed")));
  components.push(failed);

  const search = { ...textResult("Activated plastic_workspaceDiff.\nGuidance: select exact paths."), details: { matches: ["plastic_workspaceDiff"], added: ["plastic_workspaceDiff"], alreadyActive: [], unavailableToolNames: ["plastic_missing"] } };
  const searched = renderPlasticSearchResult(search, {}, theme);
  assert.match(plain(searched), /1 activated.*0 already active[\s\S]*Unavailable: plastic_missing/);
  assert.match(plain(renderPlasticSearchResult(search, { expanded: true }, theme)), /Guidance:[ ]select exact paths/);
  components.push(searched);
  const unicode = renderPlasticCall("diffFile", { path: "Assets/\u4e2d\u6587/\ud83d\ude80-e\u0301.cs", workdir: "C:/\u4e2d\u6587" }, theme);
  components.push(unicode);
  for (const width of [24, 40, 80, 120]) for (const component of components) {
    for (const line of component.render(width)) assert(visibleWidth(line) <= width, `Overflow at width ${width}`);
  }

  // Verify the registration boundary and a real command-only preflight without launching cm.
  const tools: ToolDefinition[] = [];
  registerPlastic({ registerTool: tool => tools.push(tool), on() {} } as ExtensionAPI);
  assert.equal(tools.length, 31);
  for (const tool of tools) assert(tool.renderCall && tool.renderResult, `${tool.name} needs both renderers`);
  const serverMerge = tools.find(tool => tool.name === "plastic_mergeBranches")!;
  const actual = await serverMerge.execute("preview", { source: "br:/main/task@Game@cloud", target: "br:/main@Game@cloud", message: "Review", preflight: true, format: "json" }, undefined, undefined, { cwd: "C:/Projects/MyGame" } as ExtensionContext);
  const actualText = actual.content.find(entry => entry.type === "text");
  assert(actualText?.type === "text");
  assert(actualText.text.includes('"outcome": "preflight"'));
  assert.equal(actual.details.rawResult, actualText.text);
  assert(!("workdir" in actual.details), "Server merge remains workspace-free.");
  assert.match(render("mergeBranches", actual), /Preview: would run/);
  const rendererContext = { args: { source: "br:/main/task@Game@cloud", target: "br:/main@Game@cloud", preflight: true }, toolCallId: "preview", cwd: "C:/Projects/MyGame", state: {}, lastComponent: undefined, invalidate() {}, executionStarted: true, argsComplete: true, isPartial: false, expanded: true, showImages: false, isError: false };
  const registeredCall = serverMerge.renderCall!(rendererContext.args, theme as Theme, rendererContext);
  assert.match(plain(registeredCall), /Server merge.*preview/);
  const registeredResult = serverMerge.renderResult!(actual, { expanded: true, isPartial: false }, theme as Theme, rendererContext);
  assert.match(plain(registeredResult), /Request[\s\S]*br:\/main\/task@Game@cloud/);
  assert.match(plain(registeredResult), /Preview: would run/);
  const errorResult = serverMerge.renderResult!(textResult("Permission denied"), { expanded: false, isPartial: false }, theme as Theme, { ...rendererContext, isError: true });
  assert.match(plain(errorResult), /Failed[\s\S]*Permission denied/);

  console.log("PASS: Plastic renderer outcomes, previews, evidence, diffs, redaction, keybindings, registration and widths");
  if (process.argv.includes("--preview")) {
    console.log("\nStatus\n" + plain(renderPlasticCall("status", { workdir: "C:/Projects/MyGame" }, theme)) + "\n" + collapsedStatus);
    console.log("\nWorkspace diff\n" + plain(workspaceCall) + "\n" + diffCollapsed);
    console.log("\nServer merge preview\n" + plain(call) + "\n" + render("mergeBranches", actual));
    console.log("\nExpanded file diff\n" + render("diffFile", structured("diffFile", { status: "changed", diff, truncated: false }), true));
  }
} finally {
  setKeybindings(previousBindings);
}
