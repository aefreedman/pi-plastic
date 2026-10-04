import type { WorkspaceMergeAttempt, WorkspaceMergeCapture } from "../execution/workspace-merge-command";
export type BranchDeleteAttempt = WorkspaceMergeAttempt;
export type BranchDeleteCapture = WorkspaceMergeCapture;
export const safeBranchDeleteText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && v.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
export const validBranchDeleteOperand = (v: unknown): v is string => safeBranchDeleteText(v) && !v.trimStart().startsWith("-");
export type BranchDeleteData = {
 intendedArgv: readonly string[]; requestedBranch: string | null; workingDirectory: string | null;
 deleteChangesetsRequested: boolean | null; previewRequested: boolean | null; outputFormatRequested: "text" | "json" | null;
 attempt: BranchDeleteAttempt; capture: BranchDeleteCapture | null;
 observedDeletedBranch: null; observedDeletedChangesets: null; observedRepositoryIdentity: null; observedWorkspaceIdentity: null;
 verification: "unverified"; rollback: "not-proven"; effect: "not-attempted" | "not-proven" | "uncertain";
};
export type BranchDeleteError = { code: "invalid_request" | "launch_failed" | "aborted" | "uncertain" | "producer_failed"; message: string };
export type BranchDeleteReceipt = { schemaVersion: 1; action: "branch-delete"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true }; data: BranchDeleteData } & ({ ok: true; outcome: "preflight" | "command-completed" } | { ok: false; outcome: "failed" | "uncertain"; error: BranchDeleteError });
export const branchDeleteArgv = (branch: string, deleteChangesets: boolean): string[] => ["branch", "delete", branch, ...(deleteChangesets ? ["--delete-changesets"] : [])];
