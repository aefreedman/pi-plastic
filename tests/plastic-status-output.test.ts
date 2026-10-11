import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import type { SpawnAndCollectDependencies } from "../src/execution/process";
import { runWithAbortSignal } from "../src/execution/context";
import { diagnoseMachineReadablePendingItems, hasStatusPathDecodingLoss, parseMachineReadablePendingItems } from "../src/domain/pending";
import { projectStatusOutput, validateStatusOutput, statusOutputSchema } from "../src/pi/status-output";
import { loadRegisteredTools } from "./pi-tool-harness";
import { STATUS_PRESENTATION_MAX_BYTES, STATUS_RAW_PRESENTATION_MAX_BYTES } from "../src/pi/status-output";
import { xmlRecord, xmlStatus } from "./fixtures/status-xml";

const tools = await loadRegisteredTools();
const status = tools.get("plastic_status")!;
assert.deepEqual(status.outputSchema, statusOutputSchema);
for (const tool of tools.values()) if (!["plastic_status", "plastic_currentBranch", "plastic_branchList", "plastic_branchExists", "plastic_diff", "plastic_patch", "plastic_codeReviewFind", "plastic_shelvesetList", "plastic_workspaceList", "plastic_mergeBranches", "plastic_checkin", "plastic_branchCreate", "plastic_switchBranch", "plastic_update", "plastic_add", "plastic_undo", "plastic_resolveDeleteChangeConflict", "plastic_merge", "plastic_finalizeMerge", "plastic_mergeToBranch", "plastic_branchDelete", "plastic_shelvesetCreate", "plastic_shelvesetApply", "plastic_shelvesetDelete", "plastic_codeReviewCreate", "plastic_codeReviewUpdate", "plastic_codeReviewDelete"].includes(tool.name)) assert.equal(tool.outputSchema, undefined);
const sep = "\x1f";
const record = (path: string, code = "CH") => [code, path, "False", "0", "NO_MERGES"].join(sep);
const machine = (output: string) => ({ kind: "machine" as const, output, capture: "complete" as const, cwd: "/fixture", requestedShort: false, ...diagnoseMachineReadablePendingItems(output, "/fixture") });
const calls: string[][] = [];
const invoke = async (output: string, args: Record<string, unknown> = {}, exitCode = 0, stderr = "", execution: SpawnAndCollectDependencies = {}, failSecond = false) => {
  calls.length = 0;
  const spawn = ((command: string, argv: string[]) => {
    calls.push(argv);
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true });
    queueMicrotask(() => { child.stdout.end(argv[0] === "version" ? "fixture-version" : output); child.stderr.end(stderr); child.emit("close", failSecond && calls.length === 2 ? 1 : exitCode, null); });
    return child;
  }) as any;
  const result = await runWithAbortSignal(undefined, () => status.execute("fixture", { machineReadable: true, ...args }, undefined, undefined, { cwd: "/fixture" }), { spawn, ...execution });
  assert(Check(statusOutputSchema, result.structuredContent));
  return result;
};
const output = [record("space ü.txt"), ["MV", "100%", "old.txt", "new.txt", "False", "41", "NO_MERGES"].join(sep), record("deleted.txt", "DE")].join("\n");
const text = await invoke(output, { maxItems: 1 });
assert.equal(calls.length, 1); assert.equal(text.details.workdir, "/fixture");
assert.equal(text.structuredContent.data.items[0].revisionId, "0");
assert.equal(text.structuredContent.data.items[0].isDirectory, false);
assert.equal(text.structuredContent.data.mergeHints, undefined);
assert.deepEqual(text.structuredContent.data.itemCount, { parsed: 3, returned: 1, omitted: 2, excluded: 0, overCap: 2 });
assert.match(text.details.rawResult, /space ü/);
const json = await invoke(output, { maxItems: 1, format: "json", includeRaw: true });
assert.deepEqual(json.structuredContent, text.structuredContent);
assert.equal(calls.filter(call => call[0] === "status").length, 1);
assert.match(json.details.rawResult, /rawOutput/);
assert.equal(JSON.stringify(json.structuredContent).includes("rawOutput"), false);
// Registered adapter must preserve identities split across subprocess byte chunks.
const unicodeRecord = record("space ü 日本 😀.txt", "PR").replace(`${sep}0${sep}`, `${sep}-1${sep}`);
const unicodeBytes = Buffer.from(unicodeRecord);
const splitSpawn = (() => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true });
  void (async () => {
    for (const byte of unicodeBytes) {
      child.stdout.write(Buffer.from([byte]));
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);
  })();
  return child;
}) as any;
const splitResult = await runWithAbortSignal(undefined, () => status.execute("fixture", { machineReadable: true }, undefined, undefined, { cwd: "/fixture" }), { spawn: splitSpawn });
assert.equal(splitResult.structuredContent.completeness.read, "complete");
assert.equal(splitResult.structuredContent.data.items[0].path, "space ü 日本 😀.txt");
assert.equal(splitResult.structuredContent.data.items[0].revisionId, undefined);
const full = await invoke(output);
assert.equal(full.structuredContent.data.items[1].sourcePath, "old.txt");
for (const raw of ["", `STATUS${sep}16${sep}fixture-repo${sep}fixture-server\n`]) {
  const empty = await invoke(raw);
  assert.equal(empty.structuredContent.completeness.read, "complete");
  assert.equal(empty.structuredContent.data.itemCount.parsed, 0);
}
for (const raw of ["malformed-only", `CH${sep}missing-directory`, "MV 100% old new False 1", record("known") + "\nunsupported", record("unknown", "ZZ"), record("unknown-composite", "CHZZ"), `STATUS${sep}oops${sep}repo${sep}server`, `STATUS${sep}16${sep}repo`, "STATUS broken", `CH${sep}bad-revision${sep}False${sep}oops`]) {
  const partial = await invoke(raw);
  assert.equal(partial.structuredContent.completeness.read, "incomplete");
  assert.deepEqual(diagnoseMachineReadablePendingItems(raw, "/fixture").pendingItems, parseMachineReadablePendingItems(raw, "/fixture"));
}
// Status sanitizes legacy revision prefixes without changing checkin/diff selection consumers.
for (const token of ["41.5", "oops", "41/5", "41\uFFFD"]) {
  const legacy = `CH file.txt False ${token}`;
  const original = parseMachineReadablePendingItems(legacy, "/fixture");
  assert.equal(original.length, 1);
  assert.equal(original[0].revisionId, token.startsWith("41") ? "41" : undefined);
  for (const raw of [legacy, `CH${sep}file.txt${sep}False${sep}${token}${sep}NO_MERGES`, ["MV", "100%", "old.txt", "new.txt", "False", token, "NO_MERGES"].join(sep)]) {
    const partial = await invoke(raw);
    assert.equal(partial.structuredContent.completeness.read, "incomplete");
    assert.equal(partial.structuredContent.data.parse.malformed, 1);
    assert.equal(partial.structuredContent.data.itemCount.parsed, 1);
    assert.equal(partial.structuredContent.data.itemCount.returned, 1);
    assert.equal(partial.structuredContent.data.items[0].revisionId, undefined);
    assert.equal(diagnoseMachineReadablePendingItems(raw, "/fixture").pendingItems[0].revisionId, undefined);
  }
  assert.deepEqual(parseMachineReadablePendingItems(legacy, "/fixture"), original);
}
for (const suffix of ["41", "41 NO_MERGES", "0 NO_MERGES", "-1 NO_MERGES", ""]) {
  const validLegacy = await invoke(`CH file.txt False ${suffix}`);
  assert.equal(validLegacy.structuredContent.completeness.read, "complete");
  assert.equal(validLegacy.structuredContent.data.items[0].revisionId, /^\d+/.exec(suffix)?.[0]);
}
const noBase = await invoke(record("private", "PR").replace(`${sep}0${sep}`, `${sep}-1${sep}`));
assert.equal(noBase.structuredContent.completeness.read, "complete");
assert.equal(noBase.structuredContent.data.items[0].revisionId, undefined);
for (const raw of [record("lossy \uFFFD.txt"), ["MV", "100%", "lossy \uFFFD.txt", "destination", "False", "41"].join(sep)]) {
  const lossy = await invoke(raw);
  assert.equal(lossy.structuredContent.completeness.read, "incomplete");
  assert.equal(lossy.structuredContent.completeness.projection, false);
  assert.equal(lossy.structuredContent.data.itemCount.parsed, 1);
  assert.equal(lossy.structuredContent.data.itemCount.excluded, 1);
  assert.equal(lossy.structuredContent.data.items.length, 0);
  assert.deepEqual(diagnoseMachineReadablePendingItems(raw, "/fixture").pendingItems, parseMachineReadablePendingItems(raw, "/fixture"));
}
// Platform-specific pre-decoding loss: do not outlaw valid POSIX '?' names.
for (const platform of ["win32", "linux", "darwin"] as const) {
  assert.equal(hasStatusPathDecodingLoss("lost?.txt", platform), platform === "win32");
  assert.equal(hasStatusPathDecodingLoss("lost\uFFFD.txt", platform), true);
  assert.equal(hasStatusPathDecodingLoss("valid ü 日本 😀.txt", platform), false);
  for (const raw of [record("lost?.txt"), ["MV", "100%", "lost?.txt", "destination.txt", "False", "41"].join(sep)]) {
    const diagnosed = diagnoseMachineReadablePendingItems(raw, "/fixture", platform);
    assert.equal(diagnosed.diagnostics.malformed, platform === "win32" ? 1 : 0);
    assert.equal(diagnosed.pendingItems.length, 1);
    assert.deepEqual(diagnosed.pendingItems, parseMachineReadablePendingItems(raw, "/fixture"));
  }
}
for (const raw of [record("lost?.txt"), ["MV", "100%", "lost?.txt", "destination.txt", "False", "41"].join(sep)]) {
  const result = await invoke(raw);
  assert.equal(result.structuredContent.completeness.read, process.platform === "win32" ? "incomplete" : "complete");
  assert.equal(result.structuredContent.data.itemCount.parsed, 1);
  assert.equal(result.structuredContent.data.itemCount.excluded, process.platform === "win32" ? 1 : 0);
  assert.equal(result.structuredContent.data.items.length, process.platform === "win32" ? 0 : 1);
}
const excluded = projectStatusOutput(machine(record("x".repeat(4097))));
assert(excluded.ok && excluded.data.mode === "machine");
assert.equal(excluded.data.itemCount.excluded, 1); assert.equal(excluded.completeness.projection, false);
const overflow = projectStatusOutput(machine(Array.from({ length: 100 }, (_, i) => record("ü".repeat(4000) + i)).join("\n")));
assert(!overflow.ok); assert.equal(overflow.error.code, "output_overflow");
for (const value of [undefined, {}, { ok: true }, { ...text.structuredContent, extra: true }]) {
  const invalid = validateStatusOutput(value); assert(!invalid.ok); assert.equal(invalid.error.code, "invalid_producer_data");
}
const failure = await invoke("private path and command arguments", {}, 1);
assert(failure.isError); assert.equal(failure.structuredContent.error.code, "command_failed");
assert.equal(JSON.stringify(failure).includes("private path"), false); assert.equal(calls.length, 1);
const stderr = await invoke("", {}, 0, "unclassified diagnostic");
assert.equal(stderr.structuredContent.completeness.capture, "unknown"); assert.equal(stderr.structuredContent.completeness.read, "unknown");
const controller = new AbortController(); controller.abort();
const aborted = await status.execute("abort", {}, controller.signal, undefined, { cwd: "/fixture" });
assert.equal(aborted.structuredContent.error.code, "aborted"); assert.equal(aborted.isError, true);
for (const format of ["text", "json"]) for (const short of [false, true]) {
  const standard = await invoke("Pending merge links\nMerge from fixture\nMerge in progress", { machineReadable: false, format, short });
  assert.equal(standard.structuredContent.data.mode, "standard"); assert.equal(standard.structuredContent.data.items, undefined);
  assert.equal(standard.structuredContent.completeness.read, "unknown");
  assert.equal(standard.structuredContent.data.requestedShort, short);
  assert.equal(standard.structuredContent.data.mergeHints.hasMergeInProgress, true);
  assert.equal(calls.filter(call => call[0] === "status").length, 2);
  if (format === "text") assert.equal(calls.length, 2);
}
for (const format of ["text", "json"]) for (const short of [false, true]) {
  const matrix = await invoke(output, { format, short });
  assert.equal(matrix.structuredContent.data.requestedShort, short);
  assert.equal(matrix.structuredContent.data.mode, "machine");
  assert.equal(calls.filter(call => call[0] === "status").length, 1);
  assert.equal(calls[0].includes("--short"), short);
}
for (const execution of [
  { outputLimitChars: 1 },
  { timeoutMs: 1, setTimeout: (callback: () => void) => { queueMicrotask(callback); return 0 as unknown as NodeJS.Timeout; }, clearTimeout: () => {} },
] satisfies SpawnAndCollectDependencies[]) {
  const capture = await invoke(output, {}, 0, "", execution);
  assert.equal(capture.isError, true); assert.equal(capture.structuredContent.error.code, "capture_incomplete");
  assert.equal(calls.length, 1);
}
const truncatedStderr = await invoke("", {}, 0, "private diagnostic", { outputLimitChars: 1 });
assert.equal(truncatedStderr.structuredContent.error.code, "capture_incomplete");
assert.doesNotMatch(JSON.stringify(truncatedStderr), /private diagnostic/);
const secondFailure = await invoke("classified", { machineReadable: false }, 0, "", {}, true);
assert.equal(secondFailure.isError, true); assert.equal(secondFailure.structuredContent.error.code, "command_failed");
assert.equal(secondFailure.structuredContent.data, undefined); assert.equal(calls.length, 2);
for (const raw of [record("revision", "CH").replace(`${sep}0${sep}`, `${sep}${"1".repeat(129)}${sep}`), ["MV", "100%", "x".repeat(4097), "destination", "False", "41"].join(sep), record("status", "CH".repeat(33))]) {
  const excludedIdentity = projectStatusOutput(machine(raw));
  assert(excludedIdentity.ok && excludedIdentity.data.mode === "machine");
  assert.equal(excludedIdentity.data.itemCount.excluded, 1); assert.equal(excludedIdentity.data.items.length, 0);
}
assert.equal(Check(statusOutputSchema, { ...text.structuredContent, data: { ...text.structuredContent.data, parse: {} } }), false);
assert.equal(Check(statusOutputSchema, { ...text.structuredContent, data: { ...text.structuredContent.data, items: [{ ...text.structuredContent.data.items[0], kind: "invented" }] } }), false);
const capped = await invoke(Array.from({ length: 501 }, (_, i) => record(String(i))).join("\n"), { maxItems: 500 });
assert.equal(capped.structuredContent.data.itemCount.omitted, 1);
// Direct content is useful even to consumers that never inspect details or the DTO.
const content = (result: any) => result.content.map((block: any) => block.text).join("\n");
for (const format of ["text", "json"] as const) {
  const moved = await invoke(output, { format });
  assert.match(content(moved), /space ü.txt/);
  assert.match(content(moved), /old.txt/); assert.match(content(moved), /new.txt/);
  assert.equal(content(moved), moved.details.rawResult);
  if (format === "json") {
    const parsed = JSON.parse(content(moved));
    assert.equal(parsed.data.items[0].revisionId, "0"); assert.equal(parsed.data.items[0].isDirectory, false);
    assert.equal(parsed.data.items[1].sourcePath, "old.txt");
  }
  const omitted = await invoke(output, { format, maxItems: 1 });
  if (format === "json") assert.equal(JSON.parse(content(omitted)).data.presentation.omitted, 2);
  else assert.match(content(omitted), /2 omitted/);
  const unsafe = await invoke(record("lost\uFFFD.txt") + "\n" + record("safe.txt"), { format, includeRaw: true });
  assert.doesNotMatch(content(unsafe), /lost/); assert.match(content(unsafe), /safe.txt/);
  assert.match(content(unsafe), /withheld/); assert.match(content(unsafe), /incomplete/);
  const standard = await invoke("Changed Assets/日本😀.txt\nMoved old.txt -> new.txt\nPending merge links\nMerge from fixture\nMerge in progress", { machineReadable: false, format });
  assert.match(content(standard), /Assets\/日本😀.txt/); assert.match(content(standard), /old.txt/);
  assert.match(content(standard), /Merge from fixture/); assert.match(content(standard), /unknown/);
  if (format === "json") {
    const parsed = JSON.parse(content(standard)); assert.equal(parsed.data.mergeHints.hasPendingMergeLinks, true);
    assert.equal(parsed.data.mergeHints.hasMergeInProgress, true);
  }
  const xml = await invoke(xmlStatus(xmlRecord("/synthetic/new😀.txt", "MV", "/synthetic/old日本.txt")), { machineReadable: undefined, source: "xml", format });
  assert.match(content(xml), /old日本.txt/); assert.match(content(xml), /new😀.txt/);
  assert.equal(calls.length, 1);
  if (format === "json") assert.equal(JSON.parse(content(xml)).data.source.baseRevisionAvailability, "unavailable");
  const xmlBudget = await invoke(xmlStatus(Array.from({ length: 100 }, (_, i) => xmlRecord(`/synthetic/${i}-${"😀".repeat(200)}.txt`)).join("")), { machineReadable: undefined, source: "xml", format, includeRaw: true });
  assert.equal(calls.length, 1); assert.equal(xmlBudget.structuredContent.data.itemCount.returned, 100);
  assert(Buffer.byteLength(content(xmlBudget), "utf8") <= STATUS_PRESENTATION_MAX_BYTES);
  if (format === "json") {
    const parsed = JSON.parse(content(xmlBudget)); assert(parsed.data.presentation.omitted > 0);
    assert.equal(parsed.data.itemCount.returned, parsed.data.items.length);
    assert.equal(parsed.data.nativeItemCount.returned, 100);
    assert.match(parsed.rawOutput.source, /status_xml/);
    assert(Buffer.byteLength(parsed.rawOutput.text, "utf8") <= STATUS_RAW_PRESENTATION_MAX_BYTES);
  }
  const largeRows = Array.from({ length: 100 }, (_, i) => record(`${i}-${"😀".repeat(200)}.txt`)).join("\n");
  const budget = await invoke(largeRows, { format, includeRaw: true });
  assert.equal(budget.structuredContent.data.itemCount.returned, 100, "presentation does not shrink native rows");
  assert(Buffer.byteLength(content(budget), "utf8") <= STATUS_PRESENTATION_MAX_BYTES);
  assert.doesNotMatch(content(budget), /\uFFFD/);
  if (format === "json") {
    const parsed = JSON.parse(content(budget)); assert(parsed.data.presentation.omitted > 0);
    assert.equal(parsed.data.itemCount.returned, parsed.data.items.length);
    assert.equal(parsed.data.itemCount.omitted, 100 - parsed.data.items.length);
    assert.equal(parsed.data.nativeItemCount.returned, 100);
    assert(Buffer.byteLength(parsed.rawOutput.text, "utf8") <= STATUS_RAW_PRESENTATION_MAX_BYTES);
    for (const row of parsed.data.items) assert(budget.structuredContent.data.items.some((native: any) => native.path === row.path));
  } else assert.match(content(budget), /[1-9]\d* omitted/);
  const standardBudget = await invoke(Array.from({ length: 100 }, (_, i) => `Changed ${i}-${"😀".repeat(1000)}.txt`).join("\n") + "\n" + "x".repeat(4097) + "\nunsafe\uFFFD.txt", { machineReadable: false, format, includeRaw: true });
  assert(Buffer.byteLength(content(standardBudget), "utf8") <= STATUS_PRESENTATION_MAX_BYTES);
  assert.doesNotMatch(content(standardBudget), /unsafe|x{4097}|\uFFFD/);
  if (format === "json") assert(JSON.parse(content(standardBudget)).data.presentation.omitted > 0);
}
const rawJson = JSON.parse(content(await invoke(output, { format: "json", includeRaw: true })));
assert.match(rawJson.rawOutput.source, /machinereadable/); assert.match(rawJson.rawOutput.warning, /private/);
assert(rawJson.rawOutput.text.includes("old.txt"));
assert.equal(JSON.parse(content(await invoke("private", { format: "json" }, 1))).ok, false);
console.log("PASS: status DTO schema, single-read adapter, diagnostics, limits, direct text/parseable JSON, Unicode budgets, format/mode matrix and native errors");
