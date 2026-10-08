import type { ResolutionFileSummary } from "./server-merge-resolutions";
export type ServerMergeRequest = { source: string; target: string; message?: string; mode?: "apply" | "analyze"; fileConflictsResolutionsFile?: string; unlistedConflictPolicy?: "source" | "destination"; preflight?: boolean; format?: "text" | "json" };
export type ServerChangeset = { id: string; branch: string; repository: string; server: string; mount: string };
import type { MergeAttempt, MergeCapture } from "../execution/server-merge-command";
export { emptyMergeAttempt } from "../execution/server-merge-command";
export type { MergeAttempt, MergeCapture } from "../execution/server-merge-command";
export type MergeReceiptData = {
    mode: "apply" | "analyze";
    resolutionsFile: ResolutionFileSummary | null;
    unlistedConflictPolicy: "source" | "destination" | null;
    requestedIdentity: { source: string; target: string; branch: string; repository: string; server: string } | null;
    command: string[] | null;
    capability: { state: "not-checked" | "advertised" | "missing" | "unavailable"; missingTokens: string[] };
    attempt: MergeAttempt;
    capture: { help: MergeCapture | null; merge: MergeCapture | null };
    parse: { records: number; malformed: boolean; unknownOperations: number; changesetsObserved: number; conflictsObserved: number } | null;
    observedChangesets: ServerChangeset[];
    conflictPaths: string[];
    counts: { changesetsReturned: number; changesetsOmitted: number; conflictsReturned: number; conflictsOmitted: number };
    createdChangeset: ServerChangeset | null;
    effect: "not-attempted" | "changeset-created" | "not-proven" | "uncertain";
    serverAliasEquivalence: "unverified";
    mergeLinkIdentity: "unverified";
    xlinkEffects: "unverified";
    wouldRun: boolean;
    remoteAnalysis: "not-performed" | "performed";
};
type Base = { schemaVersion: 1; action: "merge-branches"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: boolean } };
export type MergeReceiptError = { code: string; stage: "input" | "help" | "merge" | "producer"; message: string };
export type MergeReceipt = Base & (
    { ok: true; outcome: "completed"; data: MergeReceiptData & { createdChangeset: ServerChangeset; effect: "changeset-created" } } |
    { ok: true; outcome: "preflight"; data: MergeReceiptData & { createdChangeset: null; effect: "not-attempted" } } |
    { ok: true; outcome: "analyzed"; data: MergeReceiptData & { createdChangeset: null; effect: "not-attempted" } } |
    { ok: true; outcome: "no-op"; data: MergeReceiptData & { createdChangeset: null; effect: "not-proven" } } |
    { ok: false; outcome: "unsupported" | "failed"; data: MergeReceiptData & { createdChangeset: null; effect: "not-attempted" }; error: MergeReceiptError } |
    { ok: false; outcome: "conflict" | "uncertain"; data: MergeReceiptData & { createdChangeset: null; effect: "uncertain" }; error: MergeReceiptError }
);
/** Unambiguous supported syntax: branch/repository contain no @, full server tail is retained. */
export function splitServerBranch(raw: string): { branch: string; repository: string; server: string } | null {
    const match = /^br:(\/[^@]+)@([^@]+)@([^@]+(?:@(cloud|unity))?)$/.exec(raw);
    if (!match) return null;
    const [, branch, repository, server] = match;
    if (!branch || !repository || !server || branch.endsWith("/") || [branch, repository, server].some(s => s !== s.trim())) return null;
    return { branch, repository, server };
}
