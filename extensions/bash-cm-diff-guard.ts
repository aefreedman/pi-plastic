import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  commandMatches,
  stripAssignments,
  stripLeadingWrappers,
} from "./shared/bash-command-guards";

const BLOCK_MESSAGE =
  "`cm diff` is blocked in Pi because it can launch a GUI window and hang CLI automation. Use `plastic_status` when only changed paths are needed. Do not diff routinely; when change-boundary evidence is necessary, use a focused `plastic_diffFile`, explicitly scoped `plastic_workspaceDiff`, or `plastic_diffRevisions`.";

const CM_EXECUTABLE = String.raw`(?:"(?:[^"]*[\\/])?cm(?:\.exe)?"|'(?:[^']*[\\/])?cm(?:\.exe)?'|(?:[^"'\s]*[\\/])?cm(?:\.exe)?)`;
const DIFF_SUBCOMMAND = String.raw`(?:diff|differences)`;
const DIRECT_CM_DIFF = new RegExp(String.raw`^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*${CM_EXECUTABLE}\s+["']?${DIFF_SUBCOMMAND}["']?(?:\s|$)`, "i");
const POWERSHELL_START_PROCESS_CM_DIFF = new RegExp(String.raw`^(?:start-process|saps|start)\s+(?:-filepath\s+)?${CM_EXECUTABLE}(?=[\s;]|$)[\s\S]*?-argumentlist\s+(?:["'][^"']*${DIFF_SUBCOMMAND}[^"']*["']|${DIFF_SUBCOMMAND}(?:\s|,|$))`, "i");
const POWERSHELL_INVOKE_EXPRESSION_CM_DIFF = new RegExp(String.raw`^(?:invoke-expression|iex)\s+["'][^"']*${CM_EXECUTABLE}\s+${DIFF_SUBCOMMAND}(?:\s|["'])`, "i");

function isBashToolCall(event: { toolName?: string }): event is { toolName: "bash"; input: { command?: string } } {
  return event.toolName === "bash";
}

function segmentRunsCmDiff(segment: string): boolean {
  // cmd.exe removes caret escaping before dispatching the command.
  const normalized = segment.replace(/\^(?=.)/g, "");
  const stripped = stripLeadingWrappers(stripAssignments(normalized));
  return DIRECT_CM_DIFF.test(stripped)
    || POWERSHELL_START_PROCESS_CM_DIFF.test(normalized)
    || POWERSHELL_START_PROCESS_CM_DIFF.test(stripped)
    || POWERSHELL_INVOKE_EXPRESSION_CM_DIFF.test(stripped);
}

function commandRunsCmDiff(command: string): boolean {
  return commandMatches(command, segmentRunsCmDiff);
}

export const __bashCmDiffGuardInternals = {
  blockMessage: BLOCK_MESSAGE,
  segmentRunsCmDiff,
  commandRunsCmDiff,
  stripAssignments,
  stripLeadingWrappers,
};

export default function bashCmDiffGuard(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isBashToolCall(event as { toolName?: string })) return;

    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!command || !commandRunsCmDiff(command)) return;

    if (ctx.hasUI) {
      ctx.ui.notify("Blocked bash command invoking cm diff", "warning");
    }

    return {
      block: true,
      reason: BLOCK_MESSAGE,
    };
  });

  pi.on("user_bash", async (event, ctx) => {
    if (!event.command || !commandRunsCmDiff(event.command)) return;

    if (ctx.hasUI) {
      ctx.ui.notify("Blocked user shell command invoking cm diff", "warning");
    }

    return {
      result: {
        output: BLOCK_MESSAGE,
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
}
