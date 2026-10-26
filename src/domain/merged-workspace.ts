import { receiptAbsolutePath, receiptJoinPath, receiptPathWithin, receiptRelativePath, receiptPathKey, receiptPathApi } from "./receipt-paths";
import { copiedPathKey, type CopiedPending } from "./copied-merge";
import { safeSwitchValue } from "./switch-contract";
import { observeWorkspacePending, observeWorkspaceStandard, assessWorkspaceState, type WorkspacePendingRow } from "./workspace-observation";

const decimal = /^(0|[1-9][0-9]{0,19})$/;
const positive = /^[1-9][0-9]{0,19}$/;
const safe = (s: string) => safeSwitchValue(s) && !/[?\uFFFD]/u.test(s);
const component = (part: string) => part !== "" && part !== "." && part !== ".." && part === part.trim() && !part.endsWith(".") && !/[\\/:*"<>|]/.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part);
const absolute = (s: string) => safe(s) && receiptAbsolutePath(s) && (s.startsWith("/") ? s.slice(1).split("/").every(p => p !== "" && p !== "." && p !== "..") : /^[A-Za-z]:\\/.test(s) && s.slice(3).split("\\").every(component));
const relative = (s: string) => safe(s) && s.startsWith("/") && s.slice(1).split("/").every(component);
export type MergedDeclaration = { path: string; actionPath: string; status: "CP" | "RP" | "CO" | "DE" };
export type MergedPending = CopiedPending & { rows: Array<{ path: string; status: "CP" | "RP" | "CO" | "DE"; isDirectory: boolean }>; privateRows: Array<{ path: string; isDirectory: boolean }>; ordinaryRows?: WorkspacePendingRow[] };
/** A declaration/action pair is only a candidate, never resolution proof. Numeric
 * FILE fields are bounded producer tokens, not asserted revision identities. */
export function parseMergedApply(text: string, token: string): MergedDeclaration[] | null {
    if (Buffer.byteLength(text, "utf8") > 65536) return null;
    const start = token + "S__", end = token + "E__", field = token + "F__";
    const declarations: Array<{ path: string; status: MergedDeclaration["status"] }> = [], actions: Array<{ path: string; status: "copy" | "merge" | "delete" }> = [];
    let rest = text, count = 0;
    while (rest.trim() !== "") {
        if (++count > 256 || !rest.startsWith(start)) return null;
        const e = rest.indexOf(end, start.length); if (e < 0) return null;
        const f = rest.slice(start.length, e).split(field); rest = rest.slice(e + end.length).replace(/^\r?\n/, "");
        if (f.length === 2 && /^(DO_COPIED|DO_MERGE|DO_DELETED)$/.test(f[0]) && absolute(f[1])) actions.push({ path: f[1], status: f[0] === "DO_MERGE" ? "merge" : f[0] === "DO_DELETED" ? "delete" : "copy" });
        else if (!actions.length && f.length === 3 && f[0] === "APPLY" && /^(ADD|RM)$/.test(f[1]) && relative(f[2])) declarations.push({ path: f[2], status: f[1] === "ADD" ? "CP" : "DE" });
        else if (!actions.length && ((f[0] === "FILE_SRC" && f.length === 5) || (f[0] === "FILE_CONFLICT" && f.length === 6)) && relative(f[1]) && f.slice(2).every(v => decimal.test(v))) declarations.push({ path: f[1], status: f[0] === "FILE_SRC" ? "RP" : "CO" });
        else return null;
    }
    if (!declarations.length || declarations.length !== actions.length || new Set(declarations.map(d => receiptPathKey(d.path))).size !== declarations.length || new Set(actions.map(a => copiedPathKey(a.path))).size !== actions.length) return null;
    // Absolute workspace scope is established by the pending observation below.
    const paired = new Map<string, MergedDeclaration>(), remaining = new Set(actions);
    // Pair the most specific repository paths first: /a.txt must not consume
    // /dir/a.txt's action. Exact cwd-relative equality is still required below
    // by correlateMergedApply before any readiness can be admitted.
    for (const d of [...declarations].sort((a, b) => b.path.length - a.path.length)) {
        const matches = [...remaining].filter(a => receiptPathKey(a.path).endsWith(receiptPathApi(a.path).sep === "\\" ? d.path.toLowerCase() : d.path) && a.status === (d.status === "CO" ? "merge" : d.status === "DE" ? "delete" : "copy"));
        if (matches.length !== 1) return null;
        remaining.delete(matches[0]); paired.set(d.path, { ...d, actionPath: matches[0].path });
    }
    return remaining.size === 0 ? declarations.map(d => paired.get(d.path)!) : null;
}
export function parseMergedPending(text: string, cwd: string): MergedPending | null {
    const observation = observeWorkspacePending(text, cwd);
    if (observation.issues.length || !observation.changeset || !observation.repository || !observation.server) return null;
    const merged = observation.rows.filter(r => r.mergeChangeset !== null);
    if (!merged.length || merged.some(r => r.mergeChangeset !== merged[0].mergeChangeset)) return null;
    return { changeset: observation.changeset, repository: observation.repository, server: observation.server, mergeChangeset: merged[0].mergeChangeset!,
        paths: merged.map(r => r.path), rows: merged.map(r => ({ path: r.path, status: r.status as MergedDeclaration["status"], isDirectory: r.isDirectory })),
        privateRows: observation.rows.filter(r => r.status === "PR").map(r => ({ path: r.path, isDirectory: r.isDirectory })),
        ordinaryRows: observation.rows.filter(r => r.mergeChangeset === null && r.status !== "PR") };
}
export function correlateMergedApply(declarations: MergedDeclaration[], pending: MergedPending, cwd: string): boolean {
    return declarations.length === pending.rows.length && declarations.every(d => {
        const key = copiedPathKey(receiptJoinPath(cwd, d.path));
        return copiedPathKey(d.actionPath) === key && pending.rows.some(r => copiedPathKey(r.path) === key && r.status === d.status);
    });
}
/** Native checkin may report structural parent-directory CO events in addition
 * to the pending rows. Only strict in-workspace ancestors are admitted extras;
 * arbitrary file events, duplicates and missing selected rows remain uncertain. */
export function correlateMergedCheckin(events: ReadonlyArray<{ operation: string; path: string }>, pending: MergedPending, cwd: string): boolean {
    if (!events.every(e => absolute(e.path)) || new Set(events.map(e => copiedPathKey(e.path))).size !== events.length) return false;
    if (!pending.rows.every(r => events.some(e => copiedPathKey(e.path) === copiedPathKey(r.path) && e.operation === r.status))) return false;
    return events.every(e => {
        const key = copiedPathKey(e.path), row = pending.rows.find(r => copiedPathKey(r.path) === key);
        if (row) return e.operation === row.status;
        return e.operation === "CO" && (receiptPathWithin(cwd, e.path) || copiedPathKey(cwd) === copiedPathKey(e.path)) && pending.rows.some(r => copiedPathKey(r.path).startsWith(key + "/"));
    });
}
/** Compatibility view over the shared semantic observation and safety policy. */
export function admitMergedStandardStatus(text: string, pending: MergedPending, source: string, cwd: string): boolean {
    const rows: WorkspacePendingRow[] = [
        ...pending.rows.map(r => ({ ...r, revision: r.status === "CO" ? "-1" : "1", mergeChangeset: pending.mergeChangeset })),
        ...pending.privateRows.map(r => ({ ...r, status: "PR", revision: "-1", mergeChangeset: null })),
        ...(pending.ordinaryRows ?? []),
    ];
    const observation = { cwd, changeset: pending.changeset, repository: pending.repository, server: pending.server, rows, issues: [], records: rows.length + 1 };
    return assessWorkspaceState(observation, observeWorkspaceStandard(text, observation), { source }).ready;
}
