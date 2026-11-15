import { resolve } from "node:path";
import { nativeCommandCompleted, safeNativeText } from "../domain/native-mutation";
import { checkinSafeComment } from "../domain/checkin-contract";
import { parseSwitchLoadedBranch, parseSwitchTarget, compareSwitchTarget, switchPendingArgv } from "../domain/switch-contract";
import { buildCloseoutParentArgv, closeoutCaptures, closeoutChildEffect, type CloseoutData, type CloseoutReceipt, type CloseoutRequest, type CloseoutRead, type CloseoutStageName } from "../domain/closeout-contract";
import { emptyNativeData, runNativeMutation } from "./native-mutation";
import { assembleWorkspaceMergeReceipt } from "./workspace-merge-receipt";
import { assembleCheckinReceipt } from "./checkin-receipt";
export { presentCloseoutReceipt } from "../presentation/closeout-results";
export { buildCloseoutParentArgv, CLOSEOUT_STAGE_NAMES, CLOSEOUT_DTO_BYTES, closeoutCaptures, closeoutChildEffect } from "../domain/closeout-contract";
export type { CloseoutReceipt, CloseoutStage, CloseoutRead } from "../domain/closeout-contract";
export async function assembleCloseoutReceipt(input: unknown): Promise<CloseoutReceipt> {
    const data: CloseoutData = { requested: null, workingDirectory: null, sourceBranch: null, targetBranch: null, plan: ["discover unresolved branches", "require clean initial workspace and merge state", "switch target if needed", "update target if requested", "merge once", "checkin once"], stages: [], createdChangeset: null, linkedChangesets: [], stoppedAt: null, effect: "not-attempted" };
    const finish = (code?: string, message = "Closeout stopped; inspect earlier effects before any new operation.", blocked = false): CloseoutReceipt => {
        const effects = data.stages.map(closeoutChildEffect);
        data.effect = effects.includes("uncertain") ? "uncertain" : effects.includes("command-completed") ? "command-completed" : "not-attempted";
        const captures = closeoutCaptures(data.stages);
        const header = { schemaVersion: 2 as const, action: "merge-to-branch" as const, provenance: { source: "plastic" as const, producer: "@aefree/pi-plastic" as const, contentTrust: "external" as const }, completeness: { capture: !captures.length ? "unknown" as const : captures.every(c => c.complete) ? "complete" as const : "incomplete" as const, projection: captures.every(c => !c.truncated) }, data };
        return code ? { ...header, ok: false, outcome: data.effect === "not-attempted" ? blocked ? "blocked" : "failed" : "uncertain", error: { code, stage: data.stoppedAt ?? "input", message } } : { ...header, ok: true, outcome: data.requested?.preflight ? "preflight" : "completed" };
    };
    if (!input || typeof input !== "object" || Array.isArray(input)) return finish("invalid_request");
    const r = { ...input } as CloseoutRequest;
    if (Object.keys(r).some(k => !["source", "target", "cardRef", "message", "strategy", "updateTarget", "includePrivate", "preflight", "format", "workdir"].includes(k)) || [r.source, r.target].some(s => s !== undefined && !parseSwitchTarget(s)) || r.message !== undefined && !checkinSafeComment(r.message) || [r.cardRef, r.workdir].some(s => s !== undefined && !safeNativeText(s)) || r.strategy !== undefined && !["auto", "source", "destination"].includes(r.strategy) || r.format !== undefined && !["text", "json"].includes(r.format) || [r.updateTarget, r.includePrivate, r.preflight].some(v => v !== undefined && typeof v !== "boolean") || Buffer.byteLength(JSON.stringify(r), "utf8") > 24576) return finish("invalid_request");
    data.requested = r; data.workingDirectory = resolve(r.workdir ?? process.cwd()); data.sourceBranch = r.source ?? null; data.targetBranch = r.target ?? null;
    if (r.preflight) return finish();
    const read = async (name: CloseoutStageName, command: string[]) => {
        data.stoppedAt = name;
        const result: CloseoutRead = { ...emptyNativeData(), command, workingDirectory: data.workingDirectory, branch: null };
        data.stages.push({ name, kind: "read", result }); await runNativeMutation(result);
        if (nativeCommandCompleted(result) && !result.capture?.truncated && result.commandOutput?.stdout !== null) result.branch = parseSwitchLoadedBranch(result.commandOutput!.stdout!);
        return result;
    };
    const readable = (r: CloseoutRead) => r.commandCompleted && !r.capture?.truncated && r.commandOutput?.stdout !== null;
    const initial = await read("loaded-before", ["status"]);
    if (!readable(initial) || !initial.branch) return finish("observation_failed", "Loaded branch observation is unavailable.");
    if (!data.sourceBranch) data.sourceBranch = initial.branch.branch;
    if (!data.targetBranch) {
        const source = parseSwitchTarget(data.sourceBranch)!;
        const parent = await read("parent", buildCloseoutParentArgv(data.sourceBranch));
        const rows = parent.commandOutput?.stdout?.trimEnd().split(/\r?\n/), fields = rows?.[0]?.split("|");
        if (!readable(parent) || rows?.length !== 1 || fields?.length !== 2 || fields[0] !== source.branch || fields[1] !== source.branch.slice(0, source.branch.lastIndexOf("/")) || !parseSwitchTarget(fields[1])) return finish("observation_failed", "Source parent is missing or ambiguous; pass an explicit target.");
        data.targetBranch = source.repository === null ? fields[1] : `${fields[1]}@${source.repository}@${source.server}`;
    }
    if (parseSwitchTarget(data.sourceBranch)!.branch === parseSwitchTarget(data.targetBranch)!.branch) return finish("invalid_request", "Source and target branches must differ.");
    const message = r.message?.trim() ? r.message : `Merge ${data.sourceBranch} into ${data.targetBranch}${r.cardRef?.trim() ? "\n\n" + r.cardRef.trim() : ""}`;
    if (!checkinSafeComment(message)) return finish("invalid_request", "Derived comment exceeds input bounds; supply a comment.");
    const pending = await read("pending-before", [...switchPendingArgv]);
    const lines = pending.commandOutput?.stdout?.trimEnd().split(/\r?\n/) ?? [], h = lines[0]?.split("\x1f");
    // Automatic checkin must not include preexisting work. Any pending record
    // or non-header status is dirty, regardless of its status code or owner.
    if (!readable(pending) || h?.length !== 4 || h[0] !== "STATUS" || !/^[0-9]+$/.test(h[1]) || !h[2] || !h[3]) return finish("observation_failed", "Complete initial pending inventory is unavailable.");
    if (lines.length !== 1 || initial.commandOutput!.stdout!.split(/\r?\n/).slice(1).some(line => line.trim())) return finish("dirty_workspace", "Compound closeout requires a clean initial workspace and no pending merge state; use standalone operations for existing work.", true);
    if (compareSwitchTarget(initial.branch, data.targetBranch) === "unverified") {
        data.stoppedAt = "switch"; const result = { ...emptyNativeData(), command: ["switch", "--silent", "--noinput", data.targetBranch], workingDirectory: data.workingDirectory };
        data.stages.push({ name: "switch", kind: "command", result }); await runNativeMutation(result);
        if (!result.commandCompleted) return finish("child_failed");
    }
    const target = await read("loaded-target", ["status"]);
    if (!readable(target) || !target.branch || compareSwitchTarget(target.branch, data.targetBranch) === "unverified") return finish("target_unverified");
    if (r.updateTarget !== false) {
        data.stoppedAt = "update"; const result = { ...emptyNativeData(), command: ["update", "--dontmerge", "--noinput"], workingDirectory: data.workingDirectory };
        data.stages.push({ name: "update", kind: "command", result }); await runNativeMutation(result);
        if (!result.commandCompleted) return finish("child_failed");
        const loaded = await read("loaded-before-merge", ["status"]);
        if (!readable(loaded) || !loaded.branch || compareSwitchTarget(loaded.branch, data.targetBranch) === "unverified") return finish("target_unverified");
    }
    data.stoppedAt = "merge";
    const merged = await assembleWorkspaceMergeReceipt("merge", { source: data.sourceBranch, strategy: r.strategy ?? "auto", workdir: data.workingDirectory });
    data.stages.push({ name: "merge", kind: "merge", result: merged });
    if (!merged.ok) return finish("child_failed");
    data.stoppedAt = "checkin";
    const checked = await assembleCheckinReceipt({ message, includeAll: true, includePrivate: r.includePrivate ?? false, workdir: data.workingDirectory });
    data.stages.push({ name: "checkin", kind: "checkin", result: checked }); data.createdChangeset = checked.data.createdChangeset; data.linkedChangesets = checked.data.linkedChangesets;
    if (!checked.ok) return finish("child_failed");
    // Final observation is informational, not a second native admission policy.
    await read("loaded-final", ["status", "--header"]); data.stoppedAt = null;
    return finish();
}
