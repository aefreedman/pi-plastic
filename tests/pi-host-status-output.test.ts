import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { createAgentSessionServices, createAgentSessionFromServices, createCodemodeExtension, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { branchListOutputSchema } from "../src/pi/branch-list-output";
import { currentBranchOutputSchema, branchExistsOutputSchema } from "../src/pi/branch-output";
import { statusOutputSchema } from "../src/pi/status-output";
import { xmlStatus, xmlRecord } from "./fixtures/status-xml";

// File-loaded package, real finalizer and codemode; node itself is the fake cm executable.
// Node treats fixture/status and fixture/version as scripts, so this works without shell wrappers.
const fixture = await mkdtemp(join(tmpdir(), "pi-plastic-status-host-"));
const sdkUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const aiUrl = (() => { try { return import.meta.resolve("@earendil-works/pi-ai"); } catch { return new URL("../node_modules/@earendil-works/pi-ai/dist/index.js", sdkUrl).href; } })();
const ai = await import(aiUrl);
const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const modifierPath = join(fixture, "modifier.ts");
const previous = { executable: process.env.PI_PLASTIC_CM_EXECUTABLE, mode: process.env.PI_PLASTIC_TOOL_LOADING_MODE };
process.env.PI_PLASTIC_CM_EXECUTABLE = process.execPath;
process.env.PI_PLASTIC_TOOL_LOADING_MODE = "all-active";
const state = { scenario: "", nested: undefined as any };
(globalThis as any).__plasticHostFixture = state;
const commandFixture = `const fs = require("node:fs");
fs.appendFileSync("calls.jsonl", JSON.stringify(process.argv.slice(1)) + "\\n");
const data = JSON.parse(fs.readFileSync("scenario.json", "utf8"));
if (data.fail) { process.stderr.write("private fixture error and path"); process.exit(1); }
process.stdout.write(data.output);
`;
let action: { name: string; arguments: Record<string, unknown> };
let turns = 0;
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const records: any[] = [];
let session: any;
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => { throw Error("No network transport is allowed in this host test"); }) as any;
try {
await writeFile(join(fixture, "status"), commandFixture, { flag: "wx" });
await writeFile(join(fixture, "find"), commandFixture, { flag: "wx" });
await writeFile(join(fixture, "scenario.json"), "{}", { flag: "wx" });
await writeFile(join(fixture, "calls.jsonl"), "", { flag: "wx" });
await writeFile(join(fixture, "version"), `require("node:fs").appendFileSync("calls.jsonl", "version\\n"); console.log("fixture-version");`, { flag: "wx" });
await writeFile(modifierPath, `export default function(pi) {
  pi.on("tool_call", e => { if (["plastic_status", "plastic_branchList"].includes(e.toolName) && globalThis.__plasticHostFixture.scenario === "blocked") return { block: true, reason: "fixture policy block" }; });
  pi.on("tool_result", e => {
    if (!["plastic_status", "plastic_branchList"].includes(e.toolName)) return;
    if (globalThis.__plasticHostFixture.scenario === "content-only") return { content: [{ type: "text", text: "foreign replacement" }] };
  });
}`, { flag: "wx" });
  const modelRuntime = await ModelRuntime.create({ authPath: join(fixture, "agent/auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerProvider("plastic-local", {
    api: "plastic-scripted", baseUrl: "http://127.0.0.1:9/never", apiKey: "inert",
    models: [{ id: "fixture", name: "Local fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 256 }],
    streamSimple: (model, context) => {
      const stream = ai.createAssistantMessageEventStream();
      const message: any = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "pending", timestamp: Date.now() };
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        if (context.messages.at(-1)?.role !== "toolResult") {
          const call = { type: "toolCall", id: `status-${++turns}`, ...action }; message.content.push(call);
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: message }); stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
          message.stopReason = "toolUse"; stream.push({ type: "done", reason: "toolUse", message });
        } else { message.content.push({ type: "text", text: "Done" }); message.stopReason = "stop"; stream.push({ type: "done", reason: "stop", message }); }
      });
      return stream;
    },
  });
  const services = await createAgentSessionServices({ cwd: fixture, agentDir: join(fixture, "agent"), modelRuntime,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoaderOptions: { additionalExtensionPaths: [modifierPath, extensionPath], extensionFactories: [createCodemodeExtension({ mode: "on", models: false }), pi => {
      pi.registerTool({ name: "fixture_throw", label: "Throw", description: "Fixture", parameters: Type.Object({}), async execute() { throw Error("fixture thrown"); } });
      pi.registerTool({ name: "fixture_nested", label: "Nested", description: "Fixture", parameters: Type.Object({ abort: Type.Optional(Type.Boolean()), child: Type.Optional(Type.String()), branch: Type.Optional(Type.String()), source: Type.Optional(Type.Union([Type.Literal("xml"), Type.Literal("names"), Type.Literal("native")])) }), async execute(_id, params, _signal, _update, ctx) {
        const controller = new AbortController(); if (params.abort) controller.abort();
        state.nested = await ctx.executeTool(params.child ?? "plastic_status", params.child === "plastic_branchList" ? { source: params.source ?? "names" } : params.child === "plastic_branchExists" ? { branch: params.branch } : params.source === "xml" ? { source: "xml" } : { machineReadable: true }, { signal: controller.signal });
        return { content: [{ type: "text", text: "nested result inspected outside transcript" }], details: { childIsError: state.nested.isError } };
      } });
    }], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "Run only the local scripted action." },
  });
  assert.deepEqual(services.diagnostics.filter(d => d.type === "error"), []);
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  ({ session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(fixture), model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off", tools: ["plastic_status", "plastic_currentBranch", "plastic_branchList", "plastic_branchExists", "codemode", "fixture_throw", "fixture_nested"] }));
  await session.bindExtensions({});
  assert.deepEqual(session.getToolDefinition("plastic_status").outputSchema, statusOutputSchema);
  assert.equal(resolve(session.getAllTools().find((tool: any) => tool.name === "plastic_status").sourceInfo.path), resolve(extensionPath));
  session.subscribe((event: any) => { if (event.type === "tool_execution_end") records.push(event); });
  const run = async (scenario: string, name: string, args: Record<string, unknown>, output = "CH\u001fspace ü.txt\u001fFalse\u001f0\u001fNO_MERGES\n", fail = false) => {
    state.scenario = scenario; action = { name, arguments: args };
    await writeFile(join(fixture, "scenario.json"), JSON.stringify({ output, fail }));
    await writeFile(join(fixture, "calls.jsonl"), "");
    const start = records.length;
    await session.prompt(scenario);
    const parent = session.messages.filter((m: any) => m.role === "toolResult").at(-1);
    return { parent, children: records.slice(start).filter(r => ["plastic_status", "plastic_currentBranch", "plastic_branchList", "plastic_branchExists"].includes(r.toolName)), calls: (await readFile(join(fixture, "calls.jsonl"), "utf8")).trim().split("\n").filter(Boolean) };
  };
  const script = (args: object) => ({ code: `const dto = await tools.plastic_status(${JSON.stringify(args)}); if (typeof dto !== "object") throw Error("unexpected fallback"); text(dto);` });
  const text = (result: any) => result.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
  const direct = await run("direct", "plastic_status", { machineReadable: true });
  const dto = direct.children[0].result.structuredContent;
  assert(dto.ok); assert.equal(dto.data.items[0].revisionId, "0"); assert.equal(dto.data.items[0].isDirectory, false);
  assert.equal(direct.calls.length, 1); assert.equal(direct.parent.isError, false);
  assert.equal(direct.parent.structuredContent, undefined, "DTO is not automatically persisted into ordinary tool-result messages");
  for (const format of ["text", "json"]) {
    const nested = await run("codemode-" + format, "codemode", script({ machineReadable: true, format }));
    assert.deepEqual(nested.children[0].result.structuredContent, dto);
    assert.equal(nested.parent.details.calls[0].status, "ok");
    assert.equal(nested.calls.filter(c => c !== "version").length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(nested.children[0].result.structuredContent)), dto);
  }
  const compact = await run("selective", "codemode", { code: `const dto = await tools.plastic_status({machineReadable:true}); text({paths:dto.ok ? dto.data.items.filter(i => i.kind === "changed").map(i => i.path) : []});` });
  assert.match(text(compact.parent), /space ü.txt/); assert.doesNotMatch(text(compact.parent), /schemaVersion|revisionId/);
  await run("other-consumer", "fixture_nested", {});
  assert.deepEqual(state.nested.result.structuredContent, dto); assert.equal(state.nested.isError, false);
  const failure = await run("failure", "codemode", script({ machineReadable: true }), "", true);
  assert.equal(failure.parent.isError, false); assert.equal(failure.children[0].isError, true);
  assert.equal(failure.children[0].result.structuredContent.error.code, "command_failed");
  assert.equal(failure.parent.details.calls[0].status, "error"); assert.equal(failure.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(failure), /private fixture error/);
  const partial = await run("partial", "codemode", script({ machineReadable: true }), "unsupported");
  assert.equal(partial.children[0].result.structuredContent.completeness.read, "incomplete");
  const blocked = await run("blocked", "codemode", { code: `try { await tools.plastic_status({}); throw Error("must reject"); } catch (e) { text(String(e)); }` });
  assert.equal(blocked.children[0].isError, true); assert.equal(blocked.children[0].result.structuredContent, undefined); assert.equal(blocked.calls.length, 0); assert.match(text(blocked.parent), /fixture policy block/);
  const thrown = await run("thrown", "codemode", { code: `try { await tools.fixture_throw({}); throw Error("must reject"); } catch (e) { text(String(e)); }` });
  assert.match(text(thrown.parent), /fixture thrown/); assert.equal(thrown.parent.details.calls[0].status, "error");
  const aborted = await run("aborted", "fixture_nested", { abort: true });
  assert.equal(state.nested.isError, true); assert.equal(aborted.calls.length, 0);
  if (state.nested.result.structuredContent) assert.equal(state.nested.result.structuredContent.ok, false);
  const replaced = await run("content-only", "codemode", { code: `text(await tools.plastic_status({machineReadable:true}));` });
  assert.equal(replaced.children[0].result.structuredContent, undefined); assert.match(text(replaced.parent), /foreign replacement/);
  const xml = xmlStatus(xmlRecord());
  const xmlDirect = await run("xml-direct", "plastic_status", { source: "xml" }, xml);
  const xmlDto = xmlDirect.children[0].result.structuredContent;
  assert.equal(xmlDto.schemaVersion, 2); assert.equal(xmlDto.data.items[0].path, "/synthetic/日本-é-😀.txt"); assert.equal(xmlDirect.calls.length, 1);
  for (const format of ["text", "json"]) {
    const xmlCode = await run("xml-code-" + format, "codemode", script({ source: "xml", format }), xml);
    assert.deepEqual(xmlCode.children[0].result.structuredContent, xmlDto);
    assert.equal(xmlCode.parent.details.calls[0].status, "ok"); assert.equal(xmlCode.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(xmlCode.children[0])), xmlCode.children[0]);
  }
  await run("xml-nested", "fixture_nested", { source: "xml" }, xml);
  assert.deepEqual(state.nested.result.structuredContent, xmlDto); assert.equal(state.nested.isError, false);
  for (const [scenario, args, output, codeCalls] of [
    ["xml-malformed", { source: "xml" }, "foreign", 1],
    ["xml-short", { source: "xml", short: true }, xml, 0],
    ["xml-revision", { source: "xml", includeRevId: true }, xml, 0],
  ] as const) {
    const error = await run(scenario, "codemode", script(args), output);
    assert.equal(error.children[0].isError, true); assert.equal(error.children[0].result.structuredContent.schemaVersion, 2);
    assert.equal(error.parent.details.calls[0].status, "error"); assert.equal(error.calls.length, codeCalls);
  }
  const xmlAborted = await run("xml-abort", "fixture_nested", { source: "xml", abort: true }, xml);
  assert.equal(state.nested.isError, true); assert.equal(xmlAborted.calls.length, 0);
  for (const [name, schema, args, output] of [
    ["plastic_currentBranch", currentBranchOutputSchema, {}, "/main/space ü 日本 😀@repo@server (cs:0 - head)\n"],
    ["plastic_branchExists", branchExistsOutputSchema, { branch: "/main/space ü 日本 😀" }, "/main/space ü 日本 😀\n"],
  ] as const) {
    assert.deepEqual(session.getToolDefinition(name).outputSchema, schema);
    assert.equal(resolve(session.getAllTools().find((tool: any) => tool.name === name).sourceInfo.path), resolve(extensionPath));
    const directBranch = await run("branch-direct", name, args, output);
    const branchDto = directBranch.children[0].result.structuredContent;
    assert.equal(branchDto.ok, true); assert.equal(directBranch.calls.length, 1);
    const code = { code: `const dto = await tools.${name}(${JSON.stringify(args)}); text(dto);` };
    const coded = await run("branch-code", "codemode", code, output);
    assert.deepEqual(coded.children[0].result.structuredContent, branchDto);
    assert.equal(coded.parent.details.calls[0].status, "ok");
    await run("branch-consumer", "fixture_nested", { child: name, ...args }, output);
    assert.deepEqual(state.nested.result.structuredContent, branchDto); assert.equal(state.nested.isError, false);
    const failed = await run("branch-failure", "codemode", code, "", true);
    assert.equal(failed.children[0].isError, true); assert.equal(failed.children[0].result.structuredContent.error.code, "command_failed");
    assert.equal(failed.parent.details.calls[0].status, "error"); assert.equal(failed.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(failed), /private fixture error/);
    const cancelled = await run("branch-abort", "fixture_nested", { child: name, ...args, abort: true }, output);
    assert.equal(state.nested.isError, true); assert.equal(cancelled.calls.length, 0);
  }
  const verifiedFalse = await run("branch-false", "codemode", { code: `const dto = await tools.plastic_branchExists({branch:"/main/missing"}); text(dto.ok ? dto.data.exists : "error");` }, "");
  assert.equal(verifiedFalse.children[0].result.structuredContent.data.exists, false);
  assert.match(text(verifiedFalse.parent), /false/);
  // Fourth schema: one explicit canonical observation, independent presentation.
  assert.deepEqual(session.getToolDefinition("plastic_branchList").outputSchema, branchListOutputSchema);
  assert.equal(resolve(session.getAllTools().find((tool: any) => tool.name === "plastic_branchList").sourceInfo.path), resolve(extensionPath));
  const namesOutput = "/main/space ü café 日本 😀\n/main/second\n";
  const listDirect = await run("list-direct", "plastic_branchList", { source: "names" }, namesOutput);
  const listDto = listDirect.children[0].result.structuredContent;
  assert.equal(listDto.ok, true); assert.equal(listDirect.calls.length, 1);
  assert.deepEqual(listDto.data.rows.map((row: any) => row.branch), ["/main/space ü café 日本 😀", "/main/second"]);
  assert.equal(listDirect.parent.structuredContent, undefined);
  for (const format of ["text", "json"]) {
    const coded = await run("list-code-" + format, "codemode", { code: `const dto = await tools.plastic_branchList({source:"names",format:${JSON.stringify(format)}}); text(dto);` }, namesOutput);
    assert.deepEqual(coded.children[0].result.structuredContent, listDto);
    assert.equal(coded.parent.details.calls[0].status, "ok"); assert.equal(coded.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(coded.children[0])), coded.children[0]);
  }
  const listSubset = await run("list-subset", "codemode", { code: 'const dto = await tools.plastic_branchList({source:"names",maxItems:1}); text(dto.ok ? dto.data.rows.map(r => r.branch) : dto.error.code);' }, namesOutput);
  assert.match(text(listSubset.parent), /space ü/); assert.doesNotMatch(text(listSubset.parent), /schemaVersion|\/main\/second/);
  assert.deepEqual(listSubset.children[0].result.structuredContent.data.counts, { observed: 2, returned: 1, omitted: 1, excluded: 0 });
  await run("list-nested", "fixture_nested", { child: "plastic_branchList", source: "names" }, namesOutput);
  assert.deepEqual(state.nested.result.structuredContent, listDto); assert.equal(state.nested.isError, false);
  for (const [scenario, args, output, fail, expectedCalls, expectedCode] of [
    ["list-command-error", { source: "names" }, "", true, 1, "command_failed"],
    ["list-native-error", { source: "native" }, "", true, 1, "command_failed"],
    ["list-malformed", { source: "names" }, "foreign", false, 1, "invalid_identity"],
    ["list-duplicate", { source: "names", maxItems: 1 }, "/main/a\n/main/a\n", false, 1, "malformed_output"],
    ["list-hidden", { source: "names", includeHidden: true }, namesOutput, false, 0, "unsupported_query"],
  ] as const) {
    const result = await run(scenario, "codemode", { code: `text(await tools.plastic_branchList(${JSON.stringify(args)}));` }, output, fail);
    assert.equal(result.children[0].isError, true); assert.equal(result.children[0].result.structuredContent.error.code, expectedCode);
    assert.equal(result.parent.details.calls[0].status, "error"); assert.equal(result.calls.length, expectedCalls);
    assert.doesNotMatch(JSON.stringify(result), /private fixture error/);
  }
  const listNative = await run("list-native", "plastic_branchList", {}, "synthetic native table\n");
  assert.equal(listNative.children[0].result.structuredContent.data.rows, null);
  assert.equal(listNative.children[0].result.structuredContent.data.counts, null);
  assert.equal(listNative.children[0].result.details.rawResult, "synthetic native table");
  const listEmpty = await run("list-empty", "plastic_branchList", { source: "names" }, "");
  assert.deepEqual(listEmpty.children[0].result.structuredContent.data.rows, []);
  const listAbort = await run("list-abort", "fixture_nested", { child: "plastic_branchList", source: "names", abort: true }, namesOutput);
  assert.equal(state.nested.isError, true); assert.equal(listAbort.calls.length, 0);
  if (state.nested.result.structuredContent) assert.equal(state.nested.result.structuredContent.error.code, "aborted");
  const listBlocked = await run("blocked", "codemode", { code: 'try { await tools.plastic_branchList({source:"names"}); throw Error("must reject"); } catch(e) { text(String(e)); }' }, namesOutput);
  assert.equal(listBlocked.children[0].isError, true); assert.equal(listBlocked.children[0].result.structuredContent, undefined); assert.equal(listBlocked.calls.length, 0);
  const listReplaced = await run("content-only", "codemode", { code: 'text(await tools.plastic_branchList({source:"names"}));' }, namesOutput);
  assert.equal(listReplaced.children[0].result.structuredContent, undefined); assert.match(text(listReplaced.parent), /foreign replacement/);
  console.log(`PASS: real Pi host, ${turns} local scripted turns; finalizer/codemode/nested consumers, SDK JSON events, native errors, selective context and foreign-hook fallback; zero network`);
} finally {
  session?.dispose(); globalThis.fetch = originalFetch; delete (globalThis as any).__plasticHostFixture;
  if (previous.executable === undefined) delete process.env.PI_PLASTIC_CM_EXECUTABLE; else process.env.PI_PLASTIC_CM_EXECUTABLE = previous.executable;
  if (previous.mode === undefined) delete process.env.PI_PLASTIC_TOOL_LOADING_MODE; else process.env.PI_PLASTIC_TOOL_LOADING_MODE = previous.mode;
  await rm(fixture, { recursive: true, force: true });
}
