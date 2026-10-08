import { randomBytes } from "node:crypto";
import { assertAbsoluteResolutionPath, inspectResolutionFile } from "../domain/server-merge-resolutions";
import { getActiveAbortSignal } from "../execution/context";
import { captureServerMergeCommand } from "../execution/server-merge-command";
import { tool } from "../tool-definition";
import { outputFormatArg, formatServerMergeResult } from "../presentation/results";
import { parseServerMergeOutput } from "../domain/merge-output";
import { emptyMergeAttempt, splitServerBranch, type MergeReceipt, type MergeReceiptData, type ServerMergeRequest } from "../domain/server-merge-contract";
export { splitServerBranch };
export type { MergeReceipt } from "../domain/server-merge-contract";
export type QualifiedServerBranch = { raw: string; branch: string; repository: string; server: string };
class ServerMergeInputError extends Error {}
export const SERVER_MERGE_OUTPUT_LIMIT = 32768, SERVER_MERGE_HELP_TIMEOUT_MS = 3000, SERVER_MERGE_COMMAND_TIMEOUT_MS = 30000;
export const serverMergeControlPattern = /[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const serverMergeCapabilityTokens = ["--to", "--merge", "--nointeractiveresolution", "--machinereadable", "--startlineseparator", "--endlineseparator", "--fieldseparator"];
export function assertSafeServerMergeValue(name: string, value: string): string {
    if (typeof value !== "string" || !value.trim() || value.length > 4096 || serverMergeControlPattern.test(value)) throw new ServerMergeInputError(`${name} must be non-empty, bounded and free of control/malformed characters.`);
    return value.trim();
}
export function parseQualifiedServerBranch(name: string, value: string): QualifiedServerBranch {
    const raw = assertSafeServerMergeValue(name, value), parts = splitServerBranch(raw);
    if (!parts) throw new ServerMergeInputError(`${name} must use unambiguous fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    return { raw, ...parts };
}
export const createServerMergeSeparators = () => {
    const n = randomBytes(16).toString("hex");
    return { start: `__PI_PLASTIC_MERGE_START_${n}__`, end: `__PI_PLASTIC_MERGE_END_${n}__`, field: `__PI_PLASTIC_MERGE_FIELD_${n}__` };
};
export function validateServerMergeRequest(input: unknown): asserts input is ServerMergeRequest {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ServerMergeInputError("Merge input must be an object.");
    const r = input as Record<string, unknown>;
    if (Object.keys(r).some(k => !["source", "target", "message", "mode", "fileConflictsResolutionsFile", "unlistedConflictPolicy", "preflight", "format"].includes(k)) || r.preflight !== undefined && typeof r.preflight !== "boolean" || r.format !== undefined && r.format !== "text" && r.format !== "json" || r.mode !== undefined && r.mode !== "apply" && r.mode !== "analyze" || r.unlistedConflictPolicy !== undefined && r.unlistedConflictPolicy !== "source" && r.unlistedConflictPolicy !== "destination") throw new ServerMergeInputError("Merge input contains unsupported fields or options.");
    if (r.mode === "analyze" && (r.message !== undefined || r.fileConflictsResolutionsFile !== undefined || r.unlistedConflictPolicy !== undefined)) throw new ServerMergeInputError("Analyze mode does not accept a message, resolutions file or conflict policy.");
    if (r.fileConflictsResolutionsFile !== undefined) {
        try { assertAbsoluteResolutionPath(r.fileConflictsResolutionsFile); }
        catch { throw new ServerMergeInputError("fileConflictsResolutionsFile must be a bounded absolute local path."); }
    }
    const s = parseQualifiedServerBranch("source", r.source as string), t = parseQualifiedServerBranch("target", r.target as string);
    if (r.mode !== "analyze") assertSafeServerMergeValue("message", r.message as string);
    if (s.repository !== t.repository || s.server !== t.server) throw new ServerMergeInputError("source and target must identify the same exact repository and server.");
    if (s.branch === t.branch) throw new ServerMergeInputError("source and target must identify different branches.");
}
export async function assembleServerMergeReceipt(input: unknown): Promise<MergeReceipt> {
    const data: MergeReceiptData = { mode: "apply", resolutionsFile: null, unlistedConflictPolicy: null, requestedIdentity: null, command: null, capability: { state: "not-checked", missingTokens: [] }, attempt: emptyMergeAttempt(), capture: { help: null, merge: null }, parse: null, observedChangesets: [], conflictPaths: [], counts: { changesetsReturned: 0, changesetsOmitted: 0, conflictsReturned: 0, conflictsOmitted: 0 }, createdChangeset: null, effect: "not-attempted", serverAliasEquivalence: "unverified", mergeLinkIdentity: "unverified", xlinkEffects: "unverified", wouldRun: false, remoteAnalysis: "not-performed" };
    const completeness: MergeReceipt["completeness"] = { capture: "unknown", projection: true };
    const finish = (outcome: MergeReceipt["outcome"], stage: "input" | "help" | "merge" | "producer", code?: string, message = "The server merge evidence could not be verified."): MergeReceipt => {
        data.effect = outcome === "completed" ? "changeset-created" : outcome === "no-op" ? "not-proven" : outcome === "conflict" || outcome === "uncertain" ? "uncertain" : "not-attempted";
        const ok = ["preflight", "analyzed", "completed", "no-op"].includes(outcome);
        const dto = { schemaVersion: 1, action: "merge-branches", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok, outcome, completeness, data, ...(!ok ? { error: { code: code ?? outcome, stage, message } } : {}) } as MergeReceipt;
        while (Buffer.byteLength(JSON.stringify(dto), "utf8") > 131072 && (data.conflictPaths.length || data.observedChangesets.length)) {
            if (data.conflictPaths.length) { data.conflictPaths.pop(); data.counts.conflictsReturned--; data.counts.conflictsOmitted++; }
            else { data.observedChangesets.pop(); data.counts.changesetsReturned--; data.counts.changesetsOmitted++; }
            completeness.projection = false;
        }
        return dto;
    };
    let stage: "input" | "help" | "merge" = "input";
    try {
        validateServerMergeRequest(input);
        const source = parseQualifiedServerBranch("source", input.source), target = parseQualifiedServerBranch("target", input.target);
        data.mode = input.mode ?? "apply";
        data.unlistedConflictPolicy = input.unlistedConflictPolicy ?? null;
        if (input.fileConflictsResolutionsFile !== undefined) {
            try { data.resolutionsFile = await inspectResolutionFile(input.fileConflictsResolutionsFile); }
            catch (error) { throw new ServerMergeInputError(error instanceof Error && /^(Invalid resolution entry|Resolutions|Resolution)/.test(error.message) ? error.message : "Resolutions file or a result file is unavailable or invalid."); }
        }
        const seps = createServerMergeSeparators();
        const command = ["merge", source.raw, `--to=${target.raw}`, ...(data.mode === "apply" ? ["--merge", `-c=${assertSafeServerMergeValue("message", input.message!)}`] : []), ...(data.resolutionsFile ? [`--fileconflictsresolutionsfile=${data.resolutionsFile.path}`] : []), ...(data.unlistedConflictPolicy ? [data.unlistedConflictPolicy === "source" ? "--keepsource" : "--keepdestination"] : []), "--nointeractiveresolution", "--machinereadable", `--startlineseparator=${seps.start}`, `--endlineseparator=${seps.end}`, `--fieldseparator=${seps.field}`];
        data.requestedIdentity = { source: source.raw, target: target.raw, branch: target.branch, repository: target.repository, server: target.server }; data.command = ["cm", ...command]; data.wouldRun = true;
        if (input.preflight) return finish("preflight", "input");
        if (getActiveAbortSignal()?.aborted) { data.attempt.aborted = true; return finish("failed", "merge", "aborted"); }
        stage = "help";
        const help = await captureServerMergeCommand(["help", "merge"], SERVER_MERGE_HELP_TIMEOUT_MS); data.capture.help = help.capture;
        if (!help.capture.complete || help.attempt.exitCode !== 0 || help.attempt.aborted || help.attempt.timedOut || help.capture.stderrBytes) { data.capability.state = "unavailable"; return finish("failed", "help", "capability_unavailable"); }
        const requiredTokens = [...serverMergeCapabilityTokens, ...(data.resolutionsFile ? ["--fileconflictsresolutionsfile"] : []), ...(data.unlistedConflictPolicy ? [data.unlistedConflictPolicy === "source" ? "--keepsource" : "--keepdestination"] : [])];
        data.capability.missingTokens = requiredTokens.filter(t => !help.stdout!.includes(t));
        if (data.capability.missingTokens.length) { data.capability.state = "missing"; completeness.capture = "complete"; return finish("unsupported", "help", "unsupported"); }
        data.capability.state = "advertised";
        // Revalidate the JSON after help so edited instructions are not silently submitted.
        // Result content is caller-owned; callers must keep all inputs immutable until cm exits.
        if (data.resolutionsFile) {
            try {
                const current = await inspectResolutionFile(data.resolutionsFile.path);
                if (current.sha256 !== data.resolutionsFile.sha256) throw new Error("changed");
            } catch { return finish("failed", "input", "invalid_request", "Resolution inputs changed or became unavailable before merge dispatch."); }
        }
        stage = "merge";
        const obs = await captureServerMergeCommand(command, SERVER_MERGE_COMMAND_TIMEOUT_MS); data.attempt = obs.attempt; data.capture.merge = obs.capture;
        completeness.capture = obs.capture.complete ? "complete" : "incomplete";
        if (obs.attempt.state === "not-attempted" || obs.attempt.state === "not-started") return finish("failed", "merge", obs.attempt.aborted ? "aborted" : "launch_failed");
        const parsed = parseServerMergeOutput(obs.stdout ?? "", seps);
        const paths = parsed.records.filter(r => r.operation === "FILE_CONFLICT" && r.fields.length === 6 && r.fields[1]!.length <= 4096 && !serverMergeControlPattern.test(r.fields[1]!)).map(r => r.fields[1]!);
        data.parse = { records: parsed.records.length, malformed: parsed.malformed, unknownOperations: parsed.unknownOperations.length, changesetsObserved: parsed.changesets.length, conflictsObserved: paths.length };
        // One aggregate evidence budget, not one budget per collection.
        data.observedChangesets = parsed.changesets.slice(0, 100); data.conflictPaths = paths.slice(0, 100 - data.observedChangesets.length);
        data.counts = { changesetsReturned: data.observedChangesets.length, changesetsOmitted: parsed.changesets.length - data.observedChangesets.length, conflictsReturned: data.conflictPaths.length, conflictsOmitted: paths.length - data.conflictPaths.length };
        if (data.counts.changesetsOmitted || data.counts.conflictsOmitted) completeness.projection = false;
        const matching = parsed.changesets.filter(c => c.branch === target.branch && c.repository === target.repository && c.mount === "/");
        // Emitted server aliases are kept verbatim. Matching uses dispatch context,
        // not an invented equivalence between requested and emitted server names.
        const ambiguous = !obs.capture.complete || obs.failed || obs.attempt.aborted || obs.attempt.timedOut || obs.attempt.terminal !== "observed" || obs.attempt.exitCode === null || parsed.malformed || parsed.unknownOperations.length > 0 || parsed.changesets.length > 1 || parsed.changesets.length > 0 && matching.length !== 1 || parsed.hasConflict && parsed.changesets.length > 0 || parsed.isAlreadyConnected && (parsed.changesets.length > 0 || parsed.hasConflict);
        if (data.mode === "analyze") {
            if (!ambiguous && obs.attempt.exitCode === 0 && !obs.capture.stderrBytes && !parsed.changesets.length && parsed.records.length > 0) {
                data.remoteAnalysis = "performed";
                return finish("analyzed", "merge");
            }
            return finish("uncertain", "merge", "uncertain", "Server conflict analysis could not be verified; no applying command was requested.");
        }
        if (!ambiguous && obs.attempt.exitCode === 0 && !obs.capture.stderrBytes && matching.length === 1 && !parsed.hasConflict && !parsed.isAlreadyConnected) { data.createdChangeset = matching[0]!; return finish("completed", "merge"); }
        if (!ambiguous && obs.attempt.exitCode === 0 && !obs.capture.stderrBytes && parsed.isAlreadyConnected && !parsed.changesets.length && !parsed.hasConflict) return finish("no-op", "merge");
        if (!ambiguous && obs.attempt.exitCode !== 0 && parsed.hasConflict && !parsed.changesets.length) return finish("conflict", "merge", "conflict");
        return finish("uncertain", "merge", "uncertain");
    } catch (error) {
        if (stage === "input") return finish("failed", "input", "invalid_request", error instanceof ServerMergeInputError ? error.message : "Invalid merge input.");
        // Once merge collection is entered, an unexpected failure cannot prove nonstart.
        if (stage === "merge") { if (data.attempt.state === "not-attempted") data.attempt.state = "unknown"; return finish("uncertain", "producer", "producer_failed"); }
        data.capability.state = "unavailable"; return finish("failed", "help", "capability_unavailable");
    }
}
export async function presentServerMergeReceipt(dto: MergeReceipt, format: "text" | "json" = "text"): Promise<string> {
    const title = dto.outcome === "no-op" ? "No-op" : dto.outcome[0]!.toUpperCase() + dto.outcome.slice(1);
    const text = dto.outcome === "preflight" ? `## Server Merge Preflight\n\n- Would run: yes\n- Remote analysis: not performed\n- Command argv: ${JSON.stringify(dto.data.command)}` : dto.outcome === "analyzed" ? `## Server Merge Analysis\n\n- Read-only: no applying merge requested\n- File conflicts observed: ${dto.data.parse?.conflictsObserved ?? "unknown"}\n${dto.data.conflictPaths.map(path => "- " + path).join("\n")}\n- Conflicts omitted: ${dto.data.counts.conflictsOmitted}\n- Point-in-time evidence only; no contributor content retrieved.` : `## Server Merge ${title}\n\n${dto.data.createdChangeset ? "- Created target changeset: cs:" + dto.data.createdChangeset.id + "\n" : ""}- Effect: ${dto.data.effect}\n- Server alias equivalence, merge-link identity and Xlink effects: unverified\n${dto.ok ? "" : "- Do not retry automatically; inspect server state if an attempt may have started."}`;
    const rendered = await formatServerMergeResult(format, dto.outcome, text, dto.data);
    return rendered.length <= 24000 ? rendered : JSON.stringify({ action: dto.action, outcome: dto.outcome, ok: dto.ok, note: "Presentation omitted; use the registered tool structuredContent for the bounded receipt." });
}
export const mergeBranches = tool({
    description: "Inspect server merge conflicts with mode=analyze, then apply reviewed per-file JSON resolutions without a workspace or UI. Server aliases, merge links and Xlink effects remain unverified.",
    args: { source: tool.schema.string().min(1).describe("Fully qualified source branch; branch/repository may not contain @; full server tail retained."), target: tool.schema.string().min(1).describe("Fully qualified distinct target in the same exact requested repository/server."), message: tool.schema.string().min(1).optional().describe("Required for apply; omit in analyze mode. Bounded nonempty comment, no editor fallback."), mode: tool.schema.enum(["apply", "analyze"]).optional().describe("Default apply creates a merge changeset. Analyze performs read-only remote conflict discovery without --merge; not command-only preflight."), fileConflictsResolutionsFile: tool.schema.string().min(1).optional().describe("Apply only: absolute existing UTF-8 JSON file with resolutions entries (exact conflict path plus keep or absolute readable resultFile). Inputs must remain immutable until completion."), unlistedConflictPolicy: tool.schema.enum(["source", "destination"]).optional().describe("Apply only: explicitly keep this contributor for conflicts absent from the JSON. Omit to retain noninteractive default behavior; never selected automatically."), preflight: tool.schema.boolean().optional().describe("Render intent only, zero commands; does not analyze remote conflicts."), format: outputFormatArg },
    async execute(args) { const dto = await assembleServerMergeReceipt(args); if (!dto.ok && dto.error.stage === "input") throw new Error(dto.error.message); return presentServerMergeReceipt(dto, args.format); },
});
