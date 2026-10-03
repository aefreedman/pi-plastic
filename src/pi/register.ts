import { executeCheckinOutput, checkinOutputSchema } from "./checkin-output";
import { executeSwitchOutput, switchOutputSchema } from "./switch-output";
import { executeUpdateOutput, updateOutputSchema } from "./update-output";
import { executeBranchCreateOutput, branchCreateOutputSchema } from "./branch-create-output";
import { executeServerMergeOutput, serverMergeOutputSchema } from "./server-merge-output";
import { executeDiffOutput, diffInputSchema, diffOutputSchema } from "./diff-output";
import { executeCodeReviewFindOutput, codeReviewFindOutputSchema } from "./code-review-find-output";
import { executeShelvesetListOutput, shelvesetListOutputSchema } from "./shelveset-list-output";
import { executeWorkspaceListOutput, workspaceListOutputSchema } from "./workspace-list-output";
import { executeBranchListOutput, branchListOutputSchema } from "./branch-list-output";
import { executeBranchOutput, currentBranchOutputSchema, branchExistsOutputSchema } from "./branch-output";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeStatusOutput, statusOutputSchema } from "./status-output";
import { runWithAbortSignal } from "../execution/context";
import { renderPlasticCall, renderPlasticResult, renderPlasticSearchResult } from "../plastic-renderers";
import {
  getEffectivePlasticToolOwnership,
  getInitiallyInactivePlasticTools,
  getPlasticToolLoadingMode,
  getRestoredPlasticToolNames,
  getUnknownExactPlasticToolNames,
  isPlasticToolBrowseRequest,
  PLASTIC_TOOL_BROWSE_TEXT,
  PLASTIC_TOOL_SEARCH_NAME,
  searchPlasticTools,
} from "../plastic-tool-loading";
import { TOOL_CONFIG, normalizeArgs } from "./arguments";
import { buildParameters } from "./schemas";
import { getCoreTool, getRegisteredPlasticExportNames, toToolName } from "./tool-registry";
import { notifyPatchCapabilityWarning, type CapabilityDiagnosticContext } from "./capability-diagnostics";

function toText(result: unknown): string {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

export function registerPlasticTools(pi: ExtensionAPI, extensionSourcePath: string) {
  const exportNames = getRegisteredPlasticExportNames();
  const coreDescriptions = new Map<string, string>();
  for (const exportName of exportNames) {
    const coreTool = getCoreTool(exportName);
    coreDescriptions.set(toToolName(exportName), coreTool.description ?? toToolName(exportName));
  }

  for (const exportName of exportNames) {
    const coreTool = getCoreTool(exportName);
    const config = TOOL_CONFIG[exportName] ?? {};
    pi.registerTool({
      name: toToolName(exportName),
      label: toToolName(exportName),
      description: coreTool.description ?? toToolName(exportName),
      parameters: exportName === "diff" ? diffInputSchema : buildParameters(coreTool.args),
      ...(exportName === "status" ? { outputSchema: statusOutputSchema } : exportName === "currentBranch" ? { outputSchema: currentBranchOutputSchema } : exportName === "branchExists" ? { outputSchema: branchExistsOutputSchema } : exportName === "branchList" ? { outputSchema: branchListOutputSchema } : exportName === "workspaceList" ? { outputSchema: workspaceListOutputSchema } : exportName === "shelvesetList" ? { outputSchema: shelvesetListOutputSchema } : exportName === "codeReviewFind" ? { outputSchema: codeReviewFindOutputSchema } : exportName === "diff" ? { outputSchema: diffOutputSchema } : exportName === "mergeBranches" ? { outputSchema: serverMergeOutputSchema } : exportName === "checkin" ? { outputSchema: checkinOutputSchema } : exportName === "branchCreate" ? { outputSchema: branchCreateOutputSchema } : exportName === "switchBranch" ? { outputSchema: switchOutputSchema } : exportName === "update" ? { outputSchema: updateOutputSchema } : {}),
      prepareArguments: config.prepareArguments,
      renderCall(args, theme, context) {
        return renderPlasticCall(exportName, args ?? {}, theme, context);
      },
      renderResult(result, options, theme, context) {
        return renderPlasticResult(exportName, result, options, theme, context);
      },
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const normalizedParams = normalizeArgs(params);
        if (exportName !== "mergeBranches" && normalizedParams.workdir === undefined && ctx?.cwd) {
          normalizedParams.workdir = ctx.cwd;
        }
        if (exportName === "checkin") return runWithAbortSignal(signal, () => executeCheckinOutput(normalizedParams));
        if (exportName === "switchBranch") return runWithAbortSignal(signal, () => executeSwitchOutput(normalizedParams));
        if (exportName === "update") return runWithAbortSignal(signal, () => executeUpdateOutput(normalizedParams));
        if (exportName === "branchCreate") return runWithAbortSignal(signal, () => executeBranchCreateOutput(normalizedParams));
        if (exportName === "mergeBranches") return runWithAbortSignal(signal, () => executeServerMergeOutput(normalizedParams));
        if (exportName === "diff") return runWithAbortSignal(signal, () => executeDiffOutput(normalizedParams));
        if (exportName === "codeReviewFind") return runWithAbortSignal(signal, () => executeCodeReviewFindOutput(normalizedParams));
        if (exportName === "shelvesetList") return runWithAbortSignal(signal, () => executeShelvesetListOutput(normalizedParams));
        if (exportName === "workspaceList") return runWithAbortSignal(signal, () => executeWorkspaceListOutput(normalizedParams));
        if (exportName === "branchList") return runWithAbortSignal(signal, () => executeBranchListOutput(normalizedParams));
        if (exportName === "status") return runWithAbortSignal(signal, () => executeStatusOutput(normalizedParams));
        if (exportName === "currentBranch" || exportName === "branchExists") return runWithAbortSignal(signal, () => executeBranchOutput(exportName, normalizedParams));
        const result = await runWithAbortSignal(signal, async () => coreTool.execute(normalizedParams));
        const text = toText(result);
        return {
          content: [{ type: "text", text }],
          details: {
            exportName,
            rawResult: result,
            ...(typeof normalizedParams.workdir === "string" ? { workdir: normalizedParams.workdir } : {}),
          },
        };
      },
    });
  }

  pi.registerTool({
    name: PLASTIC_TOOL_SEARCH_NAME,
    label: "Plastic Tool Search",
    description: "Search and enable Plastic SCM / Unity Version Control tools for workspace status and sync, changes and checkins, text-only diffs and patches, branches and merges, shelvesets, code reviews, and workspaces.",
    promptSnippet: "Use plastic_tool_search to find and enable Plastic SCM capabilities that are not active.",
    promptGuidelines: [
      "Use plastic_tool_search before a Plastic SCM action when an appropriate plastic_* tool is not active. Inspect exact mutation targets. Do not preflight routinely: use preflight for ambiguous or broad scope, moved/deleted path rewriting, compound operations, or an explicit preview request.",
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Capability or workflow to search for." })),
      toolNames: Type.Optional(Type.Array(Type.String({ description: "Exact public Plastic tool name." }), { maxItems: 4, description: "Optional exact tool names to enable." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 4, description: "Maximum matching tools to enable. Defaults to the single best keyword match; exact toolNames requests may enable up to four." })),
    }),
    renderCall(args, theme, context) {
      return renderPlasticCall("tool_search", args ?? {}, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderPlasticSearchResult(result, options, theme, context);
    },
    async execute(_toolCallId, params) {
      if (isPlasticToolBrowseRequest(params)) {
        return {
          content: [{ type: "text", text: PLASTIC_TOOL_BROWSE_TEXT }],
          details: { browse: true, matches: [], added: [], alreadyActive: [], guidance: [] },
        };
      }

      const ownership = getEffectivePlasticToolOwnership(pi.getAllTools(), extensionSourcePath);
      const unknownToolNames = getUnknownExactPlasticToolNames(params.toolNames);
      const active = pi.getActiveTools();
      // Never infer ownership without canonical sourceInfo. In that
      // compatibility mode we may describe known tools that are already active,
      // but cannot safely activate an inactive same-named definition.
      const matches = searchPlasticTools(params, coreDescriptions).filter((match) =>
        ownership.usesSourceInfo ? ownership.ownedToolNames.has(match.name) : active.includes(match.name),
      );
      const requestedExactToolNames = Array.isArray(params.toolNames)
        ? [...new Set(params.toolNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0).map((name) => name.trim()))]
        : [];
      const unavailableToolNames = requestedExactToolNames.filter((name) => !matches.some((match) => match.name.toLowerCase() === name.toLowerCase()));
      if (matches.length === 0) {
        const unavailable = unavailableToolNames.length > 0
          ? ` Unknown or unavailable exact tool names: ${unavailableToolNames.join(", ")}.`
          : "";
        return {
          content: [{ type: "text", text: `No executable Plastic tools matched. Try a capability, workflow term, or exact public plastic_* tool name.${unavailable}` }],
          details: { matches: [], added: [], alreadyActive: [], guidance: [], unknownToolNames, unavailableToolNames },
        };
      }

      const matchNames = matches.map((match) => match.name);
      const added = matchNames.filter((name) => !active.includes(name));
      const alreadyActive = matchNames.filter((name) => active.includes(name));
      if (added.length > 0) pi.setActiveTools([...new Set([...active, ...added])]);

      const guidance = matches.flatMap((match) => match.guidance);
      const unknownText = unavailableToolNames.length > 0 ? `\nUnknown or unavailable exact tool names: ${unavailableToolNames.join(", ")}.` : "";
      const loadedText = added.length > 0 ? `Activated: ${added.join(", ")}.` : "All matching tools were already active.";
      return {
        content: [{
          type: "text",
          text: `${loadedText}\nMatches: ${matchNames.join(", ")}.\nGuidance: ${guidance.join(" ")}${unknownText}`,
        }],
        details: { matches: matchNames, added, alreadyActive, guidance, unknownToolNames, unavailableToolNames },
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await notifyPatchCapabilityWarning(ctx as CapabilityDiagnosticContext);
    const ownership = getEffectivePlasticToolOwnership(pi.getAllTools(), extensionSourcePath);
    const active = pi.getActiveTools();
    const mode = getPlasticToolLoadingMode();
    // Fail safe when provenance is unavailable or the effective loader is a
    // foreign first-registration-wins collision. Preserve the active set
    // exactly; even adding the public loader name could activate foreign code.
    if (!ownership.usesSourceInfo) return;

    // The all-active eval mode keeps every currently exposed Plastic tool
    // active while omitting the dynamic loader from the provider surface.
    if (mode === "all-active") {
      pi.setActiveTools(active.filter((name) => name !== PLASTIC_TOOL_SEARCH_NAME));
      return;
    }

    const initiallyInactive = getInitiallyInactivePlasticTools(mode);
    const ownedInitiallyInactive = new Set([...initiallyInactive].filter((name) => ownership.ownedToolNames.has(name)));
    const restored = getRestoredPlasticToolNames(ctx.sessionManager.getBranch(), ownership.ownedToolNames);
    const preserved = active.filter((name) => !ownedInitiallyInactive.has(name));
    pi.setActiveTools([...new Set([...preserved, PLASTIC_TOOL_SEARCH_NAME, ...restored])]);
  });
}
