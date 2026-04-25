import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { commandMatches, stripAssignments } from "./shared/bash-command-guards";

const BLOCK_MESSAGE =
  "Unsafe `cm merge --merge` usage is blocked in Pi. Use `plastic_merge(...)`. If Plastic stops on a source-deleted delete/change conflict, use `plastic_resolveDeleteChangeConflict(...)` before retrying the merge. If files are already manually resolved and Plastic still has merge metadata in progress, use `plastic_finalizeMerge(...)`. Otherwise run `cm merge` with `--nointeractiveresolution` and a safe policy (`--mergetype=try`), or an explicit conflict policy when you intentionally need one (`--keepsource`/`--keepdestination` or `--automaticresolution=all-src|all-dst`).";

const DIRECT_CM_MERGE = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:["']?[^"'\s]*[\\/])?cm(?:\.exe)?\s+merge(?:\s|$)/i;
const MERGE_FLAG = /(?:^|\s)--merge(?:\s|$)/i;
const NO_INTERACTIVE_FLAG = /(?:^|\s)--nointeractiveresolution(?:\s|$)/i;
const EXPLICIT_POLICY_FLAG = /(?:^|\s)(?:--keepsource|--ks|--keepdestination|--kd)(?:\s|$)|(?:^|\s)--automaticresolution=(?:all-src|all-dst)(?:\s|$)/i;
const MERGETYPE_TRY_FLAG = /(?:^|\s)--mergetype=try(?:\s|$)/i;

function isBashToolCall(event: { toolName?: string }): event is { toolName: "bash"; input: { command?: string } } {
  return event.toolName === "bash";
}

function segmentRunsUnsafeCmMerge(segment: string): boolean {
  const stripped = stripAssignments(segment);
  if (!DIRECT_CM_MERGE.test(stripped)) return false;
  if (!MERGE_FLAG.test(stripped)) return false;
  if (!NO_INTERACTIVE_FLAG.test(stripped)) return true;

  const hasExplicitPolicy = EXPLICIT_POLICY_FLAG.test(stripped);
  const hasSafeAutoPolicy = MERGETYPE_TRY_FLAG.test(stripped);
  return !hasExplicitPolicy && !hasSafeAutoPolicy;
}

function commandRunsUnsafeCmMerge(command: string): boolean {
  return commandMatches(command, segmentRunsUnsafeCmMerge);
}

export const __bashCmMergeGuardInternals = {
  segmentRunsUnsafeCmMerge,
  commandRunsUnsafeCmMerge,
};

export default function bashCmMergeGuard(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isBashToolCall(event as { toolName?: string })) return;

    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!command || !commandRunsUnsafeCmMerge(command)) return;

    if (ctx.hasUI) {
      ctx.ui.notify("Blocked unsafe bash command invoking cm merge --merge", "warning");
    }

    return {
      block: true,
      reason: BLOCK_MESSAGE,
    };
  });
}
