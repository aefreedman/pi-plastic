import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  commandMatches,
  stripAssignments,
  stripLeadingWrappers,
} from "./shared/bash-command-guards";

const BLOCK_MESSAGE =
  "`cm diff` is blocked in Pi because it can launch a GUI window and hang CLI automation. Use `plastic_status` when only changed paths are needed. Do not diff routinely; when change-boundary evidence is necessary, use a focused `plastic_diffFile`, explicitly scoped `plastic_workspaceDiff`, or `plastic_diffRevisions`.";

const DIRECT_CM_DIFF = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:(?:"[^"]*[\\/]cm(?:\.exe)?"|'[^']*[\\/]cm(?:\.exe)?')|(?:[^"'\s]*[\\/])?cm(?:\.exe)?)\s+diff(?:\s|$)/i;

function isBashToolCall(event: { toolName?: string }): event is { toolName: "bash"; input: { command?: string } } {
  return event.toolName === "bash";
}

function segmentRunsCmDiff(segment: string): boolean {
  const stripped = stripLeadingWrappers(stripAssignments(segment));
  return DIRECT_CM_DIFF.test(stripped);
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
}
