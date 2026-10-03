import { resolveBranchCreationTarget, normalizeBranchSpecForComparison } from "../domain/branches";
import { emptyBranchCreateAttempt, safeBranchCreateText, parseBranchCreateParent, type BranchCreateRequest, type BranchCreateReceipt, type BranchCreateData, type BranchCreateError } from "../domain/branch-create-contract";
import { captureBranchCreateCommand } from "../execution/branch-create-command";
export { presentBranchCreateReceipt } from "../presentation/branch-create";
export { safeBranchCreateText } from "../domain/branch-create-contract";
export type { BranchCreateReceipt, BranchCreateAttempt, BranchCreateCapture } from "../domain/branch-create-contract";
class BranchCreateInputError extends Error {}
export function validateBranchCreateRequest(input: unknown): asserts input is BranchCreateRequest {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BranchCreateInputError("Branch creation input must be an object.");
    const r = input as Record<string, unknown>;
    const strings = ["branch", "parent", "changeset", "label", "comment", "commentsFile", "workdir"];
    if (Object.keys(r).some(k => ![...strings, "allowRootBranch"].includes(k)) || r.allowRootBranch !== undefined && typeof r.allowRootBranch !== "boolean") throw new BranchCreateInputError("Branch creation input contains unsupported options.");
    for (const key of strings) if (r[key] !== undefined && (typeof r[key] !== "string" || !safeBranchCreateText(r[key] as string))) throw new BranchCreateInputError("Branch creation strings must be bounded and free of control or malformed characters.");
    if (typeof r.branch !== "string" || !r.branch.trim()) throw new BranchCreateInputError("Branch must be non-empty.");
    if (r.changeset && r.label) throw new BranchCreateInputError("Provide either changeset or label, not both.");
    if (r.comment && r.commentsFile) throw new BranchCreateInputError("Provide either comment or commentsFile, not both.");
    if (r.comment !== undefined && !(r.comment as string).trim()) throw new BranchCreateInputError("Comment must be non-empty when provided.");
}
export async function assembleBranchCreateReceipt(input: unknown): Promise<BranchCreateReceipt> {
    const data: BranchCreateData = { requested: null, resolvedTarget: null, parentResolution: { basis: "not-required", observedBranch: null, repositoryVerification: "unverified" }, parentCommands: [], command: null, attempt: emptyBranchCreateAttempt(), capture: null, observedCreatedIdentity: null, repositoryVerification: "unverified", workspaceSwitch: "not-requested" };
    const completeness: BranchCreateReceipt["completeness"] = { capture: "unknown", projection: true };
    let stage: BranchCreateError["stage"] = "input";
    const finish = (outcome: BranchCreateReceipt["outcome"], code: BranchCreateError["code"] = "uncertain", message = "Branch creation evidence is unverified; do not retry automatically."): BranchCreateReceipt => ({ schemaVersion: 1, action: "branch-create", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, completeness, ok: outcome === "command-completed", outcome, data: { ...data, effect: outcome === "command-completed" ? "not-proven" : outcome === "uncertain" ? "uncertain" : "not-attempted" }, ...(outcome === "command-completed" ? {} : { error: { code, stage, message } }) }) as BranchCreateReceipt;
    try {
        validateBranchCreateRequest(input);
        const r = input;
        data.requested = { branch: r.branch, parent: r.parent ?? null, changeset: r.changeset ?? null, label: r.label ?? null, comment: r.comment ?? null, commentsFile: r.commentsFile ?? null, allowRootBranch: r.allowRootBranch ?? false };
        const relative = !normalizeBranchSpecForComparison(r.branch).startsWith("/");
        // These forms formerly discarded qualification. Never dispatch a different scope.
        if (relative && (r.branch.includes("@") || r.parent?.includes("@"))) return finish("unsupported", "ambiguous_qualifier", "Relative qualifier-bearing branch creation cannot resolve scope safely; provide a full hierarchical target.");
        stage = "source";
        if (process.platform !== "win32") return finish("unsupported", "unsupported_source", "Branch creation source is admitted only on Windows.");
        let parent = r.parent;
        if (relative && parent === undefined) {
            stage = "parent"; data.parentResolution.basis = "unresolved";
            for (const argv of [["status"], ["status", "--compact"]]) {
                const obs = await captureBranchCreateCommand(argv, r.workdir);
                data.parentCommands.push({ argv, attempt: obs.attempt, capture: obs.capture });
                completeness.capture = obs.capture.complete ? "complete" : "incomplete";
                if (!obs.capture.complete || obs.failed || obs.attempt.exitCode !== 0 || obs.capture.stderrBytes) return finish("failed", "parent_unresolved", "Current parent could not be observed; provide an explicit parent.");
                // Only standard status has admitted original loaded-branch fidelity.
                if (argv.length === 1) parent = parseBranchCreateParent(obs.stdout! ) ?? undefined;
                if (parent !== undefined) break;
            }
            if (parent === undefined) return finish("unsupported", "parent_unresolved", "A changeset's owning branch does not identify the loaded branch; provide an explicit parent.");
            data.parentResolution = { basis: "status", observedBranch: parent, repositoryVerification: "unverified" };
        } else if (relative) data.parentResolution.basis = "explicit";
        stage = "input";
        let target: string;
        try { target = resolveBranchCreationTarget(r.branch, parent, r.allowRootBranch); }
        catch {
            const root = normalizeBranchSpecForComparison(r.branch).startsWith("/") && normalizeBranchSpecForComparison(r.branch).split("/").filter(Boolean).length === 1;
            throw new BranchCreateInputError(root ? "Refusing to create top-level branch. Provide a hierarchical target or allowRootBranch=true for intentional root creation." : "Parent branch must be a non-root hierarchical branch path.");
        }
        if (!safeBranchCreateText(target)) throw new BranchCreateInputError("Resolved branch exceeds the identity bound.");
        const argv = ["branch", "create", target];
        if (r.changeset) argv.push(`--changeset=${r.changeset}`);
        if (r.label) argv.push(`--label=${r.label}`);
        if (r.comment) argv.push(`-c=${r.comment}`);
        if (r.commentsFile) argv.push(`-commentsfile=${r.commentsFile}`);
        if (argv.length > 8 || argv.some(s => s.length > 8192) || Buffer.byteLength(JSON.stringify(argv), "utf8") > 65536) throw new BranchCreateInputError("Branch creation argv exceeds the aggregate bound.");
        data.resolvedTarget = target; data.command = argv;
        stage = "create";
        const obs = await captureBranchCreateCommand(argv, r.workdir);
        data.attempt = obs.attempt; data.capture = obs.capture;
        completeness.capture = obs.capture.complete ? "complete" : "incomplete";
        if (["not-attempted", "not-started"].includes(obs.attempt.state)) return finish("failed", obs.attempt.aborted ? "aborted" : "launch_failed");
        if (!obs.failed && obs.capture.complete && obs.attempt.state === "started" && obs.attempt.terminal === "observed" && obs.attempt.exitCode === 0 && !obs.attempt.aborted && !obs.attempt.timedOut && !obs.capture.stderrBytes) return finish("command-completed");
        return finish("uncertain");
    } catch (error) {
        if (stage === "create") { if (data.attempt.state === "not-attempted") data.attempt.state = "unknown"; return finish("uncertain", "producer_failed"); }
        return finish("failed", stage === "input" ? "invalid_request" : "parent_unresolved", error instanceof BranchCreateInputError ? error.message : "Branch target or current parent could not be resolved safely.");
    }
}
