import { win32 } from "node:path";
import { parseSwitchLoadedBranch, parseSwitchTarget, safeSwitchValue } from "./switch-contract";

/** Observed Windows CM copied-add profile only. No generic pending/parser migration. */
export const copiedPendingArgv = ["status", "--machinereadable", "--includeRevId", "--fieldseparator=\x1f"];
const positive = /^[1-9][0-9]{0,19}$/;
const qualifiedPath = (p: string) => /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/.test(p);
export const copiedPathKey = (path: string) => win32.normalize(path).toLowerCase();
export type CopiedPending = { changeset: string; repository: string; server: string; mergeChangeset: string; paths: string[] };
export function parseCopiedPending(text: string, cwd: string): CopiedPending | null {
    const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    if (lines.length < 2 || lines.length > 129 || Buffer.byteLength(text, "utf8") > 65536 || !qualifiedPath(cwd)) return null;
    const h = lines[0].split("\x1f");
    if (h.length !== 4 || h[0] !== "STATUS" || !/^(0|[1-9][0-9]{0,19})$/.test(h[1]) || !h.slice(2).every(v => safeSwitchValue(v) && !/[?\uFFFD]/u.test(v))) return null;
    const paths: string[] = []; let mergeChangeset = "";
    for (const line of lines.slice(1)) {
        const f = line.split("\x1f"), m = /^Merge from ([1-9][0-9]{0,19})$/.exec(f[4] ?? "");
        if (f.length !== 5 || f[0] !== "CP" || !safeSwitchValue(f[1]) || /[?\uFFFD]/u.test(f[1]) || !qualifiedPath(f[1]) || f[2] !== "False" || !positive.test(f[3]) || !m) return null;
        const relative = win32.relative(cwd, f[1]);
        if (!relative || relative === ".." || relative.startsWith("..\\") || win32.isAbsolute(relative) || paths.some(p => copiedPathKey(p) === copiedPathKey(f[1]))) return null;
        if (mergeChangeset && mergeChangeset !== m[1]) return null;
        mergeChangeset = m[1]; paths.push(f[1]);
    }
    return { changeset: h[1], repository: h[2], server: h[3], mergeChangeset, paths };
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Full status is checked for *only* the sourced link/Added/copied rows. Volatile
 * size/time columns are opaque display, never facts or identities. Unknown sections
 * (including in-progress/conflict hints), duplicate paths/links and mixed copies fail. */
export function admitCopiedStandardStatus(text: string, pending: CopiedPending, source: string, cwd: string): boolean {
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== ""), branch = parseSwitchLoadedBranch(text), requested = parseSwitchTarget(source);
    if (!branch || !requested || branch.repository !== pending.repository || branch.server !== pending.server || !lines[0].endsWith(`(cs:${pending.changeset} - head)`) || lines.length !== pending.paths.length + 5 || lines[1] !== "Pending merge links" || lines[3] !== "Added" || !/^    Status +Size +Last Modified +Path *$/.test(lines[4])) return false;
    const link = /^    Merge from cs:([1-9][0-9]{0,19}) at (.+)$/.exec(lines[2]), linked = link && parseSwitchTarget(link[2]);
    if (!link || link[1] !== pending.mergeChangeset || !linked || linked.branch !== requested.branch || linked.repository !== pending.repository || linked.server !== pending.server || requested.repository !== null && (requested.repository !== linked.repository || requested.server !== linked.server)) return false;
    const remaining = new Set(pending.paths.map(p => win32.relative(cwd, p)));
    for (const row of lines.slice(5)) {
        const candidates = [...remaining].filter(path => new RegExp(`^    Copied \\(new\\) \\(Merge from ${pending.mergeChangeset}\\) {2,}[0-9]+ bytes {2,}[^\\r\\n\\x00-\\x1f\\x7f]{1,128}? {2,}${escape(path)} *$`).test(row));
        if (candidates.length !== 1) return false;
        remaining.delete(candidates[0]);
    }
    return remaining.size === 0;
}
