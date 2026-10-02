import { status } from "../operations/status";
import { update, add, undo, resolveDeleteChangeConflict, workspaceList } from "../operations/workspace";
import { checkin } from "../operations/checkin";
import { diff } from "../operations/diff";
import { patch } from "../operations/patch";
import { branchCreate, currentBranch, branchList, branchExists, branchDelete } from "../operations/branches";
import { switchBranch } from "../operations/switch";
import { merge, finalizeMerge } from "../operations/merge";
import { mergeBranches } from "../operations/server-merge";
import { mergeToBranch } from "../operations/closeout";
import { shelvesetCreate, shelvesetApply, shelvesetDelete, shelvesetList } from "../operations/shelvesets";
import { codeReviewCreate, codeReviewUpdate, codeReviewDelete, codeReviewFind } from "../operations/reviews";
import { PLASTIC_TOOL_NAMES } from "../plastic-tool-loading";

type CoreTool = {
  description?: string;
  args?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export const PLASTIC_TOOL_REGISTRY = {
  status,
  update,
  add,
  checkin,
  undo,
  resolveDeleteChangeConflict,
  diff,
  patch,
  branchCreate,
  switchBranch,
  merge,
  mergeBranches,
  mergeToBranch,
  finalizeMerge,
  currentBranch,
  branchList,
  branchExists,
  branchDelete,
  shelvesetCreate,
  shelvesetApply,
  shelvesetDelete,
  shelvesetList,
  codeReviewCreate,
  codeReviewUpdate,
  codeReviewDelete,
  codeReviewFind,
  workspaceList,
} as const;

export type PlasticExportName = keyof typeof PLASTIC_TOOL_REGISTRY;

export function toToolName(exportName: string): string {
  return `plastic_${exportName}`;
}

/** Preserve registration order while verifying the loading vocabulary has no drift. */
export function getRegisteredPlasticExportNames(): PlasticExportName[] {
  const names = Object.keys(PLASTIC_TOOL_REGISTRY) as PlasticExportName[];
  if (names.length !== PLASTIC_TOOL_NAMES.size || names.some((name) => !PLASTIC_TOOL_NAMES.has(toToolName(name)))) {
    throw new Error("Plastic tool registry does not match the loading catalogue.");
  }
  return names;
}

export function getCoreTool(exportName: PlasticExportName): CoreTool {
  const candidate = PLASTIC_TOOL_REGISTRY[exportName] as unknown as CoreTool;
  if (!candidate || typeof candidate.execute !== "function") {
    throw new Error(`Missing Plastic core tool export '${exportName}'.`);
  }
  return candidate;
}
