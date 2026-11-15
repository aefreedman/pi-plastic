import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { nativeHeader, nativeOutcome, safeNativeText } from "../domain/native-mutation";
import { buildWorkspaceMergeArgv, type MergeAction, type MergeRequest, type WorkspaceMergeReceipt } from "../domain/workspace-merge-contract";
import { emptyNativeData, runNativeMutation } from "./native-mutation";
export { buildWorkspaceMergeArgv, safeMergeText } from "../domain/workspace-merge-contract";
export type { MergeAction, WorkspaceMergeReceipt } from "../domain/workspace-merge-contract";
export { presentWorkspaceMergeReceipt } from "../presentation/workspace-merge-results";
export async function assembleWorkspaceMergeReceipt(action: MergeAction, input: unknown): Promise<WorkspaceMergeReceipt> {
    const data: WorkspaceMergeReceipt["data"] = { ...emptyNativeData(), requested: null };
    const finish = (invalid = false): WorkspaceMergeReceipt => ({ ...nativeHeader(data), ...nativeOutcome(data, data.requested?.preflight === true, invalid), action: "merge", data });
    if (action !== "merge" || !input || typeof input !== "object" || Array.isArray(input)) return finish(true);
    const request = { ...input } as MergeRequest;
    if (Object.keys(request).some(k => !["source", "strategy", "cherrypicking", "forced", "preflight", "format", "workdir"].includes(k)) || !safeNativeText(request.source) || !request.source.trim() || request.source.trimStart().startsWith("-") || request.workdir !== undefined && !safeNativeText(request.workdir) || request.strategy !== undefined && !["auto", "source", "destination"].includes(request.strategy) || request.format !== undefined && !["text", "json"].includes(request.format) || [request.cherrypicking, request.forced, request.preflight].some(v => v !== undefined && typeof v !== "boolean") || Buffer.byteLength(JSON.stringify(request), "utf8") > 24576) return finish(true);
    data.requested = request; data.workingDirectory = resolve(request.workdir ?? process.cwd());
    data.command = buildWorkspaceMergeArgv(request.source, request.strategy ?? "auto", request.cherrypicking ?? false, request.forced ?? false, "__WM_" + randomBytes(12).toString("hex") + "__");
    if (Buffer.byteLength(JSON.stringify(data.command), "utf8") > 32768) { data.requested = null; data.command = null; data.workingDirectory = null; return finish(true); }
    if (!request.preflight) await runNativeMutation(data);
    return finish();
}
