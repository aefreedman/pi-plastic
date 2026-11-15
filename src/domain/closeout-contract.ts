import { parseSwitchTarget } from "./switch-contract";
import { cmWhereEquals } from "./branches";
import type { NativeCommandData, NativeHeader } from "./native-mutation";
import type { MergeStrategy, WorkspaceMergeReceipt } from "./workspace-merge-contract";
import type { CheckinChangeset, CheckinEmission, CheckinReceipt } from "./checkin-contract";
import type { SwitchBranchObservation } from "./switch-contract";
export type CloseoutRequest = { source?: string; target?: string; cardRef?: string; message?: string; strategy?: MergeStrategy; updateTarget?: boolean; includePrivate?: boolean; preflight?: boolean; format?: "text" | "json"; workdir?: string };
export const CLOSEOUT_STAGE_NAMES = ["loaded-before", "parent", "pending-before", "switch", "loaded-target", "update", "loaded-before-merge", "merge", "checkin", "loaded-final"] as const;
export type CloseoutStageName = typeof CLOSEOUT_STAGE_NAMES[number];
export type CloseoutRead = NativeCommandData & { branch: SwitchBranchObservation | null };
export type CloseoutStage = { name: CloseoutStageName } & ({ kind: "read"; result: CloseoutRead } | { kind: "command"; result: NativeCommandData } | { kind: "merge"; result: WorkspaceMergeReceipt } | { kind: "checkin"; result: CheckinReceipt });
export type CloseoutData = { requested: CloseoutRequest | null; workingDirectory: string | null; sourceBranch: string | null; targetBranch: string | null; plan: string[]; stages: CloseoutStage[]; createdChangeset: CheckinChangeset | null; linkedChangesets: CheckinEmission[]; stoppedAt: string | null; effect: "not-attempted" | "command-completed" | "uncertain" };
export type CloseoutReceipt = NativeHeader & { action: "merge-to-branch"; data: CloseoutData } & ({ ok: true; outcome: "preflight" | "completed" } | { ok: false; outcome: "failed" | "blocked" | "uncertain"; error: { code: string; stage: string; message: string } });
export const CLOSEOUT_DTO_BYTES = 1048576;
export function buildCloseoutParentArgv(source: string): string[] {
    const spec = parseSwitchTarget(source); if (!spec) throw Error("Invalid source branch.");
    const leaf = spec.branch.slice(spec.branch.lastIndexOf("/") + 1);
    const clause = spec.repository === null ? "" : ` on repository '${(spec.repository + "@" + spec.server).replace(/'/g, "''")}'`;
    return ["find", "branch", `where ${cmWhereEquals("name", leaf)} order by branchname asc limit 2${clause}`, "--format={name}|{parent}", "--nototal"];
}
export function closeoutCaptures(stages: CloseoutStage[]) { return stages.flatMap(s => s.kind === "read" || s.kind === "command" ? s.result.capture ? [s.result.capture] : [] : s.result.data.capture ? [s.result.data.capture] : []); }
export function closeoutChildEffect(stage: CloseoutStage): CloseoutData["effect"] { return stage.kind === "read" ? "not-attempted" : stage.kind === "command" ? stage.result.effect : stage.result.data.effect; }
