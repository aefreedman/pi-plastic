import { parseMachineReadablePendingItems, summarizePendingItems } from "./pending";
import type { SwitchAttempt, SwitchCapture } from "../execution/switch-command";
export type { SwitchAttempt, SwitchCapture } from "../execution/switch-command";
export type SwitchRequest = { branch: string; pendingChanges?: "shelve" | "bring" | "cancel"; preflight?: boolean; format?: "text" | "json"; workdir?: string };
export type SwitchBranchObservation = { branch: string; repository: string; server: string; basis: "standard-status"; scope: "loaded-workspace" };
export type SwitchSummary = { totalPending: number; tracked: number; private: number; added: number; changed: number; moved: number; deleted: number; other: number };
export type SwitchStepName = "branch-before" | "pending-before" | "shelve" | "pending-recovery" | "switch" | "branch-after";
export type SwitchStep = { name: SwitchStepName; argv: string[]; attempt: SwitchAttempt; capture: SwitchCapture; evidence: "unadmitted" | "admitted" | "terminal-only" | "eligible-no-changes"; effect: "read-observed" | "not-attempted" | "command-completed" | "uncertain"; branch: SwitchBranchObservation | null; summary: SwitchSummary | null; records: number };
export type SwitchStrategy = "unresolved" | "already-on-target-branch" | "silent-noinput" | "direct-switch-private-only" | "blocked-bring-tracked-pending" | "cancel-with-pending" | "shelve-then-switch-noinput";
export type SwitchData = { requestedTarget: string | null; workdir: string | null; pendingPolicy: "shelve" | "bring" | "cancel"; defaultedPolicy: boolean; preflight: boolean; strategy: SwitchStrategy; wouldRun: boolean; plannedMutations: Array<"shelve" | "switch">; unattemptedMutations: Array<"shelve" | "switch">; steps: SwitchStep[]; branchBefore: SwitchBranchObservation | null; branchAfter: SwitchBranchObservation | null; pendingBefore: SwitchSummary | null; pendingRecovery: SwitchSummary | null; observedShelveset: null; usedNoChangesShelveRecovery: boolean; targetVerification: "unverified" | "name-only" | "exact-qualifier-spelling"; serverAliasEquivalence: "unverified"; filePreservation: "unverified"; xlinkEffects: "unverified"; effect: "not-attempted" | "command-completed" | "uncertain" };
type Base = { schemaVersion: 1; action: "switch-branch"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; sourceAdmission: "windows-cm11.0.16.10371-observed"; completeness: { read: "complete" | "incomplete" | "unknown"; capture: "complete" | "incomplete" | "unknown"; projection: true }; data: SwitchData };
export type SwitchReceipt = Base & ({ ok: true; outcome: "preflight" | "already-loaded" | "switched" } | { ok: false; outcome: "canceled" | "blocked" | "failed" | "uncertain" | "command-completed-unverified"; error: { code: "invalid_request" | "unsupported_source" | "observation_failed" | "policy_canceled" | "policy_blocked" | "mutation_failed" | "target_unverified" | "producer_failed"; stage: "input" | SwitchStepName | "policy" | "producer"; message: string } });
export const safeSwitchValue = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const identity = (value: string) => safeSwitchValue(value) && !/[?\uFFFD]/u.test(value);
const hierarchy = (value: string) => identity(value) && /^\/(?:[^/@\\]+)(?:\/[^/@\\]+)*$/u.test(value);
export function parseSwitchTarget(value: string) {
    const text = value.replace(/^br:/i, "");
    const m = /^(\/[^@]+)(?:@([^@]+)@([^@]+(?:@(?:cloud|unity))?))?$/u.exec(text);
    if (!safeSwitchValue(value) || !m || !hierarchy(m[1]) || m[2] !== undefined && (!identity(m[2]) || !identity(m[3]))) return null;
    return { branch: m[1], repository: m[2] ?? null, server: m[3] ?? null };
}
export function parseSwitchLoadedBranch(text: string): SwitchBranchObservation | null {
    const lines = text.split(/\r?\n/);
    const grammar = /^(\/[^@]+)@([^@]+)@([^\s]+) \(cs:(?:0|[1-9][0-9]{0,19}) - head\)$/u;
    const match = grammar.exec(lines[0] ?? "");
    if (!match || lines.slice(1).some(line => grammar.test(line)) || !hierarchy(match[1]) || !identity(match[2]) || !identity(match[3]) || !safeSwitchValue(`${match[1]}@${match[2]}@${match[3]}`) || !parseSwitchTarget(`${match[1]}@${match[2]}@${match[3]}`)) return null;
    return { branch: match[1], repository: match[2], server: match[3], basis: "standard-status", scope: "loaded-workspace" };
}
export function compareSwitchTarget(observed: SwitchBranchObservation, requested: string): SwitchData["targetVerification"] {
    const target = parseSwitchTarget(requested);
    if (!target || observed.branch !== target.branch) return "unverified";
    if (target.repository === null) return "name-only";
    return target.repository === observed.repository && target.server === observed.server ? "exact-qualifier-spelling" : "unverified";
}
const decimal = /^(0|[1-9][0-9]{0,19})$/;
const absolute = (value: string) => identity(value) && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
export const switchPendingArgv = ["status", "--machinereadable", "--includeRevId", "--fieldseparator=\x1f"];
/** Selected strict pending source; legacy selector and checkin's 500-record contract stay untouched. */
export function parseSwitchPending(text: string, cwd: string) {
    const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    const records = Math.min(lines.length, 20001), h = (lines[0] ?? "").split("\x1f");
    let admitted = lines.length > 0 && lines.length <= 20000 && h.length === 4 && h[0] === "STATUS" && decimal.test(h[1]) && identity(h[2] ?? "") && identity(h[3] ?? "");
    for (const line of lines.slice(1)) {
        const f = line.split("\x1f");
        if (f[0] === "MV") {
            if (f.length !== 7 || f[1] !== "100%" || !absolute(f[2]) || !absolute(f[3]) || f[4] !== "False" || !decimal.test(f[5]) || f[5] === "0" || f[6] !== "NO_MERGES") admitted = false;
        } else if (f.length !== 5 || !/^(PR|AD|CH|LD)$/.test(f[0]) || !absolute(f[1]) || !/^(True|False)$/.test(f[2]) || !(/^(PR|AD)$/.test(f[0]) ? f[3] === "-1" : decimal.test(f[3]) && f[3] !== "0") || f[4] !== "NO_MERGES") admitted = false;
    }
    if (!admitted) return { admitted: false, records, summary: null };
    const items = parseMachineReadablePendingItems(text, cwd);
    if (items.length !== lines.length - 1) return { admitted: false, records, summary: null };
    const { privatePaths: _privatePaths, ...summary } = summarizePendingItems(items, cwd);
    return { admitted: true, records, summary };
}
/** Genuine empty shelve source: exit1, empty stdout and exact workspace-specific error, never a loose substring. */
export function admittedSwitchNoChanges(stdout: string, stderr: string, cwd: string): boolean {
    const m = /^Error: There are no changes in the workspace ([^\r\n]+)\r?\n?$/u.exec(stderr);
    const key = (s: string) => s.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    return stdout === "" && !!m && safeSwitchValue(m[1]) && key(m[1]) === key(cwd);
}
