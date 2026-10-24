import { receiptAbsolutePath, receiptJoinPath, receiptPathWithin, receiptRelativePath, receiptPathKey, receiptPathApi } from "./receipt-paths";
import { copiedPathKey, type CopiedPending } from "./copied-merge";
import { parseSwitchLoadedBranch, parseSwitchTarget, safeSwitchValue } from "./switch-contract";

const decimal = /^(0|[1-9][0-9]{0,19})$/;
const positive = /^[1-9][0-9]{0,19}$/;
const safe = (s: string) => safeSwitchValue(s) && !/[?\uFFFD]/u.test(s);
const component = (part: string) => part !== "" && part !== "." && part !== ".." && part === part.trim() && !part.endsWith(".") && !/[\\/:*"<>|]/.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part);
const absolute = (s: string) => safe(s) && receiptAbsolutePath(s) && (s.startsWith("/") ? s.slice(1).split("/").every(p => p !== "" && p !== "." && p !== "..") : /^[A-Za-z]:\\/.test(s) && s.slice(3).split("\\").every(component));
const relative = (s: string) => safe(s) && s.startsWith("/") && s.slice(1).split("/").every(component);
export type MergedDeclaration = { path: string; actionPath: string; status: "CP" | "RP" | "CO" | "DE" };
export type MergedPending = CopiedPending & { rows: Array<{ path: string; status: "CP" | "RP" | "CO" | "DE"; isDirectory: boolean }>; privateRows: Array<{ path: string; isDirectory: boolean }> };
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
    const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    if (!absolute(cwd) || lines.length < 2 || lines.length > 129 || Buffer.byteLength(text, "utf8") > 65536) return null;
    const h = lines[0].split("\x1f");
    if (h.length !== 4 || h[0] !== "STATUS" || !decimal.test(h[1]) || !h.slice(2).every(safe)) return null;
    const rows: MergedPending["rows"] = [], privateRows: MergedPending["privateRows"] = []; let mergeChangeset = "";
    const keys = new Set<string>();
    for (const line of lines.slice(1)) {
        const f = line.split("\x1f"), m = /^Merge from ([1-9][0-9]{0,19})$/.exec(f[4] ?? "");
        if (f.length !== 5 || !absolute(f[1]) || !/^(True|False)$/.test(f[2])) return null;
        const key = copiedPathKey(f[1]);
        if (!receiptPathWithin(cwd, f[1]) || keys.has(key)) return null;
        keys.add(key);
        if (f[0] === "PR" && f[3] === "-1" && f[4] === "NO_MERGES") {
            privateRows.push({ path: f[1], isDirectory: f[2] === "True" }); continue;
        }
        if (!/^(CO|RP|CP|DE)$/.test(f[0]) || f[2] === "True" && !/^(CP|DE)$/.test(f[0]) || !(f[0] === "CO" ? f[3] === "-1" : positive.test(f[3])) || !m || mergeChangeset && mergeChangeset !== m[1]) return null;
        mergeChangeset = m[1]; rows.push({ path: f[1], status: f[0] as MergedDeclaration["status"], isDirectory: f[2] === "True" });
    }
    if (!rows.length || privateRows.some(parent => !parent.isDirectory && privateRows.some(child => copiedPathKey(child.path).startsWith(copiedPathKey(parent.path) + "/")))) return null;
    // A pending file cannot own descendants. The captured added-directory
    // profile contains only copied children; deletion needs no child inventory.
    if (rows.some(parent => rows.some(child => copiedPathKey(child.path).startsWith(copiedPathKey(parent.path) + "/") && (!parent.isDirectory || parent.status !== "CP" || child.status !== "CP")))) return null;
    // Exclusion is only sourced for unrelated private work, never descendants of
    // a selected directory or ancestors/collisions of controlled merge paths.
    if (privateRows.some(p => rows.some(r => {
        const a = copiedPathKey(p.path), b = copiedPathKey(r.path);
        return a === b || b.startsWith(a + "/") || a.startsWith(b + "/");
    }))) return null;
    return { changeset: h[1], repository: h[2], server: h[3], mergeChangeset, paths: rows.map(r => r.path), rows, privateRows };
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
        return e.operation === "CO" && receiptPathWithin(cwd, e.path) && pending.rows.some(r => copiedPathKey(r.path).startsWith(key + "/"));
    });
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function admitMergedStandardStatus(text: string, pending: MergedPending, source: string, cwd: string): boolean {
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== ""), branch = parseSwitchLoadedBranch(text), requested = parseSwitchTarget(source);
    if (!branch || !requested || branch.repository !== pending.repository || branch.server !== pending.server || !lines[0].endsWith(`(cs:${pending.changeset} - head)`) || lines[1] !== "Pending merge links") return false;
    const link = /^    Merge from cs:([1-9][0-9]{0,19}) at (.+)$/.exec(lines[2] ?? ""), linked = link && parseSwitchTarget(link[2]);
    if (!link || !linked || link[1] !== pending.mergeChangeset || linked.branch !== requested.branch || linked.repository !== pending.repository || linked.server !== pending.server || requested.repository !== null && (requested.repository !== linked.repository || requested.server !== linked.server)) return false;
    if (Buffer.byteLength(text, "utf8") > 65536 || lines.length > 140) return false;
    let index = 3;
    for (const section of ["Changed", "Deleted", "Added"]) {
        const rows = pending.rows.filter(r => (r.status === "CP" ? "Added" : r.status === "DE" ? "Deleted" : "Changed") === section);
        const privateRows = section === "Added" ? pending.privateRows : [];
        if (!rows.length && !privateRows.length) continue;
        const header = section === "Deleted" ? /^    Status +Size +Path *$/ : /^    Status +Size +Last Modified +Path *$/;
        if (lines[index++] !== section || !header.test(lines[index++] ?? "")) return false;
        const expected = [...rows.map(r => ({ ...r, label: `${r.status === "CO" ? "Checked-out (changed)" : r.status === "RP" ? "Replaced" : r.status === "DE" ? "Removed" : "Copied (new)"} (Merge from ${pending.mergeChangeset})` })), ...privateRows.map(r => ({ ...r, label: "Private" }))];
        const remaining = new Set(expected);
        for (let n = 0; n < expected.length; n++) {
            const row = lines[index++] ?? "";
            const matches = [...remaining].filter(r => {
                // Display cells are bounded and opaque, never resolution/identity
                // evidence. Directories have no size; deleted rows have no age.
                const size = r.isDirectory ? "" : "[0-9]{1,20}(?:\\.[0-9]{1,8})? (?:bytes|KB|MB)";
                const age = section === "Deleted" ? "" : "[^ \\r\\n\\x00-\\x1f\\x7f-\\x9f](?:[^ \\r\\n\\x00-\\x1f\\x7f-\\x9f]| (?! )){0,127}? {2,}";
                return new RegExp(`^    ${escape(r.label)} {2,}${size}${size ? " {2,}" : ""}${age}${escape(receiptRelativePath(cwd, r.path))} *$`).test(row);
            });
            if (matches.length !== 1) return false; remaining.delete(matches[0]);
        }
    }
    return index === lines.length;
}
