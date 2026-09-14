import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { __plasticDiffInternals, diffFile, diffRevisions, runWithAbortSignal, workspaceDiff } from "../src/plastic-core.ts";

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
          `PR${statusSeparator}private.txt${statusSeparator}False${statusSeparator}45${statusSeparator}NO_MERGES`,
          `AD${statusSeparator}added.txt${statusSeparator}False${statusSeparator}46${statusSeparator}NO_MERGES`,
          `AD${statusSeparator}added-empty.txt${statusSeparator}False${statusSeparator}0${statusSeparator}NO_MERGES`,
          `AD${statusSeparator}über added.txt${statusSeparator}False${statusSeparator}0${statusSeparator}NO_MERGES`,
          `DE${statusSeparator}deleted.txt${statusSeparator}False${statusSeparator}42${statusSeparator}NO_MERGES`,
          `CH${statusSeparator}nodata.txt${statusSeparator}False${statusSeparator}43${statusSeparator}NO_MERGES`,
          `MV${statusSeparator}100%${statusSeparator}source moved.txt${statusSeparator}moved destination.txt${statusSeparator}False${statusSeparator}44${statusSeparator}NO_MERGES`,
        ].join("\n"));
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "showselector") {
        proc.stdout.write('repository "parent-repository@parent-server"\n  smartbranch "/main"\n');
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "xlink") {
        proc.stderr.write(`'${args.at(-1)}' is not an xlink.`);
        proc.close(1);
        return;
      }
      if (command === "cm" && args[0] === "cat") {
        if (args[1] === "revid:43@rep:parent-repository@repserver:parent-server" || args[1] === "revid:43") {
          const destination = args.find((arg) => arg.startsWith("--file="))!.slice("--file=".length);
          await writeFile(destination, "");
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
        const [left, right] = await Promise.all([readFile(args[1]), readFile(args[2])]);
        if (left.equals(right)) {
          proc.close(0);
          return;
        }
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
      if (command === "cm" && args[0] === "showselector") {
        proc.stdout.write('repository "parent-repository@parent-server"\n  smartbranch "/main"\n');
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "xlink") {
        proc.stderr.write(`'${args.at(-1)}' is not an xlink.`);
        proc.close(1);
        return;
      }
      if (command === "cm" && args[0] === "cat") {
        if (args[1] === "revid:99@rep:parent-repository@repserver:parent-server") {
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

function xlinkCollisionCommands(calls: Call[], root: string) {
  const statuses = [
    `CH${statusSeparator}${join(root, "parent.txt")}${statusSeparator}False${statusSeparator}77${statusSeparator}NO_MERGES`,
    `CH${statusSeparator}${join(root, "link-one", "one.txt")}${statusSeparator}False${statusSeparator}77${statusSeparator}NO_MERGES`,
    `CH${statusSeparator}${join(root, "link-two", "two.txt")}${statusSeparator}False${statusSeparator}77${statusSeparator}NO_MERGES`,
    `CH${statusSeparator}${join(root, "link-one", "partial", "nested.cs")}${statusSeparator}False${statusSeparator}79${statusSeparator}NO_MERGES`,
    `MV${statusSeparator}100%${statusSeparator}${join(root, "link-one", "source.cs")}${statusSeparator}${join(root, "link-one", "moved.cs")}${statusSeparator}False${statusSeparator}78${statusSeparator}NO_MERGES`,
    `DE${statusSeparator}${join(root, "removed-xlink", "gone.txt")}${statusSeparator}False${statusSeparator}88${statusSeparator}NO_MERGES`,
  ].join("\n");
  const bases: Record<string, string> = {
    "revid:77@rep:parent-repository@repserver:parent-server": "PARENT MARKDOWN\n",
    "revid:77@rep:linked-repository@repserver:linked-server": "XLINK ONE CSHARP\n",
    "revid:77@rep:linked-repository@repserver:other-server": "XLINK TWO CSHARP\n",
    "revid:78@rep:linked-repository@repserver:linked-server": "XLINK MOVE CSHARP\n",
    "revid:79@rep:partial-repository@repserver:cloud@partial-server": "PARTIAL XLINK CSHARP\n",
  };
  return ((command: string, args: string[]) => {
    const proc = new FakeChildProcess();
    calls.push({ command, args });
    queueMicrotask(async () => {
      if (command === "cm" && args[0] === "status") {
        proc.stdout.write(statuses);
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "showselector") {
        proc.stdout.write('repository "parent-repository@parent-server"\n  smartbranch "/main"\n');
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "xlink") {
        const candidate = args.at(-1)!;
        const repository = candidate.endsWith("partial") ? "partial-repository@cloud@partial-server"
          : candidate.endsWith("link-one") ? "linked-repository@linked-server"
            : candidate.endsWith("link-two") ? "linked-repository@other-server" : null;
        if (!repository) {
          proc.stderr.write(`'${candidate}' is not an xlink.`);
          proc.close(1);
          return;
        }
        proc.stdout.write(`${candidate} --> wxlink:linked:/@77@${repository}\n`);
        proc.close(0);
        return;
      }
      if (command === "cm" && args[0] === "cat") {
        const base = bases[args[1]];
        assert(base, `Unexpected unqualified or incorrect revision spec: ${args[1]}`);
        await writeFile(args.find((arg) => arg.startsWith("--file="))!.slice("--file=".length), base);
        proc.close(0);
        return;
      }
      if (args[0] === "-u") {
        const left = await readFile(args[1], "utf8");
        proc.stdout.write(`--- left\n+++ right\n@@ -1 +1 @@\n-${left.trim()}\n+workspace\n`);
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
  await mkdir(join(root, ".plastic"));
  await writeFile(join(root, ".plastic", "plastic.workspace"), "synthetic workspace marker\n");
  for (const name of ["changed.txt", "private.txt", "added.txt", "nodata.txt", "moved destination.txt", "über added.txt"]) {
    await writeFile(join(root, name), `workspace ${name}\n`);
  }
  await writeFile(join(root, "added-empty.txt"), "");

  const privateCalls: Call[] = [];
  const privateResult = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "private.txt", workdir: root, format: "text" }), { spawn: fakeCommands(privateCalls) });
  assert.match(String(privateResult), /empty before private\/new file/, "Explicitly selected private files must compare against an empty base with a private/new label.");
  assert.equal(privateCalls.filter((call) => call.command === "cm" && call.args[0] === "cat").length, 0, "Private/new files must not materialize a historical base.");
  assert.equal(privateCalls.filter((call) => call.command === "cm" && (call.args[0] === "xlink" || call.args[0] === "showselector")).length, 0, "Private files must skip ownership lookup even when status includes an ID.");
  const addedCalls: Call[] = [];
  await runWithAbortSignal(undefined, () => diffFile.execute({ path: "added.txt", workdir: root, format: "text" }), { spawn: fakeCommands(addedCalls) });
  assert.equal(addedCalls.filter((call) => call.command === "cm" && (call.args[0] === "xlink" || call.args[0] === "showselector" || call.args[0] === "cat")).length, 0, "Added files must skip historical ownership lookup even when status includes an ID.");

  const addedEmptyText = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "added-empty.txt", workdir: root, format: "text" }), { spawn: fakeCommands([]) });
  assert.match(String(addedEmptyText), /Added file is empty/, "An added empty file must not be rendered as generic unchanged text.");
  const addedEmptyJson = jsonPayload(await runWithAbortSignal(undefined, () => diffFile.execute({ path: "added-empty.txt", workdir: root, format: "json" }), { spawn: fakeCommands([]) }));
  assert.equal((addedEmptyJson.data as Record<string, unknown>).status, "added-empty", "Focused JSON must expose added-empty semantics.");
  assert.equal((addedEmptyJson.data as Record<string, unknown>).comparisonKind, "workspace-added", "Focused JSON must retain the workspace-added comparison kind.");

  const unicodeCalls: Call[] = [];
  const unicodeResult = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "über added.txt", workdir: root, format: "text" }), { spawn: fakeCommands(unicodeCalls) });
  assert.match(String(unicodeResult), /--- über added\.txt \(empty before add\)\n\+\+\+ über added\.txt \(workspace\)/, "Normalized headers must retain logical Unicode labels.");
  const unicodeBackendCall = unicodeCalls.find((call) => call.args[0] === "-u");
  assert(unicodeBackendCall && unicodeBackendCall.args.every((arg) => /^[\x20-\x7e]*$/.test(arg)), "The diff backend must receive only ASCII-safe materialized operands for a Unicode workspace path.");

  const historicalUnicodeCalls: Call[] = [];
  const historicalUnicode = await runWithAbortSignal(undefined, () => diffRevisions.execute({ leftRevision: "über file.txt#cs:1", rightRevision: "über file.txt#cs:2", workdir: root, format: "text" }), { spawn: fakeCommands(historicalUnicodeCalls) });
  assert.match(String(historicalUnicode), /--- über file\.txt@cs:1\n\+\+\+ über file\.txt@cs:2/, "Historical normalized headers must retain logical Unicode labels.");
  const historicalUnicodeBackendCall = historicalUnicodeCalls.find((call) => call.args[0] === "-u");
  assert(historicalUnicodeBackendCall && historicalUnicodeBackendCall.args.every((arg) => /^[\x20-\x7e]*$/.test(arg)), "The diff backend must receive only ASCII-safe materialized operands for a Unicode historical path.");

  const collisionRoot = join(root, "collision");
  await mkdir(join(collisionRoot, "link-one", "partial"), { recursive: true });
  await mkdir(join(collisionRoot, "link-one", "deep"), { recursive: true });
  await mkdir(join(collisionRoot, "link-two"), { recursive: true });
  await Promise.all([
    writeFile(join(collisionRoot, "parent.txt"), "workspace\n"),
    writeFile(join(collisionRoot, "link-one", "one.txt"), "workspace\n"),
    writeFile(join(collisionRoot, "link-one", "partial", "nested.cs"), "workspace\n"),
    writeFile(join(collisionRoot, "link-one", "moved.cs"), "workspace\n"),
    writeFile(join(collisionRoot, "link-two", "two.txt"), "workspace\n"),
  ]);
  const collisionCalls: Call[] = [];
  const xlinkFileDiff = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "link-one/one.txt", workdir: collisionRoot, format: "text" }), { spawn: xlinkCollisionCommands(collisionCalls, collisionRoot) });
  assert.match(String(xlinkFileDiff), /XLINK ONE CSHARP/, "Focused workspace diffs must materialize the xlink base, not colliding parent bytes.");
  const subdirectoryDiff = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "../one.txt", workdir: join(collisionRoot, "link-one", "deep"), format: "text" }), { spawn: xlinkCollisionCommands(collisionCalls, collisionRoot) });
  assert.match(String(subdirectoryDiff), /XLINK ONE CSHARP/, "Resolution from beneath an Xlink must inspect the enclosing mount up to the workspace root.");
  const partialXlinkDiff = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "link-one/partial/nested.cs", workdir: collisionRoot, format: "text" }), { spawn: xlinkCollisionCommands(collisionCalls, collisionRoot) });
  assert.match(String(partialXlinkDiff), /PARTIAL XLINK CSHARP/, "Nested partial Xlinks must resolve their nearest owning repository.");
  const movedXlinkDiff = await runWithAbortSignal(undefined, () => diffFile.execute({ path: "link-one/moved.cs", workdir: collisionRoot, format: "text" }), { spawn: xlinkCollisionCommands(collisionCalls, collisionRoot) });
  assert.match(String(movedXlinkDiff), /XLINK MOVE CSHARP/, "Moved Xlink files must resolve the base from their source owner.");
  const xlinkWorkspaceDiff = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ allPending: true, maxFiles: 3, workdir: collisionRoot, format: "text" }), { spawn: xlinkCollisionCommands(collisionCalls, collisionRoot) });
  assert.match(String(xlinkWorkspaceDiff), /XLINK ONE CSHARP/);
  assert.match(String(xlinkWorkspaceDiff), /XLINK TWO CSHARP/);
  assert(collisionCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:77@rep:linked-repository@repserver:linked-server"), "Xlink bases must use the documented repository-qualified selector.");
  assert(collisionCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:77@rep:linked-repository@repserver:other-server"), "Same-name repositories on different servers must retain distinct identities.");
  assert(!collisionCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:77"), "Automatic pending diffs must never materialize a bare revision ID.");
  await assert.rejects(
    () => runWithAbortSignal(undefined, () => diffFile.execute({ path: "removed-xlink/gone.txt", workdir: collisionRoot, format: "text" }), { spawn: xlinkCollisionCommands(collisionCalls, collisionRoot) }),
    /owning repository.*ownership ancestor is missing/i,
    "A deleted path below a removed Xlink mount must fail unavailable rather than use the parent repository.",
  );
  assert(!collisionCalls.some((call) => call.args[0] === "cat" && call.args[1].startsWith("revid:88")), "Ambiguous ownership must not materialize any revision.");

  const changedCalls: Call[] = [];
  await runWithAbortSignal(undefined, () => diffFile.execute({ path: "changed.txt", workdir: root, format: "text" }), { spawn: fakeCommands(changedCalls) });
  assert(changedCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:41@rep:parent-repository@repserver:parent-server"), "Changed files must bind the status revision ID to the owning repository.");

  const deletedCalls: Call[] = [];
  await runWithAbortSignal(undefined, () => diffFile.execute({ path: "deleted.txt", workdir: root, format: "text" }), { spawn: fakeCommands(deletedCalls) });
  assert(deletedCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:42@rep:parent-repository@repserver:parent-server"), "Deleted files must bind their status base to the owning repository before comparison.");

  await assert.rejects(
    () => runWithAbortSignal(undefined, () => diffFile.execute({ path: "nodata.txt", workdir: root, format: "text" }), { spawn: fakeCommands([]) }),
    /Plastic cannot supply historical\/base bytes.*update\/refresh the workspace or use plastic_diffRevisions/i,
    "Focused --nodata diffs must explain why the base is unavailable and how to proceed.",
  );
  const failedCatOutput = join(root, "package-owned-failed-cat-output.tmp");
  await assert.rejects(
    () => runWithAbortSignal(undefined, () => __plasticDiffInternals.materializeRevision("revid:43", failedCatOutput, root), { spawn: fakeCommands([]) }),
    /Historical data is unavailable/,
    "Failed cm cat --file retrieval must surface the backend failure after cleanup.",
  );
  await assert.rejects(() => readFile(failedCatOutput), /ENOENT/, "Failed cm cat --file retrieval must remove its failure-created package-owned output.");

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
  assert.match(String(defaultBatch), /Skipped 4 pending item/, "The default whole-workspace bound must report omitted candidates.");

  const batchCalls: Call[] = [];
  const batchResult = await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, allPending: true, maxFiles: 20, format: "text" }), { spawn: fakeCommands(batchCalls) });
  assert.match(String(batchResult), /changed\.txt \(changed\)/);
  assert.match(String(batchResult), /nodata\.txt \(changed\)\nUnavailable: Plastic cannot supply historical\/base bytes/);
  assert.match(String(batchResult), /moved destination\.txt \(moved\)/, "Workspace review must compare a moved destination path.");
  assert(batchCalls.some((call) => call.args[0] === "cat" && call.args[1] === "revid:44@rep:parent-repository@repserver:parent-server"), "Moved files must bind their status revision to the source owning repository before destination comparison.");
  assert.doesNotMatch(String(batchResult), /private\.txt \(private\)/, "Batch review must exclude private files by default.");
  const batchStatusCalls = batchCalls.filter((call) => call.command === "cm" && call.args[0] === "status");
  assert.match(String(batchResult), /added-empty\.txt \(added\)\nAdded file is empty/, "Workspace text output must expose added-empty semantics.");
  assert.equal(batchStatusCalls.length, 1, "Workspace review must run status exactly once.");
  assert.deepEqual(batchStatusCalls[0].args, ["status", "--machinereadable", "--includeRevId", `--fieldseparator=${statusSeparator}`], "Pending-item status must request the explicit separator exactly once.");

  const addedEmptyWorkspaceJson = jsonPayload(await runWithAbortSignal(undefined, () => workspaceDiff.execute({ workdir: root, paths: ["added-empty.txt"], format: "json" }), { spawn: fakeCommands([]) }));
  const addedEmptyOutcome = ((addedEmptyWorkspaceJson.data as Record<string, unknown>).outcomes as Array<Record<string, unknown>>)[0];
  assert.equal(addedEmptyOutcome.status, "added-empty", "Workspace JSON must expose added-empty semantics.");
  assert.equal(addedEmptyOutcome.comparisonKind, "workspace-added", "Workspace JSON must retain comparisonKind for an added empty file.");

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
