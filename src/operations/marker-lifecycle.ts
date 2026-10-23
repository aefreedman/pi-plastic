import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { tool } from "../tool-definition";
import { captureWorkspaceMergeCommand } from "../execution/workspace-merge-command";
import { markerInspectionFromObservation, markerReceipt, safeMarkerText, type MarkerAction, type MarkerInspection, type MarkerReceipt, type MarkerRequest } from "../domain/marker-lifecycle";
export { classifyMarkerInspection, emptyMarkerInspection, markerReceipt, safeMarkerText } from "../domain/marker-lifecycle";
export type { MarkerAction, MarkerInspection, MarkerReceipt } from "../domain/marker-lifecycle";
export type { MarkerGate } from "../domain/marker-gate";

export async function inspectConflictMarkers(workdir: string): Promise<MarkerInspection> {
    if (!safeMarkerText(workdir)) throw new Error("Invalid marker inspection working directory.");
    return markerInspectionFromObservation(await captureWorkspaceMergeCommand(["merge", "--list-conflict-markers"], workdir));
}
const contained = (root: string, file: string) => {
    const relative = path.relative(root, file);
    return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};
export function validateMarkerRequestShape(action: MarkerAction, input: unknown): asserts input is Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Expected object.");
    const r = input as Record<string, unknown>;
    const mark = action === "merge-mark-resolved";
    if (Object.keys(r).some(k => !(mark ? ["workdir", "format", "paths", "acknowledgeIntentionalMarkers", "preflight"] : ["workdir", "format"]).includes(k))) throw Error("Unknown argument.");
    if (r.workdir !== undefined && !safeMarkerText(r.workdir) || r.format !== undefined && r.format !== "text" && r.format !== "json") throw Error("Invalid arguments.");
    if (mark && (r.acknowledgeIntentionalMarkers !== true || r.preflight !== undefined && typeof r.preflight !== "boolean" || !Array.isArray(r.paths) || r.paths.length < 1 || r.paths.length > 64 || r.paths.some(p => !safeMarkerText(p) || /^[-]/u.test(p) || /[*?\[\]]/u.test(p)) || Buffer.byteLength(JSON.stringify(r.paths), "utf8") > 32768)) throw Error("Explicit exact-file paths and acknowledgement required.");
}
export async function assembleMarkerLifecycleReceipt(action: MarkerAction, input: unknown): Promise<MarkerReceipt> {
    // Snapshot caller-owned data before any asynchronous filesystem observation.
    let requested: MarkerRequest;
    let command: string[];
    try {
        validateMarkerRequestShape(action, input);
        const mark = action === "merge-mark-resolved";
        const snapshot = { workdir: input.workdir as string | undefined, format: (input.format ?? "text") as "text" | "json", paths: mark ? [...input.paths as string[]] : [], acknowledgeIntentionalMarkers: mark, preflight: mark && input.preflight === true };
        const root = await realpath(path.resolve(snapshot.workdir ?? process.cwd()));
        if (!safeMarkerText(root) || !(await stat(root)).isDirectory()) throw Error("Invalid scope.");
        const paths: string[] = [];
        for (const operand of snapshot.paths) {
            // Reject drive-relative / alternate-stream selectors and foreign path syntax.
            if (process.platform === "win32" ? /:/u.test(operand.replace(/^[A-Za-z]:[\\/]/u, "")) : /[\\:]/u.test(operand)) throw Error("Ambiguous file path.");
            const absolute = path.resolve(root, operand);
            if (!contained(root, absolute)) throw Error("Path outside scope.");
            const physical = await realpath(absolute);
            if (!contained(root, physical) || !safeMarkerText(physical) || /[*?\[\]]/u.test(physical) || !(await stat(physical)).isFile()) throw Error("Not a contained regular file.");
            // Dispatch the physical, absolute file operand: never shell/glob/option text.
            if (paths.includes(physical)) throw Error("Duplicate file path.");
            paths.push(physical);
        }
        requested = { ...snapshot, workdir: root, paths };
        command = mark ? ["merge", "--mark-resolved", ...paths] : ["merge", "--list-conflict-markers"];
        if (Buffer.byteLength(JSON.stringify(command), "utf8") > 65536) throw Error("Command exceeds bound.");
    } catch {
        return markerReceipt(action, null, null, undefined, true);
    }
    if (requested.preflight) return markerReceipt(action, requested, command);
    try {
        const inspection = action === "merge-list-conflict-markers" ? await inspectConflictMarkers(requested.workdir) : markerInspectionFromObservation(await captureWorkspaceMergeCommand(command, requested.workdir));
        // A successful mutation is command completion, never a marker inspection.
        if (action === "merge-mark-resolved") inspection.state = "unknown";
        return markerReceipt(action, requested, command, inspection);
    } catch {
        const receipt = markerReceipt(action, requested, command);
        receipt.data.inspection.attempt.state = "unknown";
        return markerReceipt(action, requested, command, receipt.data.inspection);
    }
}
export function presentMarkerLifecycleReceipt(r: MarkerReceipt): string {
    if (r.data.requested?.format === "json") return JSON.stringify(r);
    return `${r.action}: ${r.outcome}. Marker state: ${r.data.inspection.state}. Command completion is not checkin readiness; binary, directory and recursive conflicts remain unverified. ${r.error?.message ?? ""}`.trim();
}
const common = () => ({ workdir: tool.schema.string().optional(), format: tool.schema.enum(["text", "json"]).optional() });
async function execute(action: MarkerAction, args: unknown) {
    const receipt = await assembleMarkerLifecycleReceipt(action, args);
    const text = presentMarkerLifecycleReceipt(receipt);
    if (!receipt.ok) throw Error(text);
    return text;
}
export const mergeListConflictMarkers = tool({
    description: "Read native conflict-marker evidence once. Empty complete output proves marker absence only, never all-conflict readiness. Unrecognized listing records remain unknown.",
    args: common(), execute: args => execute("merge-list-conflict-markers", args),
});
export const mergeMarkResolved = tool({
    description: "Bypass marker content checks for exact intentional-marker files only, with explicit acknowledgement. One bounded command; no automatic followup, retry or readiness claim.",
    args: { ...common(), paths: tool.schema.array(tool.schema.string()).min(1).max(64), acknowledgeIntentionalMarkers: tool.schema.enum([true]), preflight: tool.schema.boolean().optional() },
    execute: args => execute("merge-mark-resolved", args),
});
