import { win32 } from "node:path";
import { copiedPathKey, type CopiedPending } from "./copied-merge";
import { parseSwitchLoadedBranch, parseSwitchTarget, safeSwitchValue } from "./switch-contract";

const decimal = /^(0|[1-9][0-9]{0,19})$/;
const positive = /^[1-9][0-9]{0,19}$/;
const safe = (s: string) => safeSwitchValue(s) && !/[?\uFFFD]/u.test(s);
const component = (part: string) => part !== "" && part !== "." && part !== ".." && part === part.trim() && !part.endsWith(".") && !/[\\/:*"<>|]/.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part);
const absolute = (s: string) => safe(s) && /^[A-Za-z]:\\/.test(s) && s.slice(3).split("\\").every(component);
const relative = (s: string) => safe(s) && s.startsWith("/") && s.slice(1).split("/").every(component);
export type MergedDeclaration = { path: string; actionPath: string; status: "CP" | "RP" | "CO" };
export type MergedPending = CopiedPending & { rows: Array<{ path: string; status: "CP" | "RP" | "CO" }> };
/** A declaration/action pair is only a candidate, never resolution proof. Numeric
 * FILE fields are bounded producer tokens, not asserted revision identities. */
export function parseMergedApply(text: string, token: string): MergedDeclaration[] | null {
    if (Buffer.byteLength(text, "utf8") > 65536) return null;
    const start = token + "S__", end = token + "E__", field = token + "F__";
    const declarations: Array<{ path: string; status: MergedDeclaration["status"] }> = [], actions: Array<{ path: string; status: "copy" | "merge" }> = [];
    let rest = text, count = 0;
    while (rest.trim() !== "") {
        if (++count > 256 || !rest.startsWith(start)) return null;
        const e = rest.indexOf(end, start.length); if (e < 0) return null;
        const f = rest.slice(start.length, e).split(field); rest = rest.slice(e + end.length).replace(/^\r?\n/, "");
        if (f.length === 2 && /^(DO_COPIED|DO_MERGE)$/.test(f[0]) && absolute(f[1])) actions.push({ path: f[1], status: f[0] === "DO_MERGE" ? "merge" : "copy" });
        else if (!actions.length && f.length === 3 && f[0] === "APPLY" && f[1] === "ADD" && relative(f[2])) declarations.push({ path: f[2], status: "CP" });
        else if (!actions.length && ((f[0] === "FILE_SRC" && f.length === 5) || (f[0] === "FILE_CONFLICT" && f.length === 6)) && relative(f[1]) && f.slice(2).every(v => decimal.test(v))) declarations.push({ path: f[1], status: f[0] === "FILE_SRC" ? "RP" : "CO" });
        else return null;
    }
    if (!declarations.length || declarations.length !== actions.length || new Set(declarations.map(d => d.path.toLowerCase())).size !== declarations.length || new Set(actions.map(a => copiedPathKey(a.path))).size !== actions.length) return null;
    // Only the three captured declaration combinations are sourced here. Copied-only
    // cardinalities continue through the existing independent route.
    if (!["RP", "CO", "CO,CP,RP"].includes(declarations.map(d => d.status).sort().join(","))) return null;
    // Absolute workspace scope is established by the pending observation below.
    const result: MergedDeclaration[] = [];
    for (const d of declarations) {
        const matches = actions.filter(a => a.path.toLowerCase().endsWith(d.path.replaceAll("/", "\\").toLowerCase()) && a.status === (d.status === "CO" ? "merge" : "copy"));
        if (matches.length !== 1) return null;
        result.push({ ...d, actionPath: matches[0].path });
    }
    return new Set(result.map(d => copiedPathKey(d.actionPath))).size === actions.length ? result : null;
}
export function parseMergedPending(text: string, cwd: string): MergedPending | null {
    const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    if (!absolute(cwd) || lines.length < 2 || lines.length > 129 || Buffer.byteLength(text, "utf8") > 65536) return null;
    const h = lines[0].split("\x1f");
    if (h.length !== 4 || h[0] !== "STATUS" || !decimal.test(h[1]) || !h.slice(2).every(safe)) return null;
    const rows: MergedPending["rows"] = []; let mergeChangeset = "";
    for (const line of lines.slice(1)) {
        const f = line.split("\x1f"), m = /^Merge from ([1-9][0-9]{0,19})$/.exec(f[4] ?? "");
        if (f.length !== 5 || !/^(CO|RP|CP)$/.test(f[0]) || !absolute(f[1]) || f[2] !== "False" || !(f[0] === "CO" ? f[3] === "-1" : positive.test(f[3])) || !m) return null;
        const rel = win32.relative(cwd, f[1]);
        if (!rel || rel.startsWith("..") || win32.isAbsolute(rel) || rows.some(r => copiedPathKey(r.path) === copiedPathKey(f[1])) || mergeChangeset && mergeChangeset !== m[1]) return null;
        mergeChangeset = m[1]; rows.push({ path: f[1], status: f[0] as MergedDeclaration["status"] });
    }
    if (!["CP", "RP", "CO", "CO,CP,RP"].includes(rows.map(r => r.status).sort().join(","))) return null;
    return { changeset: h[1], repository: h[2], server: h[3], mergeChangeset, paths: rows.map(r => r.path), rows };
}
export function correlateMergedApply(declarations: MergedDeclaration[], pending: MergedPending, cwd: string): boolean {
    return declarations.length === pending.rows.length && declarations.every(d => {
        const key = copiedPathKey(win32.join(cwd, d.path));
        return copiedPathKey(d.actionPath) === key && pending.rows.some(r => copiedPathKey(r.path) === key && r.status === d.status);
    });
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function admitMergedStandardStatus(text: string, pending: MergedPending, source: string, cwd: string): boolean {
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== ""), branch = parseSwitchLoadedBranch(text), requested = parseSwitchTarget(source);
    if (!branch || !requested || branch.repository !== pending.repository || branch.server !== pending.server || !lines[0].endsWith(`(cs:${pending.changeset} - head)`) || lines[1] !== "Pending merge links") return false;
    const link = /^    Merge from cs:([1-9][0-9]{0,19}) at (.+)$/.exec(lines[2] ?? ""), linked = link && parseSwitchTarget(link[2]);
    if (!link || !linked || link[1] !== pending.mergeChangeset || linked.branch !== requested.branch || linked.repository !== pending.repository || linked.server !== pending.server || requested.repository !== null && (requested.repository !== linked.repository || requested.server !== linked.server)) return false;
    let index = 3;
    for (const section of ["Changed", "Added"]) {
        const rows = pending.rows.filter(r => (r.status === "CP") === (section === "Added")); if (!rows.length) continue;
        if (lines[index++] !== section || !/^    Status +Size +Last Modified +Path *$/.test(lines[index++] ?? "")) return false;
        const remaining = new Set(rows);
        for (let n = 0; n < rows.length; n++) {
            const row = lines[index++] ?? "";
            const matches = [...remaining].filter(r => {
                const label = r.status === "CO" ? "Checked-out (changed)" : r.status === "RP" ? "Replaced" : "Copied (new)";
                return new RegExp(`^    ${escape(label)} \\(Merge from ${pending.mergeChangeset}\\) {2,}[0-9]+ bytes {2,}[^\\r\\n\\x00-\\x1f\\x7f-\\x9f]{1,128}? {2,}${escape(win32.relative(cwd, r.path))} *$`).test(row);
            });
            if (matches.length !== 1) return false; remaining.delete(matches[0]);
        }
    }
    return index === lines.length;
}
