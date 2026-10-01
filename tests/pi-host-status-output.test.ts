import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { createAgentSessionServices, createAgentSessionFromServices, createCodemodeExtension, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { statusOutputSchema } from "../src/pi/status-output";

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
await writeFile(join(fixture, "status"), `const fs = require("node:fs");
fs.appendFileSync("calls.jsonl", JSON.stringify(process.argv.slice(1)) + "\\n");
const data = JSON.parse(fs.readFileSync("scenario.json", "utf8"));
if (data.fail) { process.stderr.write("private fixture error and path"); process.exit(1); }
process.stdout.write(data.output);
`);
await writeFile(join(fixture, "version"), `require("node:fs").appendFileSync("calls.jsonl", "version\\n"); console.log("fixture-version");`);
await writeFile(modifierPath, `export default function(pi) {
  pi.on("tool_call", e => { if (e.toolName === "plastic_status" && globalThis.__plasticHostFixture.scenario === "blocked") return { block: true, reason: "fixture policy block" }; });
  pi.on("tool_result", e => {
    if (e.toolName !== "plastic_status") return;
    if (globalThis.__plasticHostFixture.scenario === "content-only") return { content: [{ type: "text", text: "foreign replacement" }] };
  });
}`);
let action: { name: string; arguments: Record<string, unknown> };
let turns = 0;
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const records: any[] = [];
let session: any;
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => { throw Error("No network transport is allowed in this host test"); }) as any;
try {
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
      pi.registerTool({ name: "fixture_nested", label: "Nested", description: "Fixture", parameters: Type.Object({ abort: Type.Optional(Type.Boolean()) }), async execute(_id, params, _signal, _update, ctx) {
        const controller = new AbortController(); if (params.abort) controller.abort();
        state.nested = await ctx.executeTool("plastic_status", { machineReadable: true }, { signal: controller.signal });
        return { content: [{ type: "text", text: "nested result inspected outside transcript" }], details: { childIsError: state.nested.isError } };
      } });
    }], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "Run only the local scripted action." },
  });
  assert.deepEqual(services.diagnostics.filter(d => d.type === "error"), []);
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  ({ session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(fixture), model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off", tools: ["plastic_status", "codemode", "fixture_throw", "fixture_nested"] }));
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
    return { parent, children: records.slice(start).filter(r => r.toolName === "plastic_status"), calls: (await readFile(join(fixture, "calls.jsonl"), "utf8")).trim().split("\n").filter(Boolean) };
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
  console.log(`PASS: real Pi host, ${turns} local scripted turns; finalizer/codemode/nested consumers, SDK JSON events, native errors, selective context and foreign-hook fallback; zero network`);
} finally {
  session?.dispose(); globalThis.fetch = originalFetch; delete (globalThis as any).__plasticHostFixture;
  if (previous.executable === undefined) delete process.env.PI_PLASTIC_CM_EXECUTABLE; else process.env.PI_PLASTIC_CM_EXECUTABLE = previous.executable;
  if (previous.mode === undefined) delete process.env.PI_PLASTIC_TOOL_LOADING_MODE; else process.env.PI_PLASTIC_TOOL_LOADING_MODE = previous.mode;
  await rm(fixture, { recursive: true, force: true });
}
