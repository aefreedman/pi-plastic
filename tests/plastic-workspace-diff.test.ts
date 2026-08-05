import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { diffFile, diffRevisions, runWithAbortSignal, workspaceDiff } from "../src/plastic-core.ts";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  kill(): boolean { return true; }
  close(code: number): void { this.stdout.end(); this.stderr.end(); this.emit("close", code, null); }
}

type Call = { command: string; args: string[] };
const statusSeparator = "\x1f";

function fakeCommands(calls: Call[]) {
  return ((command: string, args: string[]) => {
    const proc = new FakeChildProcess();
    calls.push({ command, args });
    queueMicrotask(async () => {
      if (command === "cm" && args[0] === "status") {
        proc.stdout.write([
          `CH${statusSeparator}changed.txt${statusSeparator}False${statusSeparator}41${statusSeparator}NO_MERGES`,
          `PR${statusSeparator}private.txt${statusSeparator}False${statusSeparator}0${statusSeparator}NO_MERGES`,
          `AD${statusSeparator}added.txt${statusSeparator}False${statusSeparator}0${statusSeparator}NO_MERGES`,
          `DE${statusSeparator}deleted.txt${statusSeparator}False${statusSeparator}42${statusSeparator}NO_MERGES`,
          `CH${statusSeparator}nodata.txt${statusSeparator}False${statusSeparator}43${statusSeparator}NO_MERGES`,
          `MV${statusSeparator}100%${statusSeparator}source moved.txt${statusSeparator}moved destination.txt${statusSeparator}False${statusSeparator}44${statusSeparator}NO_MERGES`,
        ].join("\n"));
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "cat") {
        if (args[1] === "revid:43") {
          proc.stderr.write("Historical data is unavailable because the item was loaded with --nodata.");
          proc.close(1);
          return;
        }
        const destination = args.find((arg) => arg.startsWith("--file="))!.slice("--file=".length);
        await writeFile(destination, `base for ${args[1]}\n`);
        proc.close(0);
        return;
      }
      if (args[0] === "-u") {
        proc.stdout.write("--- temporary-left\n+++ temporary-right\n@@ -1 +1 @@\n-base\n+workspace\n");
        proc.close(1);
        return;
      }
      proc.close(0);
    });
    return proc as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as typeof import("node:child_process").spawn;
}

function stressCommands(calls: Call[]) {
  return ((command: string, args: string[]) => {
    const proc = new FakeChildProcess();
    calls.push({ command, args });
    queueMicrotask(async () => {
      if (command === "cm" && args[0] === "status") {
        proc.stdout.write(["stress-1.txt", "stress-2.txt", "stress-3.txt", "stress-4.txt", "stress-5.txt"]
          .map((name, index) => `CH ${name} False ${index + 1}`)
          .concat("CH unavailable.txt False 99").join("\n"));
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "cat") {
        if (args[1] === "revid:99") {
          proc.stderr.write(`Failure with JSON-sensitive text \\\" \\\\ ${"x".repeat(5_000)}`);
          proc.close(1);
          return;
        }
        const destination = args.find((arg) => arg.startsWith("--file="))!.slice("--file=".length);
        await writeFile(destination, "base\n");
        proc.close(0);
        return;
      }
      if (args[0] === "-u") {
        proc.stdout.write(`--- left\n+++ right\n${"+\\\"\\\\\n".repeat(30_000)}`);
        proc.close(1);
        return;
      }
      proc.close(0);
    });
    return proc as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as typeof import("node:child_process").spawn;
}

const jsonPayload = (result: unknown): Record<string, unknown> => {
  const match = String(result).match(/```json\n([\s\S]*)\n```$/);
  assert(match, "Expected a fenced JSON result.");
  return JSON.parse(match[1]) as Record<string, unknown>;
};

const root = await mkdtemp(join(tmpdir(), "pi-plastic-workspace-diff-"));
try {
  for (const name of ["changed.txt", "private.txt", "added.txt", "nodata.txt", "moved destination.txt"]) {
    await writeFile(join(root, name), `workspace ${name}\n`);
  }

  const privateCalls: Call[] = [];
  const privateResult = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "private.txt", workdir: root, format: "text" }), { spawn: fakeCommands(privateCalls) });
  assert.match(String(privateResult), /empty before private\/new file/, "Explicitly selected private files must compare against an empty base with a private/new label.");
  assert.equal(privateCalls.filter((call) => call.command === "cm" && call.args[0] === "cat").length, 0, "Private/new files must not materialize a historical base.");

  const changedCalls: Call[] = [];
  await runWithAbortSignal(undefined, () => diffFile.execute({ path: "changed.txt", workdir: root, format: "text" }), { spawn: fakeCommands(changedCalls) });
  assert(changedCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:41"), "Changed files must use the status revision ID for safe base materialization.");

  const deletedCalls: Call[] = [];
  await runWithAbortSignal(undefined, () => diffFile.execute({ path: "deleted.txt", workdir: root, format: "text" }), { spawn: fakeCommands(deletedCalls) });
  assert(deletedCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:42"), "Deleted files must materialize their status base before comparing it to empty content.");

  await assert.rejects(
    () => runWithAbortSignal(undefined, () => diffFile.execute({ path: "nodata.txt", workdir: root, format: "text" }), { spawn: fakeCommands([]) }),
    /Plastic cannot supply historical\/base bytes.*update\/refresh the workspace or use plastic_diffRevisions/i,
    "Focused --nodata diffs must explain why the base is unavailable and how to proceed.",
  );

  await assert.rejects(
    () => workspaceDiff.execute({ workdir: root, format: "text" }),
    /requires explicit paths or allPending=true.*plastic_status/i,
    "Unscoped workspace diff calls must require intentional whole-workspace review.",
  );
  await assert.rejects(
    () => workspaceDiff.execute({ workdir: root, paths: [""], format: "text" }),
    /non-blank workspace paths/i,
    "Blank direct-call paths must not resolve to a broad workspace scope.",
  );
  await assert.rejects(
    () => workspaceDiff.execute({ workdir: root, paths: ["."], format: "text" }),
    /workspace-root path.*allPending=true/i,
    "Workspace-root selection must require the explicit whole-workspace opt-in.",
  );
  await assert.rejects(
    () => workspaceDiff.execute({ workdir: root, allPending: "false" as unknown as boolean, format: "text" }),
    /allPending must be a boolean/i,
    "Stringly typed direct-call opt-ins must not become truthy whole-workspace review.",
  );
  await assert.rejects(
    () => workspaceDiff.execute({ workdir: root, allPending: true, includePrivate: "false" as unknown as boolean, format: "text" }),
    /includePrivate must be a boolean/i,
    "Stringly typed direct-call private flags must not include private files.",
  );
  await assert.rejects(
    () => workspaceDiff.execute({ workdir: root, paths: ["changed.txt"], allPending: true, format: "text" }),
    /either explicit paths or allPending=true/i,
    "Selected and whole-workspace review scopes must not be combined.",
  );
  await assert.rejects(
    () => workspaceDiff.execute({ workdir: root, paths: ["private.txt"], includePrivate: true, format: "text" }),
    /includePrivate is only used with allPending=true/i,
    "Explicit private paths must not need a redundant whole-workspace flag.",
  );

  const defaultBatch = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, allPending: true, format: "text" }), { spawn: fakeCommands([]) });
  assert.match(String(defaultBatch), /Files considered: 3/, "Explicit whole-workspace review must keep a small default file count.");
  assert.match(String(defaultBatch), /Skipped 2 pending item/, "The default whole-workspace bound must report omitted candidates.");

  const batchCalls: Call[] = [];
  const batchResult = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, allPending: true, maxFiles: 20, format: "text" }), { spawn: fakeCommands(batchCalls) });
  assert.match(String(batchResult), /changed\.txt \(changed\)/);
  assert.match(String(batchResult), /nodata\.txt \(changed\)\nUnavailable: Plastic cannot supply historical\/base bytes/);
  assert.match(String(batchResult), /moved destination\.txt \(moved\)/, "Workspace review must compare a moved destination path.");
  assert(batchCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:44"), "Moved files must materialize their status revision before destination comparison.");
  assert.doesNotMatch(String(batchResult), /private\.txt \(private\)/, "Batch review must exclude private files by default.");
  const batchStatusCalls = batchCalls.filter((call) => call.command === "cm" && call.args[0] === "status");
  assert.equal(batchStatusCalls.length, 1, "Workspace review must run status exactly once.");
  assert.deepEqual(batchStatusCalls[0].args, ["status", "--machinereadable", "--includeRevId", `--fieldseparator=${statusSeparator}`], "Pending-item status must request the explicit separator exactly once.");

  const selectedPrivateCalls: Call[] = [];
  const selectedPrivate = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: ["private.txt"], format: "text" }), { spawn: fakeCommands(selectedPrivateCalls) });
  assert.match(String(selectedPrivate), /private\.txt \(private\)/, "Explicit selection must include a private file in workspace review.");
  assert.equal(selectedPrivateCalls.filter((call) => call.command === "cm" && call.args[0] === "cat").length, 0, "Selected private files still use an empty base.");

  for (const name of ["stress-1.txt", "stress-2.txt", "stress-3.txt", "stress-4.txt", "stress-5.txt"]) {
    await writeFile(join(root, name), "workspace\n");
  }
  const stressPaths = ["stress-1.txt", "stress-2.txt", "stress-3.txt", "stress-4.txt", "stress-5.txt", "unavailable.txt"];
  const textStress = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: stressPaths, maxChars: 8_000, format: "text" }), { spawn: stressCommands([]) });
  assert(String(textStress).length <= 20_000, "Text workspace diff must keep the complete response within the context-efficient bound.");
  assert.match(String(textStress), /Per-file output bound: 8000 characters/, "Workspace diff must report an intentional raised per-file response bound.");
  assert.match(String(textStress), /outcome\(s\) omitted/, "An exhausted text budget must retain an omission summary.");

  const focusedBound = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: ["stress-1.txt"], maxChars: 500, format: "text" }), { spawn: stressCommands([]) });
  assert.match(String(focusedBound), /Per-file output bound: 500 characters/, "Callers must be able to request a smaller focused diff body.");
  assert(String(focusedBound).length < 2_000, "A one-file focused review with a small bound must remain context efficient.");

  const focusedJson = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "stress-1.txt", workdir: root, maxChars: 20_000, format: "json" }), { spawn: stressCommands([]) });
  assert(String(focusedJson).length <= 24_000, "Focused file JSON must remain bounded after escape expansion.");
  const focusedJsonPayload = jsonPayload(focusedJson);
  assert.equal((focusedJsonPayload.data as Record<string, unknown>).truncated, true, "Post-serialization focused truncation must remain observable.");
  assert(Array.isArray(focusedJsonPayload.warnings) && (focusedJsonPayload.warnings as string[]).some((warning) => warning.includes("JSON escaping")), "Focused JSON truncation must explain the complete-response bound.");

  const revisionsJson = await runWithAbortSignal(undefined, () => diffRevisions.execute({ leftRevision: "stress-1.txt#cs:1", rightRevision: "stress-1.txt#cs:2", workdir: root, maxChars: 20_000, format: "json" }), { spawn: stressCommands([]) });
  assert(String(revisionsJson).length <= 24_000, "Revision JSON must remain bounded after escape expansion.");
  assert.equal((jsonPayload(revisionsJson).data as Record<string, unknown>).truncated, true, "Revision JSON must expose complete-response truncation.");

  const escapedUnmatchedPath = "missing \\\"quoted\\\" \\\\ path";
  const jsonStress = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: [...stressPaths, escapedUnmatchedPath], maxChars: 8_000, format: "json" }), { spawn: stressCommands([]) });
  assert(String(jsonStress).length <= 20_000, "JSON workspace diff must bound the complete framed response after JSON escaping.");
  const parsedStress = jsonPayload(jsonStress);
  const stressData = parsedStress.data as Record<string, unknown>;
  assert((stressData.omittedOutcomes as number) > 0, "An exhausted JSON budget must report omitted outcomes without breaking JSON framing.");
  assert(Array.isArray(parsedStress.warnings) && (parsedStress.warnings as string[]).some((warning) => warning.includes("no pending status record")), "Unmatched path inputs must remain summarized in bounded JSON warnings.");

  const unavailableJson = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: ["unavailable.txt", escapedUnmatchedPath], format: "json" }), { spawn: stressCommands([]) });
  assert(String(unavailableJson).length <= 20_000, "Long per-file errors must not exceed the JSON response bound.");
  const unavailableData = jsonPayload(unavailableJson).data as Record<string, unknown>;
  const unavailableOutcome = (unavailableData.outcomes as Array<Record<string, unknown>>)[0];
  assert(String(unavailableOutcome.error).length <= 1_024, "Long per-file errors must be bounded in metadata.");

  const zeroMaxFiles = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: ["stress-1.txt"], maxFiles: 0, format: "text" }), { spawn: stressCommands([]) });
  assert.match(String(zeroMaxFiles), /Files considered: 1/, "Runtime guards must clamp direct callers that bypass the schema with a zero file bound.");
  assert(String(zeroMaxFiles).length <= 20_000, "A direct zero-bound caller must still receive a complete bounded response.");

  const oversizedPathInputs = ["x".repeat(5_000), ...Array.from({ length: 20 }, (_value, index) => `missing-${index}`)];
  const boundedInputs = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: oversizedPathInputs, format: "json" }), { spawn: stressCommands([]) });
  const boundedInputPayload = jsonPayload(boundedInputs);
  const boundedInputData = boundedInputPayload.data as Record<string, unknown>;
  assert(boundedInputData.selectedPathCount === 20, "Runtime path guards must retain no more than the configured path count.");
  assert(Array.isArray(boundedInputPayload.warnings) && (boundedInputPayload.warnings as string[]).some((warning) => warning.includes("Ignored 1 path input")), "Runtime path guards must summarize excess path inputs.");
  assert((boundedInputData.unmatchedPaths as string[]).every((path) => path.length <= 256), "Runtime path guards must bound long path metadata.");

  console.log("PASS: plastic workspace diff tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
