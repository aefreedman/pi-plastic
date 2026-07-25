import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type Condition = "all-active" | "balanced" | "loader-only";
type JsonObject = Record<string, unknown>;
type EvalCase = { id: string; prompt: string; requiredTools: string[]; minimalActivatedTools: string[]; forbiddenTools: string[]; requiredPreflightTools?: string[] };
type EvalConfig = {
  piVersionPrefix: string;
  sandboxCwdEnv: string;
  sandboxMarkerFile: string;
  sandboxMarkerContent: string;
  sandboxAuthorizationEnv: string;
  sandboxAuthorizationValue: string;
  timeoutMs: number;
  maxToolCalls: number;
  maxOutputChars: number;
  conditions: Condition[];
  destructiveTools: string[];
};

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "../..");
const CONFIG_PATH = join(HERE, "config.json");
const CASES_PATH = join(HERE, "cases.json");
const BASELINE_PATH = join(HERE, "baseline.json");
const RESULTS_DIR = join(HERE, "results");
const MODEL_PATTERN = /^openai-codex\/gpt-5\.6-(luna|terra|sol)(:(off|minimal|low|medium|high|xhigh|max))?$/;
const LOADER = "plastic_tool_search";
const ACTIVE_BY_CONDITION: Record<Condition, readonly string[]> = {
  "all-active": ["*"],
  balanced: [LOADER, "plastic_status", "plastic_currentBranch"],
  "loader-only": [LOADER],
};

type Options = { trials: number; conditions: Condition[]; caseIds: string[]; model?: string; keep: boolean; includeEvents: boolean; dryRun: boolean };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fail(message: string): never {
  throw new Error(message);
}

function usage(): string {
  return `Usage: npx tsx evals/tool-loading/run-eval.ts --model openai-codex/gpt-5.6-luna[:thinking] [options]

Options:
  --trials <1..5>                 Sequential fresh subprocess trials (default: 1)
  --condition <name[,name]>       all-active, balanced, loader-only (default: all)
  --cases <id[,id]>               Case IDs from cases.json (default: all)
  --model <provider/model>        Required; approved GPT-5.6 Codex model, optionally :<thinking-level>
  --keep                          Keep raw provider capture files in the system temp directory
  --include-events                Include sanitized event crumbs in the JSON summary
  --dry-run                       Validate config and print planned subprocesses without model calls
  --help                          Show this help`;
}

function parseCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseOptions(argv: string[]): Options {
  const options: Options = { trials: 1, conditions: ["all-active", "balanced", "loader-only"], caseIds: [], keep: false, includeEvents: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => argv[++i] ?? fail(`Missing value for ${arg}`);
    if (arg === "--help" || arg === "-h") { console.log(usage()); process.exit(0); }
    if (arg === "--trials") options.trials = Number(value());
    else if (arg === "--condition") options.conditions = parseCsv(value()) as Condition[];
    else if (arg === "--cases") options.caseIds = parseCsv(value());
    else if (arg === "--model") options.model = value();
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--include-events") options.includeEvents = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else fail(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.trials) || options.trials < 1 || options.trials > 5) fail("--trials must be an integer from 1 through 5");
  return options;
}

function validate(config: EvalConfig, cases: EvalCase[], baseline: JsonObject, options: Options): void {
  if (config.piVersionPrefix !== "0.82.") fail("config piVersionPrefix must select the validated Pi 0.82 patch line");
  if (config.sandboxCwdEnv !== "PI_PLASTIC_EVAL_SANDBOX") fail("config sandboxCwdEnv must use the dedicated eval environment variable");
  if (config.sandboxMarkerFile !== ".pi-plastic-eval-sandbox" || config.sandboxMarkerContent !== "pi-plastic-eval-sandbox\n") fail("config sandbox marker attestation is invalid");
  if (config.sandboxAuthorizationEnv !== "PI_PLASTIC_EVAL_ALLOW" || config.sandboxAuthorizationValue !== "dedicated-sandbox") fail("config sandbox authorization attestation is invalid");
  if (!Array.isArray(config.conditions) || !config.conditions.every((value) => ["all-active", "balanced", "loader-only"].includes(value))) fail("Invalid conditions in config.json");
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0 || !Number.isInteger(config.maxToolCalls) || config.maxToolCalls <= 0 || !Number.isInteger(config.maxOutputChars) || config.maxOutputChars <= 0) fail("Invalid numeric bounds in config.json");
  const ids = new Set<string>();
  for (const testCase of cases) {
    if (!testCase.id || ids.has(testCase.id) || !testCase.prompt || !Array.isArray(testCase.requiredTools) || !Array.isArray(testCase.minimalActivatedTools) || !Array.isArray(testCase.forbiddenTools) || (testCase.requiredPreflightTools !== undefined && !Array.isArray(testCase.requiredPreflightTools))) fail("Invalid or duplicate case in cases.json");
    if ((testCase.requiredPreflightTools ?? []).some((tool) => !testCase.requiredTools.includes(tool))) fail(`Preflight tool must also be required in case ${testCase.id}`);
    if (new Set(testCase.minimalActivatedTools).size !== testCase.minimalActivatedTools.length || testCase.minimalActivatedTools.some((tool) => !testCase.requiredTools.includes(tool)) || testCase.requiredTools.some((tool) => !testCase.minimalActivatedTools.includes(tool))) fail(`minimalActivatedTools must be the exact smallest sufficient required-tool set in case ${testCase.id}`);
    ids.add(testCase.id);
  }
  for (const condition of options.conditions) if (!config.conditions.includes(condition)) fail(`Unknown condition: ${condition}`);
  for (const id of options.caseIds) if (!ids.has(id)) fail(`Unknown case: ${id}`);
  const legacy = baseline.legacyBaseline as JsonObject | undefined;
  const conditions = baseline.implementedConditions as JsonObject | undefined;
  if (legacy?.toolCount !== 29 || legacy.serializedSchemaChars !== 21192 || legacy.estimatedTokens !== 5298 || legacy.promptMetadataChars !== 0) fail("baseline.json legacy measurement does not match the untouched baseline");
  if (!conditions || (conditions.balanced as JsonObject)?.toolCount !== 3 || (conditions["loader-only"] as JsonObject)?.toolCount !== 1 || (conditions["all-active"] as JsonObject)?.toolCount !== 29) fail("baseline.json implemented condition metadata is incomplete");
}

function isInitiallyActive(condition: Condition, tool: string): boolean {
  return ACTIVE_BY_CONDITION[condition].includes("*") || ACTIVE_BY_CONDITION[condition].includes(tool);
}

function expectedLoaderCalls(condition: Condition, testCase: EvalCase): number {
  if (testCase.id === "negative-no-operation") return 0;
  return testCase.minimalActivatedTools.some((tool) => !isInitiallyActive(condition, tool)) ? 1 : 0;
}

function sameToolSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tool) => right.includes(tool));
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsage(message: JsonObject): Record<string, number> {
  const usage = (message.usage ?? {}) as JsonObject;
  const input = numeric(usage.input ?? usage.inputTokens);
  const output = numeric(usage.output ?? usage.outputTokens);
  const cacheRead = numeric(usage.cacheRead ?? usage.cache_read_tokens);
  const cacheWrite = numeric(usage.cacheWrite ?? usage.cache_write_tokens);
  return { input, output, cacheRead, cacheWrite, total: numeric(usage.totalTokens) || input + output + cacheRead + cacheWrite };
}

function findTools(payload: unknown): unknown[] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) { const found = findTools(item); if (found) return found; }
    return undefined;
  }
  const object = payload as JsonObject;
  if (Array.isArray(object.tools)) return object.tools;
  for (const value of Object.values(object)) { const found = findTools(value); if (found) return found; }
  return undefined;
}

function nativeMarkers(value: unknown, markers = { toolSearchCall: 0, toolSearchOutput: 0 }): typeof markers {
  if (Array.isArray(value)) {
    for (const item of value) nativeMarkers(item, markers);
  } else if (value && typeof value === "object") {
    const object = value as JsonObject;
    if (object.type === "tool_search_call") markers.toolSearchCall += 1;
    if (object.type === "tool_search_output") markers.toolSearchOutput += 1;
    for (const item of Object.values(object)) nativeMarkers(item, markers);
  }
  return markers;
}

function sanitizeEvent(event: JsonObject): JsonObject {
  const clean: JsonObject = { type: event.type };
  if (typeof event.toolName === "string") clean.toolName = event.toolName;
  if (typeof event.isError === "boolean") clean.isError = event.isError;
  const message = event.message as JsonObject | undefined;
  if (message && typeof message.role === "string") {
    clean.role = message.role;
    clean.hasError = typeof message.errorMessage === "string" && message.errorMessage.length > 0;
  }
  return clean;
}

async function runProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, maxOutputChars: number): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; outputLimitExceeded: boolean; wallTimeMs: number }> {
  const started = performance.now();
  return await new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProcess({ stdout, stderr, exitCode, timedOut, outputLimitExceeded, wallTimeMs: Math.round(performance.now() - started) });
    };
    const terminate = () => {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else child.kill("SIGTERM");
    };
    const stopForOutput = () => {
      if (outputLimitExceeded) return;
      outputLimitExceeded = true;
      terminate();
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length + stderr.length > maxOutputChars) stopForOutput(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); if (stdout.length + stderr.length > maxOutputChars) stopForOutput(); });
    // Treat launch failures as failed trial results so raw capture cleanup and the
    // sanitized aggregate still happen; never surface child output verbatim.
    child.once("error", () => finish(null));
    child.once("close", finish);
  });
}

function parseCapture(path: string): { providerRequests: number; initialToolCount?: number; initialToolSchemaChars?: number; nativeToolSearch: { toolSearchCall: number; toolSearchOutput: number }; captureParseErrors: number } {
  const answer = { providerRequests: 0, initialToolCount: undefined as number | undefined, initialToolSchemaChars: undefined as number | undefined, nativeToolSearch: { toolSearchCall: 0, toolSearchOutput: 0 }, captureParseErrors: 0 };
  if (!existsSync(path)) return answer;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const record = JSON.parse(line) as JsonObject;
      answer.providerRequests += 1;
      const payload = record.payload;
      if (answer.initialToolCount === undefined) {
        const tools = findTools(payload);
        if (tools) {
          answer.initialToolCount = tools.length;
          answer.initialToolSchemaChars = JSON.stringify(tools).length;
        }
      }
      const markers = nativeMarkers(payload);
      answer.nativeToolSearch.toolSearchCall += markers.toolSearchCall;
      answer.nativeToolSearch.toolSearchOutput += markers.toolSearchOutput;
    } catch { answer.captureParseErrors += 1; }
  }
  return answer;
}

function parseTrial(stdout: string, stderr: string, processResult: Awaited<ReturnType<typeof runProcess>>, capturePath: string, condition: Condition, testCase: EvalCase, config: EvalConfig, includeEvents: boolean): JsonObject {
  const events: JsonObject[] = [];
  let invalidJsonLines = 0;
  const toolCalls: string[] = [];
  const toolCallRecords: Array<{ name: string; args: JsonObject }> = [];
  const toolErrors: string[] = [];
  const activated: string[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let assistantErrors = 0;
  let assistantMessages = 0;

  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    let event: JsonObject;
    try { event = JSON.parse(line) as JsonObject; } catch { invalidJsonLines += 1; continue; }
    if (includeEvents) events.push(sanitizeEvent(event));
    if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
      toolCalls.push(event.toolName);
      toolCallRecords.push({ name: event.toolName, args: event.args && typeof event.args === "object" ? event.args as JsonObject : {} });
    }
    if (event.type === "tool_execution_end") {
      if (event.isError === true && typeof event.toolName === "string") toolErrors.push(event.toolName);
      const result = event.result as JsonObject | undefined;
      const details = result?.details as JsonObject | undefined;
      if (Array.isArray(details?.added)) activated.push(...details.added.filter((name): name is string => typeof name === "string"));
    }
    if (event.type === "message_end") {
      const message = event.message as JsonObject | undefined;
      if (message?.role === "assistant") {
        assistantMessages += 1;
        const current = readUsage(message);
        for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] += current[key];
        if (typeof message.errorMessage === "string" && message.errorMessage.length > 0) assistantErrors += 1;
      }
    }
  }

  const capture = parseCapture(capturePath);
  const counts = Object.fromEntries([...new Set(toolCalls)].map((tool) => [tool, toolCalls.filter((entry) => entry === tool).length]));
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];
  const loaderExpected = expectedLoaderCalls(condition, testCase);
  for (const tool of testCase.requiredTools) checks.push({ name: `required:${tool}`, pass: counts[tool] === 1, detail: `observed ${counts[tool] ?? 0}` });
  for (const tool of testCase.requiredPreflightTools ?? []) {
    const records = toolCallRecords.filter((call) => call.name === tool);
    checks.push({ name: `preflight:${tool}`, pass: records.length === 1 && records[0].args.preflight === true, detail: records.length === 1 ? `preflight=${String(records[0].args.preflight)}` : `observed ${records.length} calls` });
  }
  for (const tool of testCase.forbiddenTools) checks.push({ name: `forbidden:${tool}`, pass: !counts[tool], detail: `observed ${counts[tool] ?? 0}` });
  checks.push({ name: "loader-count", pass: (counts[LOADER] ?? 0) === loaderExpected, detail: `expected ${loaderExpected}, observed ${counts[LOADER] ?? 0}` });
  if (loaderExpected > 0) {
    const expectedActivated = testCase.minimalActivatedTools.filter((tool) => !isInitiallyActive(condition, tool));
    const actualActivated = [...new Set(activated)];
    checks.push({ name: "exact-smallest-sufficient-activation", pass: sameToolSet(actualActivated, expectedActivated), detail: `expected ${expectedActivated.join(", ") || "none"}; observed ${actualActivated.join(", ") || "none"}` });
  }
  const nativeMarkerPairs = Math.min(capture.nativeToolSearch.toolSearchCall, capture.nativeToolSearch.toolSearchOutput);
  checks.push({
    name: "native-deferred-markers",
    pass: loaderExpected > 0 ? nativeMarkerPairs >= 1 : nativeMarkerPairs === 0,
    detail: `expected ${loaderExpected > 0 ? "at least one" : "zero"}; call=${capture.nativeToolSearch.toolSearchCall}, output=${capture.nativeToolSearch.toolSearchOutput}`,
  });
  checks.push({ name: "max-four-activated", pass: activated.length <= 4, detail: `observed ${activated.length}` });
  if (testCase.id === "negative-no-operation" || testCase.id === "ambiguous-branch-discovery") {
    const destructive = new Set(config.destructiveTools);
    const unsafeActivations = activated.filter((tool) => destructive.has(tool));
    const unsafeCalls = toolCalls.filter((tool) => destructive.has(tool));
    checks.push({ name: "no-destructive-activation", pass: unsafeActivations.length === 0, detail: unsafeActivations.join(", ") || "none" });
    checks.push({ name: "no-destructive-calls", pass: unsafeCalls.length === 0, detail: unsafeCalls.join(", ") || "none" });
    if (testCase.id === "negative-no-operation") checks.push({ name: "no-plastic-operation", pass: toolCalls.length === 0, detail: toolCalls.join(", ") || "none" });
  }
  checks.push({ name: "no-tool-errors", pass: toolErrors.length === 0, detail: toolErrors.join(", ") || "none" });
  checks.push({ name: "no-assistant-errors", pass: assistantErrors === 0, detail: String(assistantErrors) });
  checks.push({ name: "bounded-tool-calls", pass: toolCalls.length <= config.maxToolCalls, detail: `${toolCalls.length}/${config.maxToolCalls}` });
  checks.push({ name: "bounded-output", pass: !processResult.outputLimitExceeded, detail: `${stdout.length + stderr.length}/${config.maxOutputChars}` });
  checks.push({ name: "not-timed-out", pass: !processResult.timedOut, detail: `${processResult.wallTimeMs}ms` });
  checks.push({ name: "process-exit", pass: processResult.exitCode === 0, detail: String(processResult.exitCode) });
  checks.push({ name: "clean-jsonl", pass: invalidJsonLines === 0, detail: String(invalidJsonLines) });

  return {
    condition, caseId: testCase.id, pass: checks.every((check) => check.pass), checks,
    wallTimeMs: processResult.wallTimeMs, exitCode: processResult.exitCode, timedOut: processResult.timedOut,
    outputChars: stdout.length + stderr.length, toolCalls, toolCallCounts: counts,
    loaderRequests: toolCallRecords.filter((call) => call.name === LOADER).map((call) => ({ query: call.args.query, toolNames: call.args.toolNames, limit: call.args.limit })),
    activated: [...new Set(activated)], toolErrors,
    assistantMessages, providerRequests: capture.providerRequests,
    assistantUsage: usage, initialToolSchema: { toolCount: capture.initialToolCount, serializedChars: capture.initialToolSchemaChars },
    nativeToolSearch: capture.nativeToolSearch, captureParseErrors: capture.captureParseErrors,
    ...(includeEvents ? { events } : {}),
  };
}

function timestamp(): string { return new Date().toISOString().replace(/[:.]/g, "-"); }

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const config = readJson<EvalConfig>(CONFIG_PATH);
  const cases = readJson<{ cases: EvalCase[] }>(CASES_PATH).cases;
  const baseline = readJson<JsonObject>(BASELINE_PATH);
  validate(config, cases, baseline, options);
  const selectedCases = options.caseIds.length ? cases.filter((testCase) => options.caseIds.includes(testCase.id)) : cases;
  if (!options.dryRun && !options.model) fail("--model is required for a live model evaluation");
  if (options.model && !MODEL_PATTERN.test(options.model)) fail("--model must match openai-codex/gpt-5.6-(luna|terra|sol), optionally followed by a supported thinking level");
  const configuredSandbox = process.env[config.sandboxCwdEnv]?.trim();
  if (!options.dryRun && !configuredSandbox) fail(`Set ${config.sandboxCwdEnv} to the dedicated Plastic sandbox path`);
  const sandboxCwd = configuredSandbox ? resolve(configuredSandbox) : `<${config.sandboxCwdEnv}>`;
  if (!options.dryRun) {
    if (!existsSync(sandboxCwd)) fail(`Dedicated sandbox does not exist: ${sandboxCwd}`);
    const markerPath = join(sandboxCwd, config.sandboxMarkerFile);
    if (!existsSync(markerPath) || readFileSync(markerPath, "utf8") !== config.sandboxMarkerContent) fail(`Dedicated sandbox must contain ${config.sandboxMarkerFile} with the documented exact content`);
    if (process.env[config.sandboxAuthorizationEnv] !== config.sandboxAuthorizationValue) fail(`Set ${config.sandboxAuthorizationEnv}=${config.sandboxAuthorizationValue} to attest the dedicated sandbox`);
  }

  const piPackagePath = join(PACKAGE_ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  const piVersion = existsSync(piPackagePath) ? (readJson<{ version?: string }>(piPackagePath).version ?? "unknown") : "missing";
  if (!piVersion.startsWith(config.piVersionPrefix)) fail(`This eval requires the Pi 0.82 patch line; found ${piVersion}`);
  const piCli = join(PACKAGE_ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  const baseArgs = ["--mode", "json", "--no-session", "--no-approve", "--no-context-files", "--no-extensions", "-e", join(PACKAGE_ROOT, "index.ts"), "-e", join(HERE, "mutation-guard.ts"), "-e", join(HERE, "provider-capture.ts"), "--no-skills", "--no-prompt-templates", "--no-builtin-tools"];
  if (options.dryRun) {
    console.log(`VALID: ${selectedCases.length} cases × ${options.conditions.length} conditions × ${options.trials} trial(s)`);
    console.log(`Pi 0.82 subprocess: ${process.execPath} ${piCli} ${baseArgs.join(" ")} --model <approved-model> <case-prompt>`);
    console.log(`cwd: ${sandboxCwd}`);
    return;
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const trials: JsonObject[] = [];
  for (const condition of options.conditions) {
    for (const testCase of selectedCases) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        const capturePath = join(tmpdir(), `pi-plastic-tool-loading-${process.pid}-${Date.now()}-${condition}-${testCase.id}-${trial}.jsonl`);
        const args = [...baseArgs, "--model", options.model!, testCase.prompt];
        const result = await runProcess(process.execPath, [piCli, ...args], sandboxCwd, { ...process.env, PI_PLASTIC_TOOL_LOADING_MODE: condition, PI_PLASTIC_EVAL_PROVIDER_CAPTURE: capturePath }, config.timeoutMs, config.maxOutputChars);
        const summary = parseTrial(result.stdout, result.stderr, result, capturePath, condition, testCase, config, options.includeEvents);
        if (options.keep) summary.rawCapturePath = capturePath;
        else rmSync(capturePath, { force: true });
        trials.push({ trial, ...summary });
        console.log(`${condition} ${testCase.id} #${trial}: ${summary.pass ? "PASS" : "FAIL"} (${summary.wallTimeMs}ms)`);
      }
    }
  }
  const passed = trials.filter((trial) => trial.pass === true).length;
  const report = { schemaVersion: 2, generatedAt: new Date().toISOString(), sandbox: "attested dedicated sandbox", model: options.model, options: { trials: options.trials, conditions: options.conditions, cases: selectedCases.map((testCase) => testCase.id), includeEvents: options.includeEvents, rawCapturesKept: options.keep }, baseline, aggregate: { trials: trials.length, passed, failed: trials.length - passed }, trials };
  const reportPath = join(RESULTS_DIR, `tool-loading-${timestamp()}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Aggregate: ${passed}/${trials.length} passed; sanitized summary: ${reportPath}`);
  if (passed !== trials.length) process.exitCode = 1;
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? `ERROR: ${error.message}` : "ERROR: evaluation failed"); process.exitCode = 1; });
