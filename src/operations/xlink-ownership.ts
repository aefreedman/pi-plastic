import { realpath } from "node:fs/promises";
import { captureWorkspaceMergeCommand } from "../execution/workspace-merge-command";
import { emptyXlinkOwnership, ownershipFields, parseFileOwnership, ownershipTarget, parseMountTree, safeMount, validateXlinkOwnership, type XlinkOwnership } from "../domain/xlink-ownership";
import { receiptJoinPath, receiptPathKey, receiptPathWithin } from "../domain/receipt-paths";
import type { WorkspacePendingObservation, WorkspaceStandardObservation } from "../domain/workspace-observation";
export { validateXlinkOwnership, correlateOwnedCheckin, sameOwnershipPins } from "../domain/xlink-ownership";
export async function observeXlinkOwnership(pending: WorkspacePendingObservation, standard: WorkspaceStandardObservation): Promise<XlinkOwnership> {
    const result = emptyXlinkOwnership(); result.cwd = pending.cwd;
    const fail = () => { throw Error("Ownership observation unavailable or inconsistent."); };
    try {
        if (pending.issues.length || standard.issues.length || standard.links.length !== 2 || pending.rows.length < 2 || pending.rows.length > 32 || !pending.changeset || !pending.repository || !pending.server || !standard.branch || pending.rows.some(r => r.mergeChangeset === null && r.status !== "PR" || r.isDirectory || !/^(RP|CO|CP)$/.test(r.status))) return result;
        if (receiptPathKey(await realpath(pending.cwd)) !== receiptPathKey(pending.cwd)) return result;
        for (const row of pending.rows) if (!receiptPathWithin(pending.cwd, row.path) || receiptPathKey(await realpath(row.path)) !== receiptPathKey(row.path)) return result;
        const rootLink = standard.links.filter(l => l.repository === pending.repository && l.server === pending.server);
        const linkedLink = standard.links.filter(l => l.repository !== pending.repository && l.server === pending.server && l.repository !== null);
        if (rootLink.length !== 1 || linkedLink.length !== 1) return result;
        const read = async (argv: string[]) => {
            if (result.reads.length >= 4 || Buffer.byteLength(JSON.stringify(argv), "utf8") > 32768) return fail();
            const o = await captureWorkspaceMergeCommand(argv, pending.cwd);
            result.reads.push({ attempt: o.attempt, capture: o.capture });
            if (o.failed || !o.capture.complete || o.attempt.exitCode !== 0 || o.stderr !== "" || o.stdout === null || result.reads.reduce((n, r) => n + r.capture.stdoutBytes + r.capture.stderrBytes, 0) > 131072) return fail();
            return o.stdout;
        };
        const files = parseFileOwnership(await read(["fileinfo", ...pending.rows.map(r => r.path), `--fields=${ownershipFields}`, "--xml", "--encoding=utf-8"]));
        if (files.length !== pending.rows.length || files.some(f => !pending.rows.some(r => receiptPathKey(r.path) === receiptPathKey(f.path)) || f.isXlink)) return result;
        const linked = files.filter(f => f.under);
        if (!linked.length || linked.some(f => !f.writable || !safeMount(f.mount) || f.xlinkTarget !== "" || f.repository !== linkedLink[0].repository || f.server !== linkedLink[0].server || f.mount !== linked[0].mount || f.target !== linked[0].target)) return result;
        const mountPath = linked[0].mount, mount = receiptJoinPath(pending.cwd, mountPath);
        if (!receiptPathWithin(pending.cwd, mount) || receiptPathKey(await realpath(mount)) !== receiptPathKey(mount)) return result;
        const mountFiles = parseFileOwnership(await read(["fileinfo", mount, `--fields=${ownershipFields}`, "--xml", "--encoding=utf-8"]));
        const fact = mountFiles[0], base = ownershipTarget(linked[0].target);
        if (mountFiles.length !== 1 || receiptPathKey(fact.path) !== receiptPathKey(mount) || !fact.isXlink || fact.under || fact.mount !== "" || fact.target !== "" || fact.xlinkTarget !== linked[0].target || fact.repository !== base.repository || fact.server !== base.server) return result;
        for (const file of files) {
            if (file.under ? !receiptPathWithin(mount, file.path) : file.repository !== pending.repository || file.server !== pending.server || file.writable || file.mount !== "" || file.target !== "" || file.xlinkTarget !== "" || receiptPathWithin(mount, file.path)) return result;
        }
        const tree = async (changeset: string) => parseMountTree(await read(["ls", mountPath, `--tree=cs:${changeset}@${pending.repository}@${pending.server}`, "-R", "--xml", "--encoding=utf-8"]), mountPath);
        const target = await tree(pending.changeset), source = await tree(rootLink[0].changeset);
        if (target.changeset !== base.changeset || target.repository !== base.repository || target.server !== base.server || source.repository !== base.repository || source.server !== base.server || source.changeset !== linkedLink[0].changeset || source.branch !== linkedLink[0].branch) return result;
        result.root = { changeset: pending.changeset, sourceChangeset: rootLink[0].changeset, repository: pending.repository, server: pending.server, branch: standard.branch.branch, sourceBranch: rootLink[0].branch };
        result.mount = { path: mountPath, changeset: target.changeset, sourceChangeset: source.changeset, branch: target.branch, sourceBranch: source.branch, repository: source.repository, server: source.server };
        result.rows = pending.rows.map(row => { const file = files.find(f => receiptPathKey(f.path) === receiptPathKey(row.path))!; return { path: row.path, status: row.status, isDirectory: row.isDirectory, changeset: row.mergeChangeset!, repository: file.repository, server: file.server, mount: file.under ? mountPath : "/" }; });
        result.complete = true;
        if (!validateXlinkOwnership(result) || Buffer.byteLength(JSON.stringify(result),"utf8") > 32768) { result.complete = false; result.root = null; result.mount = null; result.rows = []; }
        return result;
    } catch {
        // A failed observation is explicit negative evidence, never a fallback
        // owner guess or permission to retry a mutation.
        result.complete = false;
        return result;
    }
}

export type { WorkspaceAssessment } from "../domain/workspace-observation";
