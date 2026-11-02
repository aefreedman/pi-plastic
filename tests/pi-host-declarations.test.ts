import assert from "node:assert/strict";
import { getRegisteredPlasticExportNames, toToolName } from "../src/pi/tool-registry";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Real file loading and QuickJS describeTool, without a provider or SCM connection.
const declaredPi = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).devDependencies;
const sdkUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
assert.ok(sdkUrl.startsWith(new URL("../node_modules/@earendil-works/pi-coding-agent/", import.meta.url).href), "use the package-local SDK, not a parent/global installation");
const localPackageDir = fileURLToPath(new URL("../", sdkUrl));
const previous = { packageDir: process.env.PI_PACKAGE_DIR, executable: process.env.PI_PLASTIC_CM_EXECUTABLE, mode: process.env.PI_PLASTIC_TOOL_LOADING_MODE, cwd: process.cwd(), fetch: globalThis.fetch };
const fixture = await mkdtemp(join(tmpdir(), "pi-plastic-declarations-"));
let session: any;
try {
  process.env.PI_PACKAGE_DIR = localPackageDir;
  const { createAgentSessionServices, createAgentSessionFromServices, createCodemodeExtension, ModelRuntime, SessionManager, SettingsManager } = await import(sdkUrl);
  const config = await import(new URL("./config.js", sdkUrl).href);
  assert.equal(resolve(config.getPackageDir()), resolve(localPackageDir));
  assert.equal(config.VERSION, declaredPi["@earendil-works/pi-coding-agent"]);
  assert.equal(JSON.parse(await readFile(join(localPackageDir, "package.json"), "utf8")).version, declaredPi["@earendil-works/pi-coding-agent"]);
  const tuiUrl = import.meta.resolve("@earendil-works/pi-tui");
  assert.equal(JSON.parse(await readFile(new URL("../package.json", tuiUrl), "utf8")).version, declaredPi["@earendil-works/pi-tui"]);
  assert.equal(execFileSync(process.execPath, [fileURLToPath(new URL("./cli.js", sdkUrl)), "--version"], { env: { ...process.env, PI_PACKAGE_DIR: localPackageDir }, encoding: "utf8" }).trim(), declaredPi["@earendil-works/pi-coding-agent"]);
  const aiUrl = (() => { try { return import.meta.resolve("@earendil-works/pi-ai"); } catch { return new URL("../node_modules/@earendil-works/pi-ai/dist/index.js", sdkUrl).href; } })();
  const ai = await import(aiUrl);
  const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
  process.env.PI_PLASTIC_CM_EXECUTABLE = process.execPath;
  process.env.PI_PLASTIC_TOOL_LOADING_MODE = "all-active";
  process.chdir(fixture);
  globalThis.fetch = (() => { throw Error("Network forbidden in declaration test"); }) as any;
  // Startup may probe patch capabilities. All transport stays in local Node scripts.
  for (const command of ["help", "version"]) await writeFile(join(fixture, command), 'require("node:fs").appendFileSync("calls.jsonl",JSON.stringify(process.argv.slice(1))+"\\n"); console.log("fixture");', { flag: "wx" });
  await writeFile(join(fixture, "calls.jsonl"), "", { flag: "wx" });
  const names = ["plastic_status", "plastic_branchList", "plastic_branchCreate", "plastic_codeReviewDelete", "plastic_diff", "plastic_codeReviewCommentFind", "plastic_codeReviewCommentAdd", "plastic_codeReviewSetStatus", "plastic_codeReviewReviewerAdd", "plastic_branchEditComment"];
  let code = `const declarations = {}; for (const name of ${JSON.stringify(names)}) { const sample = await describeTool(name); if (typeof sample !== "string") throw Error("Missing declaration: " + name); declarations[name] = sample.split("codemode tool declaration:")[1].split("): Promise<")[0]; } text(JSON.stringify(declarations));`;
  let turns = 0;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
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
          const call = { type: "toolCall", id: `declarations-${++turns}`, name: "codemode", arguments: { code } };
          message.content.push(call);
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
          message.stopReason = "toolUse"; stream.push({ type: "done", reason: "toolUse", message });
        } else {
          message.content.push({ type: "text", text: "Done" }); message.stopReason = "stop"; stream.push({ type: "done", reason: "stop", message });
        }
      });
      return stream;
    },
  });
  const createServices = () => createAgentSessionServices({ cwd: fixture, agentDir: join(fixture, "agent"), modelRuntime,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoaderOptions: { additionalExtensionPaths: [extensionPath], extensionFactories: [createCodemodeExtension({ mode: "on", models: false })], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "Run only the local declaration action." },
  });
  const services = await createServices();
  assert.deepEqual(services.diagnostics.filter(d => d.type === "error"), []);
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  ({ session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.create(fixture, join(fixture, "sessions")), model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off", tools: [...getRegisteredPlasticExportNames().map(toToolName), "codemode"] }));
  await session.bindExtensions({ onError: (error: unknown) => { throw error; } });
  for (const name of names) assert.equal(resolve(session.getAllTools().find((t: any) => t.name === name).sourceInfo.path), resolve(extensionPath));
  const coreTools = session.getAllTools().filter((t: any) => t.name.startsWith("plastic_") && t.name !== "plastic_tool_search");
  assert.equal(coreTools.length, getRegisteredPlasticExportNames().length);
  const keywords = new Set<string>();
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { keywords.add(key); inspect(child); }
  };
  for (const tool of coreTools) inspect(session.getToolDefinition(tool.name).parameters);
  // No core input schema declares a pattern or a JSON Schema default. Prose defaults
  // and producer validation must not be mistaken for declaration annotations.
  assert(!keywords.has("pattern")); assert(!keywords.has("default"));
  const diff = session.getToolDefinition("plastic_diff").parameters.anyOf;
  assert.equal(diff[0].properties.path.minLength, 1);
  assert.equal(diff[0].properties.path.maxLength, 1024);
  assert.equal(diff[2].properties.paths.minItems, 1);
  assert.equal(diff[2].properties.paths.maxItems, 20);
  assert.equal(diff[2].properties.paths.items.minLength, 1);
  assert.equal(diff[2].properties.paths.items.maxLength, 1024);
  const branch = session.getToolDefinition("plastic_branchCreate").parameters.properties.branch;
  assert.equal(branch.minimum, 1); assert.equal(branch.minLength, undefined);
  const ids = session.getToolDefinition("plastic_codeReviewDelete").parameters.properties.ids;
  assert.equal(ids.minimum, 1); assert.equal(ids.minItems, undefined);
  await writeFile(join(fixture, "calls.jsonl"), "");
  const events: any[] = [];
  session.subscribe((event: any) => { if (event.type === "tool_execution_end") events.push(event); });
  await session.prompt("Inspect the existing Plastic declarations");
  const result = session.messages.filter((m: any) => m.role === "toolResult").at(-1);
  assert.equal(result.isError, false);
  const output = result.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
  assert.match(output, /Script completed/);
  const jsonLine = output.split("\n").find(line => line.startsWith('{"plastic_status":'));
  assert(jsonLine, "codemode emitted the declaration map without truncation");
  const declarations = JSON.parse(jsonLine);
  // Match tags on the relevant property, not whole declarations or output DTO tags.
  const tagged = (name: string, property: string, tags: string[]) => {
    const comments = declarations[name].match(new RegExp(`((?:\\s*//[^\\n]*\\n)+)\\s*${property}\\??:`))?.[1];
    assert(comments, `${name}.${property} has annotation comments`);
    for (const tag of tags) assert(comments.split(/\s+(?=@)/).some(part => part.trim() === tag || part.trim().endsWith(`// ${tag}`)), `${name}.${property}: missing ${tag}`);
  };
  tagged("plastic_branchList", "maxItems", ["@integer", "@minimum 1", "@maximum 500"]);
  tagged("plastic_branchList", "limit", ["@integer", "@minimum 1", "@maximum 9007199254740991"]);
  tagged("plastic_codeReviewCommentFind", "maxItems", ["@integer", "@minimum 1", "@maximum 500"]);
  tagged("plastic_codeReviewCommentAdd", "line", ["@integer", "@minimum 1"]);
  assert.match(declarations.plastic_codeReviewSetStatus, /"reviewed"/);
  assert.match(declarations.plastic_codeReviewCommentAdd, /"Question"/);
  assert.match(declarations.plastic_branchEditComment, /commentsFile\??:/);
  assert.match(declarations.plastic_codeReviewReviewerAdd, /users\??:/);
  tagged("plastic_status", "maxItems", ["@integer", "@minimum 1", "@maximum 500"]);
  tagged("plastic_diff", "maxChars", ["@integer", "@minimum 500", "@maximum 20000"]);
  tagged("plastic_diff", "path", ["@minLength 1", "@maxLength 1024"]);
  tagged("plastic_diff", "workdir", ["@minLength 1", "@maxLength 4096"]);
  tagged("plastic_diff", "paths", ["@minItems 1", "@maxItems 20"]);
  // Legacy converter preserves min metadata as minimum even on strings/arrays;
  // document current truth, without claiming minLength/minItems enforcement.
  tagged("plastic_branchCreate", "branch", ["@minimum 1"]);
  tagged("plastic_codeReviewDelete", "ids", ["@minimum 1"]);
  for (const declaration of Object.values(declarations) as string[]) assert.doesNotMatch(declaration, /@default|@pattern/);
  assert.equal(turns, 1);
  assert.deepEqual(events.map(e => e.toolName), ["codemode"]);
  assert.equal(await readFile(join(fixture, "calls.jsonl"), "utf8"), "", "describeTool must not execute SCM commands");
  console.log(`PASS: real Pi ${config.VERSION} file-loaded declarations; integer/numeric, string length and array bounds; no input patterns/defaults, zero SCM calls/network`);

  // Dynamic loader behavior through actual host reload/tree/persisted resume.
  process.env.PI_PLASTIC_TOOL_LOADING_MODE = "loader-only";
  session.dispose();
  const loaderServices = await createServices();
  ({ session } = await createAgentSessionFromServices({ services: loaderServices, sessionManager: SessionManager.create(fixture, join(fixture, "loader-sessions")), model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off" }));
  await session.bindExtensions({ onError: (error: unknown) => { throw error; } });
  // Establish an initial persisted branch before activation, with codemode active.
  session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
  code = 'text("loader baseline");';
  await session.prompt("Record the loader-only baseline");
  const plasticActive = () => session.getActiveToolNames().filter((name: string) => name.startsWith("plastic_")).sort();
  assert.deepEqual(plasticActive(), ["plastic_tool_search"]);
  const beforeActivation = session.sessionManager.getLeafId();
  code = 'text(await tools.plastic_tool_search({toolNames:["plastic_branchDelete"]}));';
  await session.prompt("Activate a synthetic capability, without executing it");
  assert.deepEqual(plasticActive(), ["plastic_branchDelete", "plastic_tool_search"]);
  const afterActivation = session.sessionManager.getLeafId();
  await session.reload();
  assert.deepEqual(plasticActive(), ["plastic_branchDelete", "plastic_tool_search"]);
  await session.navigateTree(beforeActivation, { summarize: false });
  assert.deepEqual(plasticActive(), ["plastic_tool_search"]);
  await session.navigateTree(afterActivation, { summarize: false });
  assert.deepEqual(plasticActive(), ["plastic_branchDelete", "plastic_tool_search"]);
  const savedFile = session.sessionFile;
  assert(savedFile);
  session.dispose();
  for (const reason of ["resume", "startup"] as const) {
    const resumedServices = await createServices();
    assert.deepEqual(resumedServices.resourceLoader.getExtensions().errors, []);
    ({ session } = await createAgentSessionFromServices({ services: resumedServices, sessionManager: SessionManager.open(savedFile), sessionStartEvent: { type: "session_start", reason }, model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off" }));
    await session.bindExtensions({});
    assert.deepEqual(plasticActive(), ["plastic_branchDelete", "plastic_tool_search"], `persisted resume via ${reason}`);
    session.dispose();
  }
  // A user-selected inactive mutation tool must remain selected, and excluding
  // the loader must not be overridden by package startup policy.
  for (const mode of ["balanced", "loader-only", "all-active"]) {
    process.env.PI_PLASTIC_TOOL_LOADING_MODE = mode;
    const explicitServices = await createServices();
    ({ session } = await createAgentSessionFromServices({ services: explicitServices, sessionManager: SessionManager.inMemory(fixture), model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off", tools: ["plastic_branchDelete"] }));
    await session.bindExtensions({ onError: (error: unknown) => { throw error; } });
    assert.deepEqual(session.getActiveToolNames(), ["plastic_branchDelete"], `${mode}: respect explicit selection, including excluded loader`);
    await session.reload();
    assert.deepEqual(session.getActiveToolNames(), ["plastic_branchDelete"], `${mode}: reload respects explicit selection`);
    session.dispose();
  }
  process.env.PI_PLASTIC_TOOL_LOADING_MODE = "loader-only";
  const removalServices = await createServices();
  ({ session } = await createAgentSessionFromServices({ services: removalServices, sessionManager: SessionManager.open(savedFile), model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off" }));
  await session.bindExtensions({ onError: (error: unknown) => { throw error; } });
  session.setActiveToolsByName(session.getActiveToolNames().filter((name: string) => name !== "plastic_branchDelete"));
  code = 'text("native removal recorded");';
  await session.prompt("Record deliberate capability removal");
  const removedLeaf = session.sessionManager.getLeafId();
  assert.deepEqual(plasticActive(), ["plastic_tool_search"]);
  await session.reload();
  assert.deepEqual(plasticActive(), ["plastic_tool_search"]);
  await session.navigateTree(afterActivation, { summarize: false });
  assert.deepEqual(plasticActive(), ["plastic_branchDelete", "plastic_tool_search"]);
  await session.navigateTree(removedLeaf, { summarize: false });
  assert.deepEqual(plasticActive(), ["plastic_tool_search"]);
  session.dispose();
  for (const reason of ["resume", "startup"] as const) {
    const removedServices = await createServices();
    ({ session } = await createAgentSessionFromServices({ services: removedServices, sessionManager: SessionManager.open(savedFile), sessionStartEvent: { type: "session_start", reason }, model: modelRuntime.getModel("plastic-local", "fixture")!, thinkingLevel: "off" }));
    await session.bindExtensions({});
    assert.deepEqual(plasticActive(), ["plastic_tool_search"], `native removal survives ${reason}; historical activation must not resurrect it`);
    session.dispose();
  }
  assert.equal(await readFile(join(fixture, "calls.jsonl"), "utf8"), "", "reload/tree/resume/activation never executes SCM");
  console.log("PASS: actual host loader-only initial exposure, activation, explicit selection in all modes, deliberate removal, reload, tree rollback/forward and persisted startup/resume; zero SCM/network");
} finally {
  session?.dispose();
  process.chdir(previous.cwd); globalThis.fetch = previous.fetch;
  for (const [key, value] of [["PI_PACKAGE_DIR", previous.packageDir], ["PI_PLASTIC_CM_EXECUTABLE", previous.executable], ["PI_PLASTIC_TOOL_LOADING_MODE", previous.mode]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  await rm(fixture, { recursive: true, force: true });
}
