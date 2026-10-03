export type BranchCreateRequest = { branch: string; parent?: string; changeset?: string; label?: string; comment?: string; commentsFile?: string; allowRootBranch?: boolean; workdir?: string };
import type { BranchCreateAttempt, BranchCreateCapture } from "../execution/branch-create-command";
export { emptyBranchCreateAttempt } from "../execution/branch-create-command";
export type { BranchCreateAttempt, BranchCreateCapture } from "../execution/branch-create-command";
export type BranchCreateData = {
    requested: { branch: string; parent: string | null; changeset: string | null; label: string | null; comment: string | null; commentsFile: string | null; allowRootBranch: boolean } | null;
    resolvedTarget: string | null;
    parentResolution: { basis: "not-required" | "explicit" | "status" | "unresolved"; observedBranch: string | null; repositoryVerification: "unverified" };
    parentCommands: Array<{ argv: string[]; attempt: BranchCreateAttempt; capture: BranchCreateCapture }>;
    command: string[] | null;
    attempt: BranchCreateAttempt;
    capture: BranchCreateCapture | null;
    observedCreatedIdentity: null;
    repositoryVerification: "unverified";
    workspaceSwitch: "not-requested";
};
type Base = { schemaVersion: 1; action: "branch-create"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true } };
export type BranchCreateError = { code: "invalid_request" | "unsupported_source" | "ambiguous_qualifier" | "parent_unresolved" | "launch_failed" | "aborted" | "uncertain" | "producer_failed"; stage: "input" | "source" | "parent" | "create" | "producer"; message: string };
export type BranchCreateReceipt = Base & (
    { ok: true; outcome: "command-completed"; data: BranchCreateData & { effect: "not-proven" } } |
    { ok: false; outcome: "failed" | "unsupported"; data: BranchCreateData & { effect: "not-attempted" }; error: BranchCreateError } |
    { ok: false; outcome: "uncertain"; data: BranchCreateData & { effect: "uncertain" }; error: BranchCreateError }
);
export const branchCreateUnsafeText = /[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export const safeBranchCreateText = (s: string): boolean => s.length <= 4096 && !branchCreateUnsafeText.test(s);
/**
 * Direct standard-status source only, admitted against known-original Unicode
 * on Windows cm 11.0.16.10371. No runtime version query or compact grammar is
 * claimed. Changeset ownership is not the loaded branch. '?' and U+FFFD remain
 * unsupported/ambiguous source identities, not proof of character degradation.
 */
export function parseBranchCreateParent(output: string): string | null {
    const lines = output.split(/\r?\n/).filter(line => line.length > 0);
    if (lines.length !== 1) return null;
    const match = /^(\/[^@]+)@[^@]+@[^\s]+ \(cs:(?:0|[1-9][0-9]{0,19}) - head\)$/u.exec(lines[0]!);
    if (!match || !safeBranchCreateText(match[1]!) || !/^\/(?:[^/@\\]+)(?:\/[^/@\\]+)*$/u.test(match[1]!) || match[1] !== match[1]!.trim() || /[?\uFFFD]/u.test(match[1]!)) return null;
    return match[1]!;
}
