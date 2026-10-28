import { resolve } from "node:path";
import { receiptAbsolutePath, receiptPathApi, receiptPathKey, receiptPathWithin, receiptRelativePath } from "./receipt-paths";
import { parseSwitchLoadedBranch, parseSwitchTarget, safeSwitchValue, type SwitchBranchObservation } from "./switch-contract";

/** Parsing records facts. Assessments below decide whether those facts are enough
 * for a particular operation. Neither an unfamiliar row nor a display difference
 * is silently converted to an empty workspace. */
export type WorkspaceIssue = { code: string; path: string | null };
export type WorkspacePendingRow = { status: string; path: string; isDirectory: boolean; revision: string; mergeChangeset: string | null; sourcePath?: string };
export type WorkspacePendingObservation = { cwd: string; changeset: string | null; repository: string | null; server: string | null; rows: WorkspacePendingRow[]; issues: WorkspaceIssue[]; records: number };
export type WorkspaceAssessment = { ready: boolean; complete: boolean; rowCount: number; mergeRowCount: number; ordinaryRowCount: number; linkCount: number; blockers: WorkspaceIssue[] };
export const workspacePendingArgv = ["status", "--machinereadable", "--includeRevId", "--fieldseparator=\x1f"];
const decimal = /^(0|[1-9][0-9]{0,19})$/;
const positive = /^[1-9][0-9]{0,19}$/;
const safe = (s: unknown): s is string => safeSwitchValue(s) && !/[?\uFFFD]/u.test(s);
export function canonicalWorkspaceDirectory(value: string): string {
    // Choose the path dialect from syntax, not the test host. resolve only user
    // input; observed paths must pass lexical validation before normalization.
    return receiptAbsolutePath(value) ? receiptPathApi(value).normalize(value) : resolve(value);
}
export function safeObservedWorkspacePath(value: string): boolean {
    if (!safe(value) || !receiptAbsolutePath(value)) return false;
    const windows = receiptPathApi(value).sep === "\\";
    const tail = windows ? value.replace(/\\/g, "/").replace(/^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+\/)/, "") : value.slice(1);
    return tail !== "" && tail.split("/").every(p => p !== "" && p !== "." && p !== ".." && (!windows || !/[<>:"|*]|[. ]$/.test(p) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)));
}
export function observeWorkspacePending(text: string, workdir: string): WorkspacePendingObservation {
    const cwd = canonicalWorkspaceDirectory(workdir), result: WorkspacePendingObservation = { cwd, changeset: null, repository: null, server: null, rows: [], issues: [], records: 0 };
    const issue = (code: string, path: string | null = null) => { if (result.issues.length < 8) result.issues.push({ code, path }); };
    const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop(); result.records = Math.min(lines.length, 501);
    if (Buffer.byteLength(text, "utf8") > 65536 || lines.length > 500) { issue("pending_observation_limit"); return result; }
    const h = (lines[0] ?? "").split("\x1f");
    if (h.length !== 4 || h[0] !== "STATUS" || !decimal.test(h[1]) || !safe(h[2]) || !safe(h[3])) issue("pending_header_invalid");
    else { result.changeset = h[1]; result.repository = h[2]; result.server = h[3]; }
    const seen = new Set<string>();
    for (const line of lines.slice(1)) {
        const f = line.split("\x1f"), move = f[0] === "MV", path = f[move ? 3 : 1], sourcePath = move ? f[2] : undefined, directory = f[move ? 4 : 2], revision = f[move ? 5 : 3], metadata = f[move ? 6 : 4];
        if (f.length !== (move ? 7 : 5) || !safeObservedWorkspacePath(path ?? "") || !receiptPathWithin(cwd, path) || sourcePath !== undefined && (!safeObservedWorkspacePath(sourcePath) || !receiptPathWithin(cwd, sourcePath)) || !/^(True|False)$/.test(directory ?? "")) { issue("pending_row_invalid"); continue; }
        const key = receiptPathKey(path);
        if (seen.has(key)) issue("pending_path_duplicate", path); seen.add(key);
        const m = /^Merge from ([1-9][0-9]{0,19})$/.exec(metadata ?? "");
        if (metadata !== "NO_MERGES" && !m) issue("pending_merge_metadata_unknown", path);
        if (!/^(PR|AD|CO|CH|LD|RP|CP|DE|MV|CO\+RP)$/.test(f[0])) issue("pending_status_unknown", path);
        const validRevision = /^(PR|AD|CO)$/.test(f[0]) ? revision === "-1" : positive.test(revision ?? "");
        // Observed CO+RP is a replaced checkout with a positive revision,
        // not ordinary CO/-1. Only its non-merge, file profile is admitted.
        if (f[0] === "CO+RP" && (directory !== "False" || metadata !== "NO_MERGES")) issue("pending_compound_state_unknown", path);
        if (!validRevision || move && (f[1] !== "100%" || directory !== "False" || !!m)) issue("pending_revision_or_move_unknown", path);
        if (m && (!/^(CO|RP|CP|DE)$/.test(f[0]) || directory === "True" && !/^(CP|DE)$/.test(f[0]))) issue("pending_merge_kind_unknown", path);
        result.rows.push({ status: f[0], path, isDirectory: directory === "True", revision, mergeChangeset: m?.[1] ?? null, ...(sourcePath ? { sourcePath } : {}) });
    }
    for (const parent of result.rows) for (const child of result.rows) {
        if (parent === child || !receiptPathWithin(parent.path, child.path)) continue;
        if (!parent.isDirectory || parent.mergeChangeset && !(parent.status === "CP" && child.status === "CP" && child.mergeChangeset === parent.mergeChangeset)) issue("pending_hierarchy_ambiguous", parent.path);
        if ((parent.status === "PR") !== (child.status === "PR")) issue("private_scope_overlap", parent.path);
    }
    return result;
}
const labels: Record<string, readonly string[]> = { "CO+RP": ["Replaced / Checked-out (unchanged)"], RP: ["Replaced"], CP: ["Copied (new)"], CO: ["Checked-out (changed)", "Checked-out (unchanged)"], CH: ["Changed"], AD: ["Added"], PR: ["Private"], DE: ["Removed", "Deleted"], LD: ["Locally deleted", "Deleted"], MV: ["Moved"] };
export type WorkspaceStandardObservation = { branch: SwitchBranchObservation | null; links: Array<{ changeset: string; branch: string; repository: string | null; server: string | null }>; issues: WorkspaceIssue[] };
export function observeWorkspaceStandard(text: string, pending: WorkspacePendingObservation): WorkspaceStandardObservation {
    const result: WorkspaceStandardObservation = { branch: parseSwitchLoadedBranch(text), links: [], issues: [] };
    const issue = (code: string, path: string | null = null) => { if (result.issues.length < 8) result.issues.push({ code, path }); };
    if (!result.branch) issue("loaded_branch_unknown");
    if (Buffer.byteLength(text, "utf8") > 65536) { issue("standard_observation_limit"); return result; }
    const remaining = new Set(pending.rows), sections = new Set<string>(); let section = "", linksSection = false, needsHeader = false, displayColumns: string[] = [];
    const lines = text.split(/\r?\n/);
    const head = /\(cs:([0-9]+) - head(?::[0-9]+)?\)$/.exec(lines[0] ?? "");
    if (!head || head[1] !== pending.changeset) issue("loaded_changeset_mismatch");
    for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        if (line.length > 8192 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(line)) { issue("standard_record_invalid"); continue; }
        if (/^Merge in progress(?:\b|$)/i.test(line.trim())) { issue("merge_in_progress"); continue; }
        if (line.trim() === "Pending merge links") { if (linksSection) issue("merge_links_duplicate"); linksSection = true; section = "links"; continue; }
        const link = /^\s+Merge from cs:([1-9][0-9]{0,19}) at (.+?)\s*$/.exec(line);
        if (link && section === "links") { const target = parseSwitchTarget(link[2]); if (!target) issue("merge_link_invalid"); else result.links.push({ changeset: link[1], ...target }); continue; }
        if (["Changed", "Added", "Deleted", "Moved"].includes(line.trim())) { if (needsHeader) issue("status_header_missing"); section = line.trim(); if (sections.has(section)) issue("status_section_duplicate"); sections.add(section); needsHeader = true; continue; }
        const tableHeader = /^\s+Status\s+Size(?:\s+(Last Modified|Similarity))?\s+Path\s*$/.exec(line);
        if (tableHeader && ["Changed", "Added", "Deleted", "Moved"].includes(section)) {
            if (!needsHeader) issue("status_header_duplicate");
            displayColumns = ["Size", ...(tableHeader[1] ? [tableHeader[1]] : [])]; needsHeader = false; continue;
        }
        // Only path and operation metadata are semantic. Size, age, spacing and
        // table order are presentation and deliberately not a readiness protocol.
        const matches = [...remaining].filter(row => {
            const expectedSection = /^(CP|AD|PR)$/.test(row.status) ? "Added" : /^(DE|LD)$/.test(row.status) ? "Deleted" : row.status === "MV" ? "Moved" : "Changed";
            if (section !== expectedSection || needsHeader) return false;
            const path = receiptRelativePath(pending.cwd, row.path), cells = line.trim().split(/\s{2,}/);
            const metadata = row.mergeChangeset ? ` (Merge from ${row.mergeChangeset})` : "";
            // The header defines semantic cells, not their widths or contents.
            // Directories emit an empty Size cell, collapsed by whitespace split.
            // Extra delimiters (including inside a filename) are ambiguous, never
            // an excuse to consume arbitrary text before a matching path suffix.
            const count = 2 + displayColumns.length - (row.isDirectory ? 1 : 0);
            return cells.length === count && cells.at(-1) === path && (labels[row.status] ?? []).some(label => cells[0] === label + metadata);
        });
        if (matches.length !== 1 || !["Changed", "Added", "Deleted", "Moved"].includes(section)) issue("standard_row_unmatched"); else remaining.delete(matches[0]);
    }
    if (needsHeader) issue("status_header_missing");
    if (linksSection && !result.links.length) issue("merge_links_empty");
    // Default cm status omits unchanged ordinary checkouts; the machine row
    // still records the checkout. A merge-associated checkout may never vanish.
    for (const row of remaining) if (!(row.status === "CO" && row.mergeChangeset === null)) issue("standard_row_missing", row.path);
    return result;
}
export function assessWorkspaceState(pending: WorkspacePendingObservation, standard: WorkspaceStandardObservation, options: { source?: string; allowOrdinary?: boolean } = {}): WorkspaceAssessment {
    const blockers = [...pending.issues, ...standard.issues], merged = pending.rows.filter(r => r.mergeChangeset !== null), ordinary = pending.rows.filter(r => r.mergeChangeset === null && r.status !== "PR");
    const add = (code: string, path: string | null = null) => blockers.push({ code, path });
    if (!standard.branch || standard.branch.repository !== pending.repository || standard.branch.server !== pending.server) add("workspace_identity_mismatch");
    if (standard.links.length > 1) add("multiple_merge_links");
    if (merged.length) {
        const link = standard.links[0];
        if (!link || merged.some(r => r.mergeChangeset !== link.changeset) || link.repository !== pending.repository || link.server !== pending.server) add("merge_link_mismatch");
        if (options.source) { const requested = parseSwitchTarget(options.source); if (!requested || !link || requested.branch !== link.branch || requested.repository !== null && (requested.repository !== link.repository || requested.server !== link.server)) add("merge_source_mismatch"); }
        if (!options.allowOrdinary && ordinary.length) for (const row of ordinary) add("unrelated_controlled_pending", row.path);
        for (const row of pending.rows.filter(r => r.status === "PR")) if (merged.some(m => receiptPathWithin(row.path, m.path) || receiptPathWithin(m.path, row.path))) add("private_scope_overlap", row.path);
    } else if (standard.links.length) add("merge_link_without_resolved_rows");
    // Unresolved merges can emit ordinary CO/-1/NO_MERGES. Full status must be
    // genuinely ordinary (no links or unknown conflict sections), not guessed.
    const unique = blockers.filter((b, i) => blockers.findIndex(a => a.code === b.code && a.path === b.path) === i);
    return { ready: unique.length === 0, complete: pending.issues.length === 0 && standard.issues.length === 0, rowCount: pending.rows.length, mergeRowCount: merged.length, ordinaryRowCount: ordinary.length, linkCount: standard.links.length, blockers: unique.slice(0, 8) };
}
export const workspaceBlockerMessage = (assessment: WorkspaceAssessment): string => {
    const message = assessment.blockers.map(b => b.code + (b.path ? `: ${b.path}` : "")).join("; ");
    let bounded = "";
    for (const point of message) { if (bounded.length + point.length > 200) break; bounded += point; }
    return bounded;
};
