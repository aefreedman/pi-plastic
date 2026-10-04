import type { WorkspaceMergeAttempt, WorkspaceMergeCapture, MergeStrategy, WorkspaceMergeReceipt } from "./workspace-merge-contract";
import type { SwitchBranchObservation, SwitchSummary, SwitchReceipt } from "./switch-contract";
import type { CheckinChangeset, CheckinReceipt } from "./checkin-contract";
import type { UpdateReceipt } from "./update-contract";
export type CloseoutRequest = { source?: string; target?: string; cardRef?: string; message?: string; strategy?: MergeStrategy; updateTarget?: boolean; includePrivate?: boolean; preflight?: boolean; format?: "text" | "json"; workdir?: string };
export const CLOSEOUT_STAGE_NAMES = ["loaded-before", "parent", "pending-before", "switch", "loaded-after-switch", "update", "loaded-before-merge", "merge", "readiness", "loaded-before-checkin", "checkin-preflight", "checkin", "loaded-final", "pending-final"] as const;
export type CloseoutStageName = typeof CLOSEOUT_STAGE_NAMES[number];
export type CloseoutRead = { argv: string[]; attempt: WorkspaceMergeAttempt; capture: WorkspaceMergeCapture | null; admission: "unsupported" | "admitted"; branch: SwitchBranchObservation | null; parentPath: string | null; emptyParentResult: boolean; summary: SwitchSummary | null };
export type CloseoutStage = { name: CloseoutStageName } & (
 { kind: "read"; result: CloseoutRead } | { kind: "switch"; result: SwitchReceipt } | { kind: "update"; result: UpdateReceipt } | { kind: "merge"; result: WorkspaceMergeReceipt } | { kind: "checkin"; result: CheckinReceipt }
);
export type CloseoutData = { requested: { source: string | null; target: string | null; message: string | null; cardRef: string | null; strategy: MergeStrategy; updateTarget: boolean; includePrivate: boolean; preflight: boolean; outputFormat: "text" | "json"; workdir: string } | null; sourceBranch: string | null; targetBranch: string | null; targetSource: "unresolved" | "explicit" | "parent-read"; checkinMessage: string | null; stages: CloseoutStage[]; unattemptedStages: CloseoutStageName[]; unobservedChild: "switch" | "update" | "merge" | "checkin-preflight" | "checkin" | null; createdChangeset: CheckinChangeset | null; pendingAfter: SwitchSummary | null; targetVerification: "unverified" | "name-only" | "exact-qualifier-spelling"; serverAliasEquivalence: "unverified"; sourceLink: "unverified"; branchHead: "unverified"; exclusiveScope: "unverified"; rollback: "not-proven"; effect: "not-attempted" | "command-completed" | "uncertain" | "changeset-created" };
export type CloseoutReceipt = { schemaVersion: 1; action: "merge-to-branch"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: boolean }; data: CloseoutData } & (
 { ok: true; outcome: "preflight" | "completed" } | { ok: false; outcome: "blocked" | "failed" | "uncertain"; error: { code: "invalid_request" | "unsupported_source" | "observation_failed" | "target_unverified" | "policy_blocked" | "child_failed" | "producer_failed"; stage: "input" | CloseoutStageName | "producer"; message: string } }
);
export const CLOSEOUT_DTO_BYTES = 1048576;
/** Ledger keeps the five complete bounded child receipts and at most eleven compact reads.
 * No child text/stdout/stderr is duplicated, no positive changeset is projected away. */
export function closeoutChildEffect(s: CloseoutStage): CloseoutData["effect"] { if(s.kind==="read")return "not-attempted";const e=s.result.data.effect;return e==="not-proven"?"command-completed":e; }
export function closeoutCaptures(stages: CloseoutStage[]) { return stages.flatMap(s=>s.kind==="read"?[s.result.capture]:s.kind==="update"?[s.result.data.capture]:s.kind==="merge"?[s.result.data.apply.capture,s.result.data.shortStatus.capture,s.result.data.fullStatus.capture]:s.result.data.steps.map(x=>x.capture)).filter((x):x is WorkspaceMergeCapture=>x!==null); }
