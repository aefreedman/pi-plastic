import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  discoverPlasticWorkspace,
  parsePlasticSelector,
  parsePlasticStatusBranch,
  sanitizePlasticBranch,
  type WorkspaceDiscoveryOutcome,
} from "../src/plastic-workspace";

const STATUS_KEY = "plastic-branch";
const DEBOUNCE_MS = 150;
const CM_TIMEOUT_MS = 5_000;

type Timer = ReturnType<typeof setTimeout>;
type WatchHandle = { close(): void };

type BranchStatusDependencies = {
  discoverWorkspace(cwd: string): Promise<WorkspaceDiscoveryOutcome>;
  readSelector(path: string): Promise<string | undefined>;
  watchDirectory(path: string, onChange: () => void, onError: () => void): WatchHandle;
  confirmBranch(cwd: string, signal: AbortSignal): Promise<string>;
  setTimeout(callback: () => void, delay: number): Timer;
  clearTimeout(timer: Timer): void;
  platform: NodeJS.Platform;
};

const createDefaultDependencies = (pi: ExtensionAPI): BranchStatusDependencies => ({
  discoverWorkspace: discoverPlasticWorkspace,
  async readSelector(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
      throw error;
    }
  },
  watchDirectory(path, onChange, onError) {
    const watcher: FSWatcher = watch(path, { persistent: false }, onChange);
    watcher.on("error", onError);
    return watcher;
  },
  async confirmBranch(cwd, signal) {
    const executable = process.env.PI_PLASTIC_CM_EXECUTABLE?.trim() || "cm";
    const result = await pi.exec(executable, ["status"], { cwd, signal, timeout: CM_TIMEOUT_MS });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `cm status failed with exit code ${result.code}`);
    return result.stdout;
  },
  setTimeout,
  clearTimeout,
  platform: process.platform,
});

const pathKey = (path: string, platform: NodeJS.Platform): string => {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

export function createPlasticBranchStatusExtension(overrides: Partial<BranchStatusDependencies> = {}) {
  return function plasticBranchStatus(pi: ExtensionAPI): void {
    const dependencies = { ...createDefaultDependencies(pi), ...overrides };
    let sessionContext: ExtensionContext | undefined;
    let active = false;
    let generation = 0;
    let refreshSequence = 0;
    let workspace: Extract<WorkspaceDiscoveryOutcome, { kind: "found" }>["value"] | undefined;
    let watcher: WatchHandle | undefined;
    let watchedDirectory: string | undefined;
    let recoveryWatcher: WatchHandle | undefined;
    let recoveryWatchedDirectory: string | undefined;
    let watcherNeedsRebind = false;
    let recoveryRoot: string | undefined;
    let debounceTimer: Timer | undefined;
    let confirmationTimer: Timer | undefined;
    let confirmationController: AbortController | undefined;
    const toolArguments = new Map<string, unknown>();

    const clearStatus = (): void => sessionContext?.ui.setStatus(STATUS_KEY, undefined);

    const closeWatcher = (): void => {
      try { watcher?.close(); } catch { /* already closed */ }
      watcher = undefined;
      watchedDirectory = undefined;
      watcherNeedsRebind = false;
    };

    const closeRecoveryWatcher = (): void => {
      try { recoveryWatcher?.close(); } catch { /* already closed */ }
      recoveryWatcher = undefined;
      recoveryWatchedDirectory = undefined;
    };

    const cancelConfirmation = (): void => {
      confirmationController?.abort();
      confirmationController = undefined;
      if (confirmationTimer) dependencies.clearTimeout(confirmationTimer);
      confirmationTimer = undefined;
    };

    const disposeRuntime = (): void => {
      active = false;
      generation++;
      refreshSequence++;
      if (debounceTimer) dependencies.clearTimeout(debounceTimer);
      debounceTimer = undefined;
      cancelConfirmation();
      closeWatcher();
      closeRecoveryWatcher();
      toolArguments.clear();
      workspace = undefined;
      recoveryRoot = undefined;
      clearStatus();
      sessionContext = undefined;
    };

    const displayBranch = (branch: string): boolean => {
      const safeBranch = sanitizePlasticBranch(branch, 80);
      if (!safeBranch || !sessionContext) return false;
      const theme = sessionContext.ui.theme;
      sessionContext.ui.setStatus(STATUS_KEY, `${theme.fg("accent", "Plastic")} ${theme.fg("dim", safeBranch)}`);
      return true;
    };

    const displayUnavailable = (): void => {
      if (!sessionContext) return;
      sessionContext.ui.setStatus(STATUS_KEY, sessionContext.ui.theme.fg("warning", "Plastic branch unavailable"));
    };

    let refresh: () => Promise<void>;
    const scheduleRefresh = (rebindWatcher = false): void => {
      if (!active) return;
      watcherNeedsRebind ||= rebindWatcher;
      if (debounceTimer) dependencies.clearTimeout(debounceTimer);
      debounceTimer = dependencies.setTimeout(() => {
        debounceTimer = undefined;
        void refresh();
      }, DEBOUNCE_MS);
    };

    const bindRecoveryWatcher = (directory: string): void => {
      if (recoveryWatcher && recoveryWatchedDirectory === directory) return;
      closeRecoveryWatcher();
      try {
        recoveryWatcher = dependencies.watchDirectory(
          directory,
          () => scheduleRefresh(true),
          () => scheduleRefresh(true),
        );
        recoveryWatchedDirectory = directory;
      } catch {
        // Another workspace or tool event can still trigger revalidation.
      }
    };

    const bindWatcher = (directory: string, force = false): boolean => {
      if (!force && watcher && watchedDirectory === directory) return true;
      closeWatcher();
      try {
        watcher = dependencies.watchDirectory(
          directory,
          () => scheduleRefresh(true),
          () => scheduleRefresh(true),
        );
        watchedDirectory = directory;
        return true;
      } catch {
        return false;
      }
    };

    refresh = async (): Promise<void> => {
      if (!active || !sessionContext) return;
      const ownedGeneration = generation;
      const ownedRefresh = ++refreshSequence;
      cancelConfirmation();

      const previousWorkspaceRoot = workspace?.root ?? recoveryRoot;
      const discovery = await dependencies.discoverWorkspace(sessionContext.cwd);
      if (!active || generation !== ownedGeneration || refreshSequence !== ownedRefresh) return;
      if (discovery.kind !== "found") {
        const rootToWatch = workspace?.root ?? recoveryRoot;
        workspace = undefined;
        recoveryRoot = rootToWatch;
        clearStatus();
        if (rootToWatch) bindWatcher(rootToWatch, watcherNeedsRebind || watchedDirectory !== rootToWatch);
        else closeWatcher();
        return;
      }

      const discoveredWorkspace = discovery.value;
      workspace = discoveredWorkspace;
      recoveryRoot = discoveredWorkspace.root;
      const discoveredKey = pathKey(discoveredWorkspace.root, dependencies.platform);
      const previousKey = previousWorkspaceRoot ? pathKey(previousWorkspaceRoot, dependencies.platform) : undefined;
      if (previousWorkspaceRoot && previousKey !== discoveredKey && previousKey?.startsWith(`${discoveredKey}/`)) {
        // Discovery fell back to an enclosing workspace while a nested marker was replaced.
        // Keep watching the former nested root so its recreated .plastic directory wins again.
        bindRecoveryWatcher(previousWorkspaceRoot);
      } else if (recoveryWatchedDirectory && pathKey(recoveryWatchedDirectory, dependencies.platform) === discoveredKey) {
        closeRecoveryWatcher();
      }
      const shouldRebindWatcher = watcherNeedsRebind;
      if (!bindWatcher(discoveredWorkspace.plasticDir, shouldRebindWatcher)) {
        bindWatcher(discoveredWorkspace.root, true);
      }

      let selectorBranch: string | undefined;
      try {
        const selectorText = await dependencies.readSelector(join(discoveredWorkspace.plasticDir, "plastic.selector"));
        if (selectorText !== undefined) {
          const selector = parsePlasticSelector(selectorText);
          if (selector.kind === "found") selectorBranch = selector.value.branch;
        }
      } catch {
        // Selector I/O failure only disables the local fast path.
      }
      if (!active || generation !== ownedGeneration || refreshSequence !== ownedRefresh) return;

      const hasSelectorBranch = selectorBranch ? displayBranch(selectorBranch) : false;
      if (!hasSelectorBranch) displayUnavailable();

      const controller = new AbortController();
      confirmationController = controller;
      const ownedConfirmationTimer = dependencies.setTimeout(() => controller.abort(), CM_TIMEOUT_MS);
      confirmationTimer = ownedConfirmationTimer;
      try {
        const output = await dependencies.confirmBranch(discoveredWorkspace.root, controller.signal);
        const parsed = parsePlasticStatusBranch(output);
        if (!active || generation !== ownedGeneration || refreshSequence !== ownedRefresh || controller.signal.aborted) return;
        if (parsed.kind === "found" && parsed.value.branch) displayBranch(parsed.value.branch);
        else if (!hasSelectorBranch) displayUnavailable();
      } catch {
        if (active && generation === ownedGeneration && refreshSequence === ownedRefresh && !hasSelectorBranch) displayUnavailable();
      } finally {
        if (confirmationController === controller) {
          confirmationController = undefined;
          dependencies.clearTimeout(ownedConfirmationTimer);
          confirmationTimer = undefined;
        }
      }
    };

    pi.on("session_start", async (_event, ctx) => {
      disposeRuntime();
      if (!ctx.hasUI) return;
      sessionContext = ctx;
      active = true;
      generation++;
      await refresh();
    });

    pi.on("tool_result", (event) => {
      if (event.toolName.startsWith("plastic_") && !event.isError) toolArguments.set(event.toolCallId, event.input);
    });

    pi.on("tool_execution_end", async (event, ctx) => {
      const args = toolArguments.get(event.toolCallId);
      toolArguments.delete(event.toolCallId);
      if (!active || event.isError || !event.toolName.startsWith("plastic_") || !workspace) return;
      const input = args && typeof args === "object" ? args as { workdir?: unknown } : {};
      const requestedWorkdir = typeof input.workdir === "string" ? input.workdir.trim() : "";
      const workdir = requestedWorkdir
        ? (isAbsolute(requestedWorkdir) ? requestedWorkdir : resolve(ctx.cwd, requestedWorkdir))
        : ctx.cwd;
      const toolWorkspace = await dependencies.discoverWorkspace(workdir);
      if (!active || toolWorkspace.kind !== "found" || !workspace) return;
      if (pathKey(toolWorkspace.value.root, dependencies.platform) === pathKey(workspace.root, dependencies.platform)) {
        scheduleRefresh();
      }
    });

    pi.on("session_shutdown", () => disposeRuntime());
  };
}

export const __plasticBranchStatusInternals = {
  STATUS_KEY,
  DEBOUNCE_MS,
  CM_TIMEOUT_MS,
  pathKey,
};

export default createPlasticBranchStatusExtension();
