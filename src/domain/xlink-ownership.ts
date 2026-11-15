import { parseDiffXml, diffXmlChildren, diffXmlLeaf } from "./diff-base-xml";
import { receiptAbsolutePath, receiptJoinPath, receiptPathKey, receiptPathWithin, receiptRelativePath } from "./receipt-paths";
import { parseSwitchTarget, safeSwitchValue } from "./switch-contract";
import type { WorkspacePendingObservation, WorkspaceStandardObservation } from "./workspace-facts";
import type { WorkspaceMergeAttempt, WorkspaceMergeCapture } from "../execution/workspace-merge-command";

export const ownershipFields = "ClientPath,RepSpec,IsXlink,XlinkTarget,IsUnderXlink,UnderXlinkTarget,UnderXlinkPath,UnderXlinkWritable";
export type OwnershipRead = { attempt: WorkspaceMergeAttempt; capture: WorkspaceMergeCapture };
export type OwnedMergeRow = { path: string; status: string; isDirectory: boolean; changeset: string; repository: string; server: string; mount: string };
export type XlinkOwnership = { cwd: string; complete: boolean; root: { changeset: string; sourceChangeset: string; branch: string; sourceBranch: string; repository: string; server: string } | null; mount: { path: string; changeset: string; sourceChangeset: string; branch: string; sourceBranch: string; repository: string; server: string } | null; rows: OwnedMergeRow[]; reads: OwnershipRead[] };
export const emptyXlinkOwnership = (): XlinkOwnership => ({ cwd: "", complete: false, root: null, mount: null, rows: [], reads: [] });
const safe = (s: string) => safeSwitchValue(s) && !/[?\uFFFD]/u.test(s);
const decimal = /^(0|[1-9][0-9]{0,19})$/;
export const safeMount = (s: string) => safe(s) && s.startsWith("/") && s !== "/" && !s.includes("\\") && s.slice(1).split("/").every(p => !!p && p !== "." && p !== "..");
function invalid(): never { throw Error("Unsupported bounded Xlink ownership observation."); }
export function ownershipRepository(s: string) {
    const m = /^([^@]+)@([^@]+(?:@(?:cloud|unity))?)$/.exec(s);
    if (!m || !safe(m[1]) || !safe(m[2])) return invalid();
    return { repository: m[1], server: m[2] };
}
export function ownershipTarget(s: string) {
    const m = /^(0|[1-9][0-9]{0,19})@(.+)$/.exec(s);
    if (!m) return invalid();
    return { changeset: m[1], ...ownershipRepository(m[2]) };
}
export type FileOwnership = { path: string; repository: string; server: string; isXlink: boolean; under: boolean; writable: boolean; mount: string; target: string; xlinkTarget: string };
export function parseFileOwnership(text: string): FileOwnership[] {
    const root = parseDiffXml(Buffer.from(text), "FileInfos"), rows: FileOwnership[] = [];
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType !== 1) { if (node.nodeType !== 8 && node.nodeValue?.trim()) invalid(); continue; }
        if (node.nodeName !== "FileInfo" || rows.length >= 32) invalid();
        const fields = diffXmlChildren(node as Parameters<typeof diffXmlChildren>[0], new Set(ownershipFields.split(",")));
        const get = (key: string) => diffXmlLeaf(fields.get(key));
        const bool = (key: string) => { const v = get(key); if (!/^(true|false)$/.test(v)) return invalid(); return v === "true"; };
        const path = get("ClientPath"); if (!safe(path)) invalid();
        rows.push({ path, ...ownershipRepository(get("RepSpec")), isXlink: bool("IsXlink"), under: bool("IsUnderXlink"), writable: bool("UnderXlinkWritable"), mount: get("UnderXlinkPath"), target: get("UnderXlinkTarget"), xlinkTarget: get("XlinkTarget") });
    }
    if (!rows.length || new Set(rows.map(r => receiptPathKey(r.path))).size !== rows.length) invalid();
    return rows;
}
// Closed current-client ls metadata. Recursive inventories are bounded and all
// rows must belong to the one linked repository, never an inferred path owner.
export function parseMountTree(text: string, path: string) {
    const root = parseDiffXml(Buffer.from(text), "LsResults");
    const container = diffXmlChildren(root, new Set(["LsItems"])).get("LsItems"); if (!container) return invalid();
    const allowed = new Set(["Status", "Name", "CurrentPath", "WkPath", "Size", "FormattedSize", "Type", "Changeset", "Repository", "Owner", "Checkout", "BrId", "RevId", "ParentRevId", "ItemId", "RepId", "Server", "SymlinkTarget", "Hash", "HashAlgorithm", "Chmod", "Branch", "Guid", "ItemGuid", "Date"]);
    const rows: Array<{ path: string; name: string; type: string; changeset: string; branch: string; repository: string; server: string }> = [];
    for (const node of Array.from(container.childNodes)) {
        if (node.nodeType !== 1) { if (node.nodeType !== 8 && node.nodeValue?.trim()) invalid(); continue; }
        if (node.nodeName !== "LsItem" || rows.length >= 32) invalid();
        const fields = diffXmlChildren(node as Parameters<typeof diffXmlChildren>[0], allowed); for (const field of fields.values()) diffXmlLeaf(field);
        const get = (key: string) => diffXmlLeaf(fields.get(key));
        const spec = get("Repository"); if (!spec.startsWith("rep:") || get("SymlinkTarget") !== "") invalid();
        const owner = ownershipRepository(spec.slice(4));
        if (owner.server !== get("Server") || !decimal.test(get("Changeset")) || !parseSwitchTarget(get("Branch"))) invalid();
        rows.push({ path: get("CurrentPath"), name: get("Name"), type: get("Type"), changeset: get("Changeset"), branch: get("Branch"), ...owner });
    }
    const directory = rows.find(r => r.path === path && r.name === "." && r.type === "dir");
    if (!directory || rows.some(r => r.repository !== directory.repository || r.server !== directory.server || !["txt", "bin", "dir"].includes(r.type)) || new Set(rows.map(r => r.path)).size !== rows.length) return invalid();
    return directory;
}
export function validateXlinkOwnership(o: XlinkOwnership): boolean {
    if (Buffer.byteLength(JSON.stringify(o),"utf8") > 32768 || !safe(o.cwd) || !receiptAbsolutePath(o.cwd) || !o.complete || !o.root || !o.mount || !safeMount(o.mount.path) || o.rows.length < 2 || o.rows.length > 32 || o.reads.length !== 4) return false;
    if (o.reads.some(r => r.capture.stdoutBytes > 65536 || r.capture.stderrBytes > 16384 || r.capture.stdoutRetainedBytes !== r.capture.stdoutBytes || r.capture.stderrRetainedBytes !== r.capture.stderrBytes || !r.capture.complete || !r.capture.validUtf8 || r.capture.truncated || r.capture.stderrBytes || r.attempt.state !== "started" || r.attempt.terminal !== "observed" || r.attempt.exitCode !== 0 || r.attempt.aborted || r.attempt.timedOut) || o.reads.reduce((n, r) => n + r.capture.stdoutBytes + r.capture.stderrBytes, 0) > 131072) return false;
    for (const identity of [o.root, o.mount]) if (![identity.repository, identity.server, identity.branch, identity.sourceBranch].every(safe) || !decimal.test(identity.changeset) || !decimal.test(identity.sourceChangeset) || !parseSwitchTarget(identity.branch) || !parseSwitchTarget(identity.sourceBranch)) return false;
    if (o.root.repository === o.mount.repository || o.root.server !== o.mount.server || new Set(o.rows.map(r => receiptPathKey(r.path))).size !== o.rows.length) return false;
    return o.rows.every(r => { if (!safe(r.path) || !receiptPathWithin(o.cwd,r.path) || r.path.replaceAll("\\", "/").split("/").some(p=>p==="."||p==="..")) return false; const owner = r.mount === "/" ? o.root! : r.mount === o.mount!.path ? o.mount! : null; const inside = receiptPathWithin(receiptJoinPath(o.cwd,o.mount!.path),r.path); return owner !== null && (r.mount === "/" ? !inside : inside) && r.repository === owner.repository && r.server === owner.server && r.changeset === owner.sourceChangeset && !r.isDirectory && /^(RP|CO|CP)$/.test(r.status); }) && o.rows.some(r => r.mount === "/") && o.rows.some(r => r.mount === o.mount!.path);
}
export function correlateOwnedWorkspace(o: XlinkOwnership, pending: WorkspacePendingObservation, standard: WorkspaceStandardObservation): boolean {
    if (!validateXlinkOwnership(o) || receiptPathKey(o.cwd)!==receiptPathKey(pending.cwd) || !o.root || !o.mount || pending.rows.filter(r => r.mergeChangeset !== null).length !== o.rows.length || pending.changeset !== o.root.changeset || pending.repository !== o.root.repository || pending.server !== o.root.server || standard.branch?.branch !== o.root.branch || standard.links.length !== 2) return false;
    if (![o.root, o.mount].every(owner => standard.links.filter(l => l.repository === owner.repository && l.server === owner.server && l.changeset === owner.sourceChangeset && l.branch === owner.sourceBranch).length === 1)) return false;
    return o.rows.every(r => pending.rows.some(p => receiptPathKey(p.path) === receiptPathKey(r.path) && p.mergeChangeset === r.changeset && p.status === r.status && p.isDirectory === r.isDirectory));
}
export function sameOwnershipPins(a: XlinkOwnership, b: XlinkOwnership): boolean {
    if (!validateXlinkOwnership(a) || !validateXlinkOwnership(b)) return false;
    const pin = (o: XlinkOwnership) => ({ cwd: receiptPathKey(o.cwd), root: o.root, mount: o.mount, rows: [...o.rows].sort((x,y)=>receiptPathKey(x.path).localeCompare(receiptPathKey(y.path))) });
    return JSON.stringify(pin(a)) === JSON.stringify(pin(b));
}
export function correlateOwnedCheckin(events: ReadonlyArray<{ operation: string; path: string }>, o: XlinkOwnership, cwd: string, emissions: ReadonlyArray<{ mount: string; branch: string; repository: string; server: string }>): boolean {
    if (!validateXlinkOwnership(o) || emissions.length !== 1 || emissions[0].mount !== o.mount!.path || emissions[0].branch !== o.mount!.branch || emissions[0].repository !== o.mount!.repository || emissions[0].server !== o.mount!.server || new Set(events.map(e => receiptPathKey(e.path))).size !== events.length) return false;
    // Current CM reports linked effects at the mount, not as per-file events.
    // Preserve that distinction: require the exact observed mount CO and emitted
    // linked target identity, and exact item events for every root pending row.
    if (!events.some(e => e.operation === "CO" && receiptPathKey(e.path) === receiptPathKey(receiptJoinPath(cwd, o.mount!.path))) || !o.rows.filter(r => r.mount === "/").every(r => events.some(e => receiptPathKey(e.path) === receiptPathKey(r.path) && e.operation === r.status))) return false;
    return events.every(e => {
        if (o.rows.some(r => receiptPathKey(r.path) === receiptPathKey(e.path) && r.status === e.operation)) return true;
        if (e.operation !== "CO" || !receiptPathWithin(cwd, e.path) && receiptPathKey(cwd) !== receiptPathKey(e.path)) return false;
        const relative = "/" + receiptRelativePath(cwd, e.path).replaceAll("\\", "/");
        const owner = relative === o.mount!.path || relative.startsWith(o.mount!.path + "/") ? o.mount!.path : "/";
        return o.rows.some(r => r.mount === owner && receiptPathWithin(e.path, r.path));
    });
}
