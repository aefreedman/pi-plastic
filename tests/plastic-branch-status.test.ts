import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlasticBranchStatusExtension } from "../extensions/plastic-branch-status.ts";

type Handler = (event: any, ctx: any) => Promise<void> | void;
type FakeTimer = { callback: () => void; delay: number; cleared: boolean };

class FooterHarness {
  handlers = new Map<string, Handler[]>();
  statuses = new Map<string, string>();
  statusCalls: Array<[string, string | undefined]> = [];
  setFooterCalls = 0;
  readonly ctx = {
    cwd: "/workspace/nested/project",
    hasUI: true,
    ui: {
      theme: { fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
      setStatus: (key: string, value: string | undefined) => {
        this.statusCalls.push([key, value]);
        if (value === undefined) this.statuses.delete(key);
        else this.statuses.set(key, value);
      },
      setFooter: () => { this.setFooterCalls++; },
    },
  };
  readonly api = {
    on: (event: string, handler: Handler) => {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
  };

  async emit(event: string, payload: any = {}): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) await handler(payload, this.ctx);
  }
}

const workspace = (root: string) => ({
  kind: "found" as const,
  value: { root, plasticDir: `${root}/.plastic`, markerPath: `${root}/.plastic/plastic.workspace` },
});

const timers: FakeTimer[] = [];
const schedule = (callback: () => void, delay: number): any => {
  const timer = { callback, delay, cleared: false };
  timers.push(timer);
  return timer;
};
const clear = (timer: any): void => { timer.cleared = true; };
const runTimers = async (delay: number): Promise<void> => {
  const pending = timers.filter((timer) => !timer.cleared && timer.delay === delay);
  for (const timer of pending) {
    timer.cleared = true;
    timer.callback();
  }
  await new Promise((resolve) => setImmediate(resolve));
};

{
  timers.length = 0;
  const harness = new FooterHarness();
  harness.statuses.set("foreign-status", "keep me");
  let confirmation = "/main/from-cm@repo@server\n";
  let confirmCount = 0;
  let watcherClosed = 0;
  let watcherChange: (() => void) | undefined;
  let watcherError: (() => void) | undefined;

  createPlasticBranchStatusExtension({
    discoverWorkspace: async (cwd) => cwd.startsWith("/sibling") ? workspace("/sibling") : workspace("/workspace"),
    readSelector: async () => "repository repo@server\n  path /\n    smartbranch /main/from-selector\n",
    watchDirectory: (_path, onChange, onError) => {
      watcherChange = onChange;
      watcherError = onError;
      return { close: () => { watcherClosed++; } };
    },
    confirmBranch: async () => { confirmCount++; return confirmation; },
    setTimeout: schedule,
    clearTimeout: clear,
    platform: "linux",
  })(harness.api as any);

  await harness.emit("session_start", { reason: "startup" });
  assert.match(harness.statuses.get("plastic-branch") ?? "", /\/main\/from-cm/);
  assert.equal(harness.statuses.get("foreign-status"), "keep me");
  assert.equal(harness.setFooterCalls, 0);
  assert.equal(confirmCount, 1);

  confirmation = "/main/after-selector-replacement@repo@server\n";
  watcherChange?.();
  watcherChange?.();
  await runTimers(150);
  assert.equal(confirmCount, 2, "coalesced watcher events should run one refresh");
  assert.match(harness.statuses.get("plastic-branch") ?? "", /after-selector-replacement/);
  assert.ok(watcherClosed >= 1, "workspace watcher should be rebound after a directory event");

  await harness.emit("tool_result", { toolCallId: "same", toolName: "plastic_switchBranch", input: { workdir: "." }, isError: false });
  await harness.emit("tool_execution_end", { toolCallId: "same", toolName: "plastic_switchBranch", isError: false });
  await runTimers(150);
  assert.equal(confirmCount, 3, "same-workspace Plastic tools should refresh");

  await harness.emit("tool_result", { toolCallId: "sibling", toolName: "plastic_status", input: { workdir: "/sibling" }, isError: false });
  await harness.emit("tool_execution_end", { toolCallId: "sibling", toolName: "plastic_status", isError: false });
  await runTimers(150);
  assert.equal(confirmCount, 3, "sibling-workspace tools must not refresh this footer");

  await harness.emit("tool_result", { toolCallId: "sibling-alias", toolName: "plastic_status", input: { cwd: "/sibling", workdir: "/sibling" }, isError: false });
  await harness.emit("tool_execution_end", { toolCallId: "sibling-alias", toolName: "plastic_status", isError: false });
  await runTimers(150);
  assert.equal(confirmCount, 3, "normalized effective workdir should control sibling filtering");

  watcherError?.();
  await runTimers(150);
  assert.equal(confirmCount, 4, "watcher errors should trigger bounded revalidation");

  await harness.emit("session_shutdown", { reason: "reload" });
  assert.equal(harness.statuses.has("plastic-branch"), false);
  assert.equal(harness.statuses.get("foreign-status"), "keep me");
}

{
  timers.length = 0;
  const harness = new FooterHarness();
  createPlasticBranchStatusExtension({
    discoverWorkspace: async () => workspace("/workspace"),
    readSelector: async () => "smartbranch /main/selector-only\n",
    watchDirectory: () => ({ close() {} }),
    confirmBranch: async () => { throw new Error("cm unavailable"); },
    setTimeout: schedule,
    clearTimeout: clear,
    platform: "linux",
  })(harness.api as any);
  await harness.emit("session_start");
  assert.match(harness.statuses.get("plastic-branch") ?? "", /selector-only/, "selector fallback should survive cm failure");
}

{
  timers.length = 0;
  const harness = new FooterHarness();
  let aborted = false;
  createPlasticBranchStatusExtension({
    discoverWorkspace: async () => workspace("/workspace"),
    readSelector: async () => "smartbranch \n",
    watchDirectory: () => ({ close() {} }),
    confirmBranch: async (_cwd, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    }),
    setTimeout: schedule,
    clearTimeout: clear,
    platform: "win32",
  })(harness.api as any);
  const startup = harness.emit("session_start");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(harness.statuses.get("plastic-branch") ?? "", /unavailable/);
  await harness.emit("session_shutdown", { reason: "quit" });
  await startup;
  assert.equal(aborted, true, "shutdown should abort in-flight cm confirmation");
  assert.equal(harness.statuses.has("plastic-branch"), false);
}

{
  timers.length = 0;
  const harness = new FooterHarness();
  let markerPresent = true;
  const watched: Array<{ path: string; change: () => void; closed: boolean }> = [];
  createPlasticBranchStatusExtension({
    discoverWorkspace: async () => markerPresent ? workspace("/workspace") : { kind: "not_found" },
    readSelector: async () => "smartbranch /main/recreated\n",
    watchDirectory: (path, onChange) => {
      const handle = { path, change: onChange, closed: false };
      watched.push(handle);
      return { close: () => { handle.closed = true; } };
    },
    confirmBranch: async () => "/main/recreated@repo@server\n",
    setTimeout: schedule,
    clearTimeout: clear,
    platform: "linux",
  })(harness.api as any);

  await harness.emit("session_start");
  markerPresent = false;
  watched.find((entry) => entry.path.endsWith("/.plastic") && !entry.closed)?.change();
  await runTimers(150);
  assert.equal(harness.statuses.has("plastic-branch"), false);
  const recoveryWatcher = watched.find((entry) => entry.path === "/workspace" && !entry.closed);
  assert.ok(recoveryWatcher, "workspace root should remain watched while .plastic is temporarily absent");

  markerPresent = true;
  recoveryWatcher?.change();
  await runTimers(150);
  assert.match(harness.statuses.get("plastic-branch") ?? "", /recreated/);
  assert.ok(watched.some((entry) => entry.path.endsWith("/.plastic") && !entry.closed), "recreated .plastic directory should be rebound");
  await harness.emit("session_shutdown");
  assert.ok(watched.every((entry) => entry.closed), "all primary and recovery watchers should close on shutdown");
}

{
  timers.length = 0;
  const harness = new FooterHarness();
  let innerPresent = true;
  const watched: Array<{ path: string; change: () => void; closed: boolean }> = [];
  createPlasticBranchStatusExtension({
    discoverWorkspace: async () => innerPresent ? workspace("/workspace/inner") : workspace("/workspace"),
    readSelector: async (path) => path.includes("/inner/") ? "smartbranch /main/inner\n" : "smartbranch /main/outer\n",
    watchDirectory: (path, onChange) => {
      const handle = { path, change: onChange, closed: false };
      watched.push(handle);
      return { close: () => { handle.closed = true; } };
    },
    confirmBranch: async (cwd) => cwd.endsWith("/inner") ? "/main/inner@repo@server\n" : "/main/outer@repo@server\n",
    setTimeout: schedule,
    clearTimeout: clear,
    platform: "linux",
  })(harness.api as any);

  await harness.emit("session_start");
  innerPresent = false;
  watched.find((entry) => entry.path === "/workspace/inner/.plastic" && !entry.closed)?.change();
  await runTimers(150);
  assert.match(harness.statuses.get("plastic-branch") ?? "", /\/main\/outer/);
  const nestedRecovery = watched.find((entry) => entry.path === "/workspace/inner" && !entry.closed);
  assert.ok(nestedRecovery, "former nested workspace root should remain watched during outer fallback");

  innerPresent = true;
  nestedRecovery?.change();
  await runTimers(150);
  assert.match(harness.statuses.get("plastic-branch") ?? "", /\/main\/inner/);
  assert.ok(watched.some((entry) => entry.path === "/workspace/inner/.plastic" && !entry.closed));
  assert.equal(watched.some((entry) => entry.path === "/workspace/inner" && !entry.closed), false);
  await harness.emit("session_shutdown");
  assert.ok(watched.every((entry) => entry.closed));
}

{
  const source = await readFile(new URL("../extensions/plastic-branch-status.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.setFooter\s*\(/, "additive branch extension must never replace Pi's footer");
}

console.log("PASS: Plastic branch footer lifecycle and composition tests passed");
