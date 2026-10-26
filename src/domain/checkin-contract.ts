import { receiptAbsolutePath } from "./receipt-paths";
import type { MarkerGate } from "./marker-gate";
import { parseMergedPending } from "./merged-workspace";
import { parseMachineReadablePendingItems, type PendingItem } from "./pending";
import type { WorkspaceAssessment, WorkspaceIssue } from "./workspace-observation";
import { observeWorkspacePending } from "./workspace-observation";
export type CheckinRequest = { message: string; paths?: string[]; applyChanged?: boolean; includePrivate?: boolean; includeAll?: boolean; updateAfter?: boolean; preflight?: boolean; format?: "text" | "json"; workdir?: string };
import type { CheckinAttempt, CheckinCapture } from "../execution/checkin-command";
export type { CheckinAttempt, CheckinCapture } from "../execution/checkin-command";
export type CheckinChangeset = { id: string; branch: string; repository: string; server: string; mount: "/" };
export type CheckinSummary = { totalPending: number; tracked: number; private: number; added: number; changed: number; moved: number; deleted: number; other: number };
export type CheckinStep = { name: "pending-before" | "initial-checkin" | "private-add" | "private-retry" | "pending-recovery" | "fallback-checkin" | "pending-after" | "merge-diagnostic" | "merge-readiness"; operation: "status" | "checkin" | "add"; attempt: CheckinAttempt; capture: CheckinCapture; effect: "not-attempted" | "uncertain" | "command-completed" | "changeset-created" | "read-observed"; evidence: "unadmitted" | "admitted"; records: number; summary: CheckinSummary | null; changeset: CheckinChangeset | null };
export type CheckinItemEvent = { operation: "CO" | "AD" | "DE" | "CP" | "RP"; path: string } | { operation: "MV"; sourcePath: string; path: string };
export type CheckinData = {
    assessment?: WorkspaceAssessment; postObservationIssues?: { stage: "pending-recovery" | "pending-after"; issues: WorkspaceIssue[] }; markers: MarkerGate | null; sourceAdmission: "validated-cm-output"; requestedPaths: string[]; includedPaths: string[]; fallbackPaths: string[]; excludedPaths: Array<{ path: string; reason: string }>; privateAddPaths: string[]; blockedPrivatePaths: Array<{ path: string; reason: string }>; itemEvents: CheckinItemEvent[]; observedChangesets: CheckinChangeset[]; command: string[] | null; steps: CheckinStep[]; autoEnabledApplyChanged: boolean; usedFallbackRetry: boolean; usedPrivateAutoAddRecovery: boolean; pendingBefore: CheckinSummary | null; pendingAfter: CheckinSummary | null; wouldRun: boolean; omittedReferences: number; scopeExhaustion: "unverified"; branchHead: "unverified"; serverAliasEquivalence: "unverified"; xlinkEffects: "unverified"; mergeLinkIdentity: "unverified" };
type Base = { schemaVersion: 1; action: "checkin"; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: boolean } };
export type CheckinReceipt = Base & (
    { ok: true; outcome: "completed"; data: CheckinData & { effect: "changeset-created"; createdChangeset: CheckinChangeset } } |
    { ok: true; outcome: "preflight"; data: CheckinData & { effect: "not-attempted"; createdChangeset: null } } |
    { ok: false; outcome: "failed" | "unsupported" | "uncertain"; data: CheckinData & { effect: "not-attempted" | "uncertain" | "command-completed" | "changeset-created"; createdChangeset: CheckinChangeset | null }; error: { code: string; stage: "input" | "pending" | "checkin" | "producer"; message: string } }
);
export const checkinUnsafeText = /[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const checkinSafeValue = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096 && !checkinUnsafeText.test(s);
// Comments alone admit CR/LF; all other controls, bounds and surrogate rules stay unchanged.
export const checkinSafeComment = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096 && !checkinUnsafeText.test(s.replace(/[\r\n]/g, " "));
// Loss-marker rejection is a conservative admission policy, not proof of original Unicode fidelity.
const identity = (s: string) => checkinSafeValue(s) && s === s.trim() && !/[?\uFFFD]/.test(s);
const absolute = (s: string) => identity(s) && receiptAbsolutePath(s);
export const checkinDecimal = /^(0|[1-9][0-9]{0,19})$/;
export function parseCheckinChangeset(payload: string): CheckinChangeset | null {
    const m = /^cs:(0|[1-9][0-9]{0,19})@br:(\/[^@]+)@([^@]+)@([^@]+(?:@(cloud|unity))?) \(mount:'\/'\)$/.exec(payload);
    if (!m || !m.slice(2, 5).every(identity) || m[2].endsWith("/")) return null;
    return { id: m[1], branch: m[2], repository: m[3], server: m[4], mount: "/" };
}
export type CheckinSeparators = { start: string; end: string; field: string };
export function parseCheckinEvidence(text: string, s: CheckinSeparators) {
    const changesets: CheckinChangeset[] = [], events: CheckinItemEvent[] = [];
    const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    let malformed = !lines.length || lines.length > 500, started = 0;
    for (const [index, line] of lines.entries()) {
        if (!line.startsWith(s.start) || !line.endsWith(s.end)) { malformed = true; continue; }
        const fields = line.slice(s.start.length, -s.end.length).split(s.field), [op, value] = fields;
        if (op === "CI_START" && fields.length === 1) { started++; if (index !== 0) malformed = true; }
        else if (op === "STAGE" && fields.length === 2 && value.length <= 4096 && !checkinUnsafeText.test(value)) { if (changesets.length) malformed = true; }
        else if ((op === "CO" || op === "AD" || op === "DE" || op === "CP" || op === "RP") && fields.length === 2 && absolute(value)) { events.push({ operation: op, path: value }); if (changesets.length) malformed = true; }
        else if (op === "MV" && fields.length === 3 && absolute(value) && absolute(fields[2])) { events.push({ operation: "MV", sourcePath: value, path: fields[2] }); if (changesets.length) malformed = true; }
        else if (op === "CHANGESET" && fields.length === 2) { const cs = parseCheckinChangeset(value); if (cs) changesets.push(cs); else malformed = true; }
        else malformed = true;
    }
    if (started !== 1 || changesets.length > 1) malformed = true;
    return { admitted: !malformed, records: Math.min(lines.length, 501), changesets, events };
}
export function parseCheckinPending(text: string, cwd: string) {
    const observation = observeWorkspacePending(text, cwd);
    const items = observation.issues.length ? [] : parseMachineReadablePendingItems(text, observation.cwd).map(item => ({ ...item, kind: item.statusCode === "CP" ? "added" as const : item.kind }));
    const merged = parseMergedPending(text, observation.cwd) ?? undefined;
    return { admitted: observation.issues.length === 0 && items.length === observation.rows.length, records: observation.records, items,
        repository: observation.repository, server: observation.server, merged, observation };
}
