import { codeReviewFindOutputSchema } from "../src/pi/code-review-find-output";
import { shelvesetListOutputSchema } from "../src/pi/shelveset-list-output";
import { workspaceListOutputSchema } from "../src/pi/workspace-list-output";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { createAgentSessionServices, createAgentSessionFromServices, createCodemodeExtension, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { branchListOutputSchema } from "../src/pi/branch-list-output";
import { currentBranchOutputSchema, branchExistsOutputSchema } from "../src/pi/branch-output";
import { diffOutputSchema } from "../src/pi/diff-output";
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
await writeFile(join(fixture, "workspace"), commandFixture, { flag: "wx" });
await writeFile(join(fixture, "cat"), `const fs=require("node:fs");fs.appendFileSync("calls.jsonl",JSON.stringify(process.argv.slice(1))+"\\n");const data=JSON.parse(fs.readFileSync("scenario.json","utf8"));if(data.fail){process.stderr.write("private fixture error");process.exit(1);}const pair=JSON.parse(data.output);const dest=process.argv.find(a=>a.startsWith("--file=")).slice(7);fs.writeFileSync(dest,Buffer.from(process.argv[2].endsWith("#cs:2")?pair.right:pair.left,"base64"),{flag:"wx"});`, {flag:"wx"});
await writeFile(join(fixture, "scenario.json"), "{}", { flag: "wx" });
await writeFile(join(fixture, "calls.jsonl"), "", { flag: "wx" });
await writeFile(join(fixture, "version"), `require("node:fs").appendFileSync("calls.jsonl", "version\\n"); console.log("fixture-version");`, { flag: "wx" });
await writeFile(modifierPath, `export default function(pi) {
  pi.on("tool_call", e => { if (["plastic_status", "plastic_branchList", "plastic_workspaceList", "plastic_shelvesetList", "plastic_codeReviewFind", "plastic_diff"].includes(e.toolName) && globalThis.__plasticHostFixture.scenario === "blocked") return { block: true, reason: "fixture policy block" }; });
  pi.on("tool_result", e => {
    if (!["plastic_status", "plastic_branchList", "plastic_workspaceList", "plastic_shelvesetList", "plastic_codeReviewFind", "plastic_diff"].includes(e.toolName)) return;
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
      pi.registerTool({ name: "fixture_nested", label: "Nested", description: "Fixture", parameters: Type.Object({ abort: Type.Optional(Type.Boolean()), child: Type.Optional(Type.String()), branch: Type.Optional(Type.String()), source: Type.Optional(Type.Union([Type.Literal("xml"), Type.Literal("names"), Type.Literal("fields"), Type.Literal("ids"), Type.Literal("native")])) }), async execute(_id, params, _signal, _update, ctx) {
        const controller = new AbortController(); if (params.abort) controller.abort();
        state.nested = await ctx.executeTool(params.child ?? "plastic_status", params.child === "plastic_diff" ? { mode:"revisions", leftRevision:"Assets/Fictional.txt#cs:1", rightRevision:"Assets/Fictional.txt#cs:2" } : ["plastic_shelvesetList", "plastic_codeReviewFind"].includes(params.child ?? "") ? { source: params.source ?? "ids" } : params.child === "plastic_workspaceList" ? { source: params.source ?? "fields" } : params.child === "plastic_branchList" ? { source: params.source ?? "names" } : params.child === "plastic_branchExists" ? { branch: params.branch } : params.source === "xml" ? { source: "xml" } : { machineReadable: true }, { signal: controller.signal });
        return { content: [{ type: "text", text: "nested result inspected outside transcript" }], details: { childIsError: state.nested.isError } };
      } });
    }], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "Run only the local scripted action." },
  });
  assert.deepEqual(services.diagnostics.filter(d => d.type === "error"), []);
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  ({ session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(fixture), model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off", tools: ["plastic_status", "plastic_currentBranch", "plastic_branchList", "plastic_branchExists", "plastic_workspaceList", "plastic_shelvesetList", "plastic_codeReviewFind", "plastic_diff", "codemode", "fixture_throw", "fixture_nested"] }));
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
    return { parent, children: records.slice(start).filter(r => ["plastic_status", "plastic_currentBranch", "plastic_branchList", "plastic_branchExists", "plastic_workspaceList", "plastic_shelvesetList", "plastic_codeReviewFind", "plastic_diff"].includes(r.toolName)), calls: (await readFile(join(fixture, "calls.jsonl"), "utf8")).trim().split("\n").filter(Boolean) };
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
  assert.deepEqual(session.getToolDefinition("plastic_workspaceList").outputSchema,workspaceListOutputSchema);
  assert.equal(resolve(session.getAllTools().find((tool:any)=>tool.name==="plastic_workspaceList").sourceInfo.path),resolve(extensionPath));
  const workspaceOutput="Fictional Workspace\tFICTIONAL\tC:\\Fictional\\workspace\t00000000-0000-0000-0000-000000000001\r\n";
  const workspaceDirect=await run("workspace-direct","plastic_workspaceList",{source:"fields"},workspaceOutput);
  const workspaceDto=workspaceDirect.children[0].result.structuredContent;
  assert(workspaceDto.ok);assert.equal(workspaceDto.data.rows[0].name,"Fictional Workspace");assert.equal(workspaceDirect.calls.length,1);
  for(const output of ["text","json"]){const r=await run("workspace-code-"+output,"codemode",{code:`text(await tools.plastic_workspaceList({source:"fields",output:${JSON.stringify(output)}}));`},workspaceOutput);assert.deepEqual(r.children[0].result.structuredContent,workspaceDto);assert.equal(r.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(r.children[0])),r.children[0]);}
  const workspaceSubset=await run("workspace-subset","codemode",{code:'const dto=await tools.plastic_workspaceList({source:"fields",maxItems:1}); text(dto.ok&&dto.data.mode==="fields"?dto.data.rows.map(r=>r.name):[]);'},workspaceOutput);
  assert.match(text(workspaceSubset.parent),/Fictional Workspace/);assert.doesNotMatch(text(workspaceSubset.parent),/schemaVersion|guid/);
  await run("workspace-nested","fixture_nested",{child:"plastic_workspaceList",source:"fields"},workspaceOutput);assert.deepEqual(state.nested.result.structuredContent,workspaceDto);
  for(const [scenario,args,output,fail,count] of [["workspace-error",{source:"fields"},"",true,1],["workspace-native-error",{source:"native"},"",true,1],["workspace-malformed",{source:"fields"},"junk",false,1],["workspace-conflict",{source:"fields",format:"{path}"},workspaceOutput,false,0]] as const){const r=await run(scenario,"codemode",{code:`text(await tools.plastic_workspaceList(${JSON.stringify(args)}));`},output,fail);assert(r.children[0].isError);assert.equal(r.parent.details.calls[0].status,"error");assert.equal(r.calls.length,count);assert.doesNotMatch(JSON.stringify(r),/private fixture error/);}
  const workspaceRepeat=await run("workspace-repeat","plastic_workspaceList",{source:"fields",maxItems:1},workspaceOutput+workspaceOutput);assert.equal(workspaceRepeat.children[0].result.structuredContent.data.counts.observed,2);assert.equal(workspaceRepeat.children[0].result.structuredContent.data.diagnostics.duplicateRecords,1);
  const workspaceConflict=await run("workspace-conflict-aftercap","plastic_workspaceList",{source:"fields",maxItems:1},workspaceOutput+workspaceOutput.replace("FICTIONAL","OTHER"));assert(workspaceConflict.children[0].isError);
  const workspaceNative=await run("workspace-native","plastic_workspaceList",{}, "native table\n");assert.equal(workspaceNative.children[0].result.structuredContent.data.rows,null);
  const workspaceAbort=await run("workspace-abort","fixture_nested",{child:"plastic_workspaceList",source:"fields",abort:true},workspaceOutput);assert(state.nested.isError);assert.equal(workspaceAbort.calls.length,0);
  const workspaceBlocked=await run("blocked","codemode",{code:'try { await tools.plastic_workspaceList({source:"fields"}); throw Error("must reject"); } catch(e){ text(String(e)); }'},workspaceOutput);assert.equal(workspaceBlocked.calls.length,0);assert.equal(workspaceBlocked.children[0].result.structuredContent,undefined);
  const workspaceReplaced=await run("content-only","codemode",{code:'text(await tools.plastic_workspaceList({source:"fields"}));'},workspaceOutput);assert.equal(workspaceReplaced.children[0].result.structuredContent,undefined);assert.match(text(workspaceReplaced.parent),/foreign replacement/);
  assert.deepEqual(session.getToolDefinition("plastic_shelvesetList").outputSchema, shelvesetListOutputSchema);
  assert.equal(resolve(session.getAllTools().find((t:any)=>t.name==="plastic_shelvesetList").sourceInfo.path),resolve(extensionPath));
  const shelvesOutput="17\r\n9007199254740993\r\n";
  const shelvesDirect=await run("shelves-direct","plastic_shelvesetList",{source:"ids"},shelvesOutput);
  const shelvesDto=shelvesDirect.children[0].result.structuredContent;
  assert(shelvesDto.ok);assert.equal(shelvesDirect.calls.length,1);
  assert.deepEqual(shelvesDto.data.rows.map((r:any)=>r.shelveset),["sh:17","sh:9007199254740993"]);
  for(const output of ["text","json"]){
    const code='text(await tools.plastic_shelvesetList({source:"ids",output:'+JSON.stringify(output)+'}));';
    const r=await run("shelves-code-"+output,"codemode",{code},shelvesOutput);
    assert.deepEqual(r.children[0].result.structuredContent,shelvesDto);assert.equal(r.calls.length,1);
    assert.equal(r.parent.details.calls[0].status,"ok");assert.deepEqual(JSON.parse(JSON.stringify(r.children[0])),r.children[0]);
  }
  const shelvesSubset=await run("shelves-subset","codemode",{code:'const d=await tools.plastic_shelvesetList({source:"ids",maxItems:1});text(d.ok&&d.data.mode==="ids"?d.data.rows.map(r=>r.shelveset):[]);'},shelvesOutput);
  assert.match(text(shelvesSubset.parent),/sh:17/);assert.doesNotMatch(text(shelvesSubset.parent),/schemaVersion|9007199254740993/);
  await run("shelves-nested","fixture_nested",{child:"plastic_shelvesetList",source:"ids"},shelvesOutput);
  assert.deepEqual(state.nested.result.structuredContent,shelvesDto);
  for(const [scenario,args,output,fail,count] of [
    ["shelves-error",{source:"ids"},"",true,1],
    ["shelves-native-error",{source:"native"},"",true,1],
    ["shelves-malformed",{source:"ids"},"17\nforeign",false,1],
    ["shelves-format",{source:"ids",format:"{comment}"},shelvesOutput,false,0],
    ["shelves-date",{source:"ids",dateFormat:"yyyy"},shelvesOutput,false,0],
  ] as const){
    const code="text(await tools.plastic_shelvesetList("+JSON.stringify(args)+"));";
    const r=await run(scenario,"codemode",{code},output,fail);
    assert(r.children[0].isError);assert.equal(r.parent.details.calls[0].status,"error");assert.equal(r.calls.length,count);
    assert.doesNotMatch(JSON.stringify(r),/private fixture error/);
  }
  const shelvesEmpty=await run("shelves-empty","plastic_shelvesetList",{source:"ids"},"");
  assert.deepEqual(shelvesEmpty.children[0].result.structuredContent.data.rows,[]);
  const shelvesNative=await run("shelves-native","plastic_shelvesetList",{format:"{comment}",dateFormat:"yyyy"},"native table");
  assert.equal(shelvesNative.children[0].result.structuredContent.data.rows,null);
  assert.equal(shelvesNative.children[0].result.details.rawResult,"native table");
  const shelvesRepeat=await run("shelves-repeat","plastic_shelvesetList",{source:"ids",maxItems:1},"17\n17");
  assert.equal(shelvesRepeat.children[0].result.structuredContent.data.diagnostics.duplicateRecords,1);
  const shelvesAbort=await run("shelves-abort","fixture_nested",{child:"plastic_shelvesetList",source:"ids",abort:true},shelvesOutput);
  assert(state.nested.isError);assert.equal(shelvesAbort.calls.length,0);
  const shelvesBlocked=await run("blocked","codemode",{code:'try{await tools.plastic_shelvesetList({source:"ids"});throw Error("must reject");}catch(e){text(String(e));}'},shelvesOutput);
  assert.equal(shelvesBlocked.calls.length,0);assert.equal(shelvesBlocked.children[0].result.structuredContent,undefined);
  const shelvesReplaced=await run("content-only","codemode",{code:'text(await tools.plastic_shelvesetList({source:"ids"}));'},shelvesOutput);
  assert.equal(shelvesReplaced.children[0].result.structuredContent,undefined);assert.match(text(shelvesReplaced.parent),/foreign replacement/);
  assert.deepEqual(session.getToolDefinition("plastic_codeReviewFind").outputSchema, codeReviewFindOutputSchema);
  assert.equal(resolve(session.getAllTools().find((t:any)=>t.name==="plastic_codeReviewFind").sourceInfo.path),resolve(extensionPath));
  const reviewsOutput="17\r\n9007199254740993\r\n";
  const reviewsDirect=await run("reviews-direct","plastic_codeReviewFind",{source:"ids"},reviewsOutput);
  const reviewsDto=reviewsDirect.children[0].result.structuredContent;
  assert(reviewsDto.ok);assert.equal(reviewsDirect.calls.length,1);
  assert.deepEqual(reviewsDto.data.rows.map((r:any)=>r.id),["17","9007199254740993"]);
  for(const output of ["text","json"]){
    const code='text(await tools.plastic_codeReviewFind({source:"ids",output:'+JSON.stringify(output)+'}));';
    const r=await run("reviews-code-"+output,"codemode",{code},reviewsOutput);
    assert.deepEqual(r.children[0].result.structuredContent,reviewsDto);assert.equal(r.calls.length,1);
    assert.equal(r.parent.details.calls[0].status,"ok");assert.deepEqual(JSON.parse(JSON.stringify(r.children[0])),r.children[0]);
  }
  const reviewsSubset=await run("reviews-subset","codemode",{code:'const d=await tools.plastic_codeReviewFind({source:"ids",maxItems:1});text(d.ok&&d.data.mode==="ids"?d.data.rows.map(r=>r.id):[]);'},reviewsOutput);
  assert.match(text(reviewsSubset.parent),/17/);assert.doesNotMatch(text(reviewsSubset.parent),/schemaVersion|9007199254740993/);
  await run("reviews-nested","fixture_nested",{child:"plastic_codeReviewFind",source:"ids"},reviewsOutput);
  assert.deepEqual(state.nested.result.structuredContent,reviewsDto);
  for(const [scenario,args,output,fail,count] of [
    ["reviews-error",{source:"ids"},"",true,1],
    ["reviews-native-error",{source:"native"},"",true,1],
    ["reviews-malformed",{source:"ids"},"17\nforeign",false,1],
    ["reviews-format",{source:"ids",format:"{title}"},reviewsOutput,false,0],
    ["reviews-date",{source:"ids",dateFormat:"yyyy"},reviewsOutput,false,0],
  ] as const){
    const code="text(await tools.plastic_codeReviewFind("+JSON.stringify(args)+"));";
    const r=await run(scenario,"codemode",{code},output,fail);
    assert(r.children[0].isError);assert.equal(r.parent.details.calls[0].status,"error");assert.equal(r.calls.length,count);
    assert.doesNotMatch(JSON.stringify(r),/private fixture error/);
  }
  const reviewsEmpty=await run("reviews-empty","plastic_codeReviewFind",{source:"ids"},"");
  assert.deepEqual(reviewsEmpty.children[0].result.structuredContent.data.rows,[]);
  const reviewsNative=await run("reviews-native","plastic_codeReviewFind",{format:"{title}",dateFormat:"yyyy"},"native table");
  assert.equal(reviewsNative.children[0].result.structuredContent.data.rows,null);
  assert.equal(reviewsNative.children[0].result.details.rawResult,"native table");
  const reviewsRepeat=await run("reviews-repeat","plastic_codeReviewFind",{source:"ids",maxItems:1},"17\n17");
  assert.equal(reviewsRepeat.children[0].result.structuredContent.data.diagnostics.duplicateRecords,1);
  const reviewsAbort=await run("reviews-abort","fixture_nested",{child:"plastic_codeReviewFind",source:"ids",abort:true},reviewsOutput);
  assert(state.nested.isError);assert.equal(reviewsAbort.calls.length,0);
  const reviewsBlocked=await run("blocked","codemode",{code:'try{await tools.plastic_codeReviewFind({source:"ids"});throw Error("must reject");}catch(e){text(String(e));}'},reviewsOutput);
  assert.equal(reviewsBlocked.calls.length,0);assert.equal(reviewsBlocked.children[0].result.structuredContent,undefined);
  const reviewsReplaced=await run("content-only","codemode",{code:'text(await tools.plastic_codeReviewFind({source:"ids"}));'},reviewsOutput);
  assert.equal(reviewsReplaced.children[0].result.structuredContent,undefined);assert.match(text(reviewsReplaced.parent),/foreign replacement/);
  const reviewNativeJson=await run("reviews-native-json","plastic_codeReviewFind",{output:"json",format:"{id}{tab}{title}",dateFormat:"yyyy"},"native custom table");
  assert.equal(reviewNativeJson.children[0].result.structuredContent.data.rows,null);
  assert.match(text(reviewNativeJson.parent),/## code-review-find/);assert.match(text(reviewNativeJson.parent),/"rawOutput": "native custom table"/);
  assert.equal(reviewNativeJson.calls.filter((c:any)=>c!=="version" && resolve(JSON.parse(c)[0])===resolve(join(fixture,"find"))).length,1);
  const reviewOrdered=await run("reviews-ordered","plastic_codeReviewFind",{source:"ids",status:"pending",assignee:"me",target:"br:/main",targetType:"branch",titleLike:"Feature_%",orderBy:"modifieddate",descending:true,limit:2,maxItems:1},reviewsOutput);
  assert(reviewOrdered.children[0].result.structuredContent.ok);assert.equal(reviewOrdered.calls.length,1);
  assert.deepEqual(JSON.parse(reviewOrdered.calls[0]).slice(1),["review","where status = 'pending' and assignee = 'me' and target = 'br:/main' and targettype = 'branch' and title like 'Feature_%'","order by modifieddate desc","limit 2","--nototal","--format={id}","--encoding=utf-8"]);
  const historical={mode:"revisions",leftRevision:"Assets/Fictional.txt#cs:1",rightRevision:"Assets/Fictional.txt#cs:2"};
  const historicalPair=(l:string|Buffer,r:string|Buffer)=>JSON.stringify({left:Buffer.from(l).toString("base64"),right:Buffer.from(r).toString("base64")});
  const pair=historicalPair("before 日本 😀\n","after 日本 😀\n");
  assert.deepEqual(session.getToolDefinition("plastic_diff").outputSchema,diffOutputSchema);
  assert.equal(resolve(session.getAllTools().find((t:any)=>t.name==="plastic_diff").sourceInfo.path),resolve(extensionPath));
  const historicalDirect=await run("historical-direct","plastic_diff",historical,pair),historicalDto=historicalDirect.children[0].result.structuredContent;
  assert(historicalDto.ok);assert.equal(historicalDto.data.status,"changed");assert.equal(historicalDirect.calls.length,2);assert.match(historicalDto.data.excerpt.text,/\+after 日本 😀/);
  for(const format of ["text","json"]){
    const r=await run("historical-code-"+format,"codemode",{code:"text(await tools.plastic_diff("+JSON.stringify({...historical,format})+"));"},pair);
    assert.deepEqual(r.children[0].result.structuredContent,historicalDto);assert.equal(r.parent.details.calls[0].status,"ok");assert.equal(r.calls.filter(c=>c!=="version").length,2);assert.deepEqual(JSON.parse(JSON.stringify(r.children[0])),r.children[0]);
  }
  const historicalSubset=await run("historical-subset","codemode",{code:"const d=await tools.plastic_diff("+JSON.stringify(historical)+");text(d.ok?{status:d.data.status}:d.error.code);"},pair);
  assert.match(text(historicalSubset.parent),/changed/);assert.doesNotMatch(text(historicalSubset.parent),/schemaVersion|before 日本/);
  await run("historical-nested","fixture_nested",{child:"plastic_diff"},pair);assert.deepEqual(state.nested.result.structuredContent,historicalDto);
  for(const [scenario,output,status,binary] of [
    ["historical-empty",historicalPair("",""),"unchanged",false],
    ["historical-same",historicalPair("same\n","same\n"),"unchanged",false],
    ["historical-binary",historicalPair(Buffer.from([0,1]),Buffer.from([0,2])),"binary-different",true],
    ["historical-binary-same",historicalPair(Buffer.from([255]),Buffer.from([255])),"unchanged",true],
  ] as const){const r=await run(scenario,"plastic_diff",historical,output);assert(r.children[0].result.structuredContent.ok);assert.equal(r.children[0].result.structuredContent.data.status,status);assert.equal(r.children[0].result.structuredContent.data.binary,binary);assert.equal(r.calls.length,2);}
  for(const [scenario,args,fail,count] of [
    ["historical-export-error",historical,true,1],
    ["historical-selector",{...historical,leftRevision:"revid:17;C:/Fictional/output.txt"},false,0],
  ] as const){const r=await run(scenario,"codemode",{code:"text(await tools.plastic_diff("+JSON.stringify(args)+"));"},pair,fail);assert(r.children[0].isError);assert.equal(r.parent.details.calls[0].status,"error");assert.equal(r.calls.length,count);assert.doesNotMatch(JSON.stringify(r),/private fixture error/);}
  const historicalAbort=await run("historical-abort","fixture_nested",{child:"plastic_diff",abort:true},pair);assert(state.nested.isError);assert.equal(historicalAbort.calls.length,0);
  const historicalBlocked=await run("blocked","codemode",{code:"try{await tools.plastic_diff("+JSON.stringify(historical)+");throw Error('must reject');}catch(e){text(String(e));}"},pair);assert.equal(historicalBlocked.calls.length,0);assert.equal(historicalBlocked.children[0].result.structuredContent,undefined);
  const historicalReplaced=await run("content-only","codemode",{code:"text(await tools.plastic_diff("+JSON.stringify(historical)+"));"},pair);assert.equal(historicalReplaced.children[0].result.structuredContent,undefined);assert.match(text(historicalReplaced.parent),/foreign replacement/);
  const historicalLong=await run("historical-projection","plastic_diff",{...historical,maxChars:500},historicalPair("before 日本 😀\n".repeat(100),"after 日本 😀\n".repeat(100)));assert(historicalLong.children[0].result.structuredContent.ok);assert.equal(historicalLong.children[0].result.structuredContent.completeness.projection,false);assert(historicalLong.children[0].result.structuredContent.data.excerpt.returnedChars<=500);
  await mkdir(join(fixture,".plastic"));await writeFile(join(fixture,".plastic","plastic.workspace"),"synthetic workspace marker");
  const localFile=join(fixture,"Host 日本-é-😀.txt");await writeFile(localFile,"after 日本 😀\n");
  const explicit={mode:"file",path:localFile,revision:"Assets/Fictional.txt#cs:1"};
  const f=await run("file-explicit","plastic_diff",explicit,pair);assert(f.children[0].result.structuredContent.ok);assert.equal(f.children[0].result.structuredContent.data.right.origin,"local-snapshot");assert.equal(f.calls.length,1);
  const fc=await run("file-explicit-code","codemode",{code:"text(await tools.plastic_diff("+JSON.stringify(explicit)+"));"} ,pair);assert.deepEqual(fc.children[0].result.structuredContent,f.children[0].result.structuredContent);
  const addedXml=xmlStatus(xmlRecord(localFile,"AD"));
  for(const [label,args] of [["workspace-selected",{mode:"workspace",paths:[localFile]}],["workspace-all",{mode:"workspace",allPending:true}]] as const){
    const direct=await run(label,"plastic_diff",args,addedXml);assert(direct.children[0].result.structuredContent.ok);assert.equal(direct.children[0].result.structuredContent.data.counts.completed,1);
    const viaCode=await run(label+"-code","codemode",{code:"text(await tools.plastic_diff("+JSON.stringify(args)+"));"} ,addedXml);assert.deepEqual(viaCode.children[0].result.structuredContent,direct.children[0].result.structuredContent);assert.deepEqual(JSON.parse(JSON.stringify(viaCode.children[0])),viaCode.children[0]);
  }
  for(const args of [{mode:"file",path:localFile,paths:[localFile]},{mode:"workspace",paths:[localFile],allPending:true},{mode:"workspace",allPending:false},{}]){
    const rejected=await run("invalid-diff-shape","plastic_diff",args,addedXml);assert.equal(rejected.calls.length,0);assert(rejected.parent.isError);
  }
  for(const retired of ["plastic_diffFile","plastic_diffRevisions","plastic_workspaceDiff"])assert(!session.getAllTools().some((t:any)=>t.name===retired));
  console.log(`PASS: real Pi host, ${turns} local scripted turns; finalizer/codemode/nested consumers, SDK JSON events, native errors, selective context and foreign-hook fallback; zero network`);
} finally {
  session?.dispose(); globalThis.fetch = originalFetch; delete (globalThis as any).__plasticHostFixture;
  if (previous.executable === undefined) delete process.env.PI_PLASTIC_CM_EXECUTABLE; else process.env.PI_PLASTIC_CM_EXECUTABLE = previous.executable;
  if (previous.mode === undefined) delete process.env.PI_PLASTIC_TOOL_LOADING_MODE; else process.env.PI_PLASTIC_TOOL_LOADING_MODE = previous.mode;
  await rm(fixture, { recursive: true, force: true });
}
