import { promises as fs } from "node:fs";
import { TextDecoder } from "node:util";
import { join } from "node:path";
import { createAsciiTempDirectory, safeTempExtension, isBinaryContent, stableDiffHeaders, type TextDiffResult } from "../diff/text";
import { DIFF_OUTPUT_MAX_CHARS } from "../diff/text";
import { normalizeDiffResponseMaxChars, formatTextDiff } from "../presentation/diff-results";
import { isValidDiffRevisionSpec } from "../domain/revisions";
import { getActiveAbortSignal } from "../execution/context";
import { getCmExecutable, getDiffExecutable } from "../execution/process";
import { runDiffRevisionsCommand, DiffRevisionsCommandError } from "../execution/diff-revisions-command";

export const DIFF_REVISIONS_FILE_BYTES = 4 * 1024 * 1024;
export const DIFF_REVISIONS_MAX_BYTES = 131072;
export type DiffRevisionsArgs = { leftRevision: string; rightRevision: string; maxChars?: number; format?: "text" | "json"; workdir?: string };
export type DiffRevisionsStage = "input" | "left" | "right" | "comparison" | "cleanup" | "producer";
export type DiffRevisionsErrorCode = "invalid_selector" | "invalid_producer_data" | "materialization_failed" | "materialization_limit" | "cleanup_failed" | "invalid_utf8" | "malformed_output" | "command_failed" | "aborted" | "capture_incomplete" | "output_overflow";
export class DiffRevisionsError extends Error {
    constructor(readonly code: DiffRevisionsErrorCode, readonly stage: DiffRevisionsStage) { super("Historical revision comparison failed; no verified comparison is available."); }
}
const abort = (stage: DiffRevisionsStage) => { if (getActiveAbortSignal()?.aborted) throw new DiffRevisionsError("aborted", stage); };
export const validDiffRevisionsSelector = (s: unknown): s is string => {
    if (typeof s !== "string" || !s.length || s.length > 4096 || s.trim() !== s
        || /[;\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(s) || s.startsWith("-")) return false;
    const parts = s.split("#");
    if (parts.length > 2) return false;
    const validGlobal = (value: string) => /^revid:(?:0|[1-9][0-9]*)(?:@rep:[^@]+@repserver:\S+)?$/i.test(value) || /^rev:[^\s#]+$/i.test(value);
    if (parts.length === 1) return validGlobal(s);
    const [path, selector] = parts;
    if (!path || path.trim() !== path || path.startsWith("-") || /^itemid:/i.test(path) && !/^itemid:(?:0|[1-9][0-9]*)$/i.test(path)) return false;
    return /^cs:\d+$/i.test(selector) || /^br:\/.+$/i.test(selector) || /^lb:[^\s#]+$/i.test(selector) || validGlobal(selector);
};
export function diffRevisionsRequest(args: DiffRevisionsArgs) {
    if (!validDiffRevisionsSelector(args.leftRevision) || !validDiffRevisionsSelector(args.rightRevision)) throw new DiffRevisionsError("invalid_selector", "input");
    if (args.format !== undefined && args.format !== "text" && args.format !== "json") throw new DiffRevisionsError("invalid_producer_data", "input");
    return { leftRevision: args.leftRevision, rightRevision: args.rightRevision, maxChars: normalizeDiffResponseMaxChars(args.maxChars) };
}
export type RevisionSide = { selector: string; kind: "file-qualified" | "global-revision"; resolvedIdentity: null; bytes: number; binary: boolean };
export type DiffRevisionsObservation = { left: RevisionSide; right: RevisionSide; maxChars: number; binary: boolean; changed: boolean; normalized: string; hunkCount: number; diffStdoutBytes: number | null; diffExitCode: number | null; legacyResult: TextDiffResult };

// Fully validate unified syntax/counts, not just an exit code or a plausible header.
// Backend-provided header identities are never published as resolved revisions.
export function validateRevisionUnifiedDiff(raw: string): number {
    if (raw.includes("\0")) throw new DiffRevisionsError("malformed_output", "comparison");
    const lines = raw.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    if (!lines[0]?.startsWith("--- ") || lines[0].length <= 4 || !lines[1]?.startsWith("+++ ") || lines[1].length <= 4) throw new DiffRevisionsError("malformed_output", "comparison");
    let left = 0, right = 0, hunks = 0, changes = 0, markerAllowed = false;
    for (const line of lines.slice(2)) {
        const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line);
        if (header) {
            if (left || right) throw new DiffRevisionsError("malformed_output", "comparison");
            const values = [header[1], header[2] ?? "1", header[3], header[4] ?? "1"].map(Number);
            if (values.some(n => !Number.isSafeInteger(n) || n > DIFF_REVISIONS_FILE_BYTES + 1)) throw new DiffRevisionsError("malformed_output", "comparison");
            left = values[1]; right = values[3]; if (!left && !right) throw new DiffRevisionsError("malformed_output", "comparison");
            hunks++; markerAllowed = false; continue;
        }
        if (line === "\\ No newline at end of file" && markerAllowed) { markerAllowed = false; continue; }
        if (!hunks || (!left && !right)) throw new DiffRevisionsError("malformed_output", "comparison");
        if (line.startsWith(" ")) { left--; right--; }
        else if (line.startsWith("-")) { left--; changes++; }
        else if (line.startsWith("+")) { right--; changes++; }
        else throw new DiffRevisionsError("malformed_output", "comparison");
        if (left < 0 || right < 0) throw new DiffRevisionsError("malformed_output", "comparison");
        markerAllowed = true;
    }
    if (!hunks || !changes || left || right) throw new DiffRevisionsError("malformed_output", "comparison");
    return hunks;
}
export async function materializeDiffRevision(selector: string, path: string, stage: "left" | "right", cwd: string): Promise<Buffer> {
    abort(stage);
    await runDiffRevisionsCommand(getCmExecutable(), ["cat", selector, "--file=" + path], cwd, [0])
        .catch(error => { throw error instanceof DiffRevisionsCommandError ? new DiffRevisionsError(error.code, stage) : new DiffRevisionsError("materialization_failed", stage); });
    abort(stage);
    try {
        // Reject symlink/directory output; read through the same descriptor whose size was checked.
        const stat = await fs.lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new DiffRevisionsError("materialization_failed", stage);
        const file = await fs.open(path, "r");
        try {
            const size = (await file.stat()).size;
            if (size > DIFF_REVISIONS_FILE_BYTES) throw new DiffRevisionsError("materialization_limit", stage);
            const bytes = Buffer.alloc(size + 1); // one extra byte detects growth after the size check
            let length = 0;
            while (length < bytes.length) { abort(stage); const result = await file.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
            if (length !== size || (await file.stat()).size !== size) throw new DiffRevisionsError("materialization_failed", stage);
            return bytes.subarray(0, size);
        } finally { await file.close(); }
    } catch (error) { throw error instanceof DiffRevisionsError ? error : new DiffRevisionsError("materialization_failed", stage); }
}
export async function assembleDiffRevisionsObservation(args: DiffRevisionsArgs): Promise<DiffRevisionsObservation> {
    const request = diffRevisionsRequest(args); abort("input");
    let root: string;
    try { root = await createAsciiTempDirectory("pi-plastic-revisions-"); } catch { throw new DiffRevisionsError("materialization_failed", "left"); }
    try {
        const leftPath = join(root, "left" + safeTempExtension(request.leftRevision));
        const rightPath = join(root, "right" + safeTempExtension(request.rightRevision));
        const leftBytes = await materializeDiffRevision(request.leftRevision, leftPath, "left", args.workdir ?? process.cwd());
        const rightBytes = await materializeDiffRevision(request.rightRevision, rightPath, "right", args.workdir ?? process.cwd());
        const side = (selector: string, bytes: Buffer): RevisionSide => ({ selector, kind: selector.includes("#") ? "file-qualified" : "global-revision", resolvedIdentity: null, bytes: bytes.length, binary: isBinaryContent(bytes) });
        return { left: side(request.leftRevision,leftBytes), right: side(request.rightRevision,rightBytes), maxChars:request.maxChars, ...await compareDiffBytes(leftBytes,rightBytes,request.leftRevision.replace("#","@"),request.rightRevision.replace("#","@")) };
    } finally { await fs.rm(root, { recursive: true, force: true }).catch(() => { throw new DiffRevisionsError("cleanup_failed", "cleanup"); }); }
}

export async function compareDiffBytes(leftBytes: Buffer, rightBytes: Buffer, leftLabel: string, rightLabel: string): Promise<Omit<DiffRevisionsObservation,"left"|"right"|"maxChars">> {
    abort("comparison");
        const binary = isBinaryContent(leftBytes) || isBinaryContent(rightBytes);
        if (binary) return { binary: true, changed: !leftBytes.equals(rightBytes), normalized: "", hunkCount: 0, diffStdoutBytes: null, diffExitCode: null, legacyResult: { backend: "diff", binary: true, changed: !leftBytes.equals(rightBytes), output: "", truncated: false, totalChars: 0 } };
        // Match the old portable helper: ASCII-safe immutable backend operands and no logical labels in argv.
        const operands = await createAsciiTempDirectory("pi-plastic-diff-");
        try {
            const l = join(operands, "left" + safeTempExtension(leftLabel)), r = join(operands, "right" + safeTempExtension(rightLabel));
            await Promise.all([fs.writeFile(l, leftBytes, { flag: "wx" }), fs.writeFile(r, rightBytes, { flag: "wx" })]);
            abort("comparison");
            const capture = await runDiffRevisionsCommand(getDiffExecutable(), ["-u", l, r], operands, [0, 1])
                .catch(error => { throw new DiffRevisionsError(error instanceof DiffRevisionsCommandError ? error.code : "command_failed", "comparison"); });
            let raw: string;
            try { raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(capture.stdout); }
            catch { throw new DiffRevisionsError("invalid_utf8", "comparison"); }
            if (capture.exitCode === 0 && raw !== "") throw new DiffRevisionsError("malformed_output", "comparison");
            const hunks = capture.exitCode === 1 ? validateRevisionUnifiedDiff(raw) : 0;
            const normalized = stableDiffHeaders(raw, leftLabel, rightLabel);
            const legacyOutput = stableDiffHeaders(raw.slice(0, DIFF_OUTPUT_MAX_CHARS), leftLabel, rightLabel);
            const truncated = raw.length > DIFF_OUTPUT_MAX_CHARS;
            const legacyResult: TextDiffResult = { backend: "diff", changed: capture.exitCode === 1, binary: false, output: truncated ? legacyOutput + "\n\n[Diff output truncated at " + DIFF_OUTPUT_MAX_CHARS + " characters; inspect a narrower file or generate a review patch for the complete change.]" : normalized, truncated, totalChars: truncated ? raw.length : normalized.length };
            abort("comparison");
            return { binary: false, changed: capture.exitCode === 1, normalized, hunkCount: hunks, diffStdoutBytes: capture.stdout.length, diffExitCode: capture.exitCode, legacyResult };
        } finally { await fs.rm(operands, { recursive: true, force: true }).catch(() => { throw new DiffRevisionsError("cleanup_failed", "cleanup"); }); }
}

export type RevisionExcerpt = { countBasis: "normalized_diff_utf16"; text: string; observedChars: number; sourceChars: number; returnedChars: number; omittedChars: number; markerChars: number; truncated: boolean };
export const DIFF_REVISIONS_EXCERPT_MARKER = "\n\n[Diff excerpt truncated; not a complete/applyable patch.]";
const prefix = (s: string, count: number) => { let end = Math.min(count, s.length); if (end > 0 && end < s.length && /[\uD800-\uDBFF]/.test(s[end - 1])) end--; return s.slice(0, end); };
export function diffRevisionsPayload(observation: DiffRevisionsObservation) {
    const excerpt = (count: number): RevisionExcerpt => {
        const selected = prefix(observation.normalized, count), omitted = observation.normalized.length - selected.length;
        const marker = omitted ? DIFF_REVISIONS_EXCERPT_MARKER : "";
        return { countBasis: "normalized_diff_utf16", text: selected + marker, observedChars: observation.normalized.length, sourceChars: selected.length, returnedChars: selected.length + marker.length, omittedChars: omitted, markerChars: marker.length, truncated: omitted > 0 };
    };
    const markerReserve = DIFF_REVISIONS_EXCERPT_MARKER.length;
    const selected = observation.normalized.length > observation.maxChars ? Math.max(0, observation.maxChars - markerReserve) : observation.normalized.length;
    const data = { ...({ scope: "explicit_selector_pair", qualifierVerified: false, resolvedIdentities: null, comparisonKind: "revision-to-revision", left: observation.left, right: observation.right, status: observation.changed ? observation.binary ? "binary-different" : "changed" : "unchanged", changed: observation.changed, binary: observation.binary, comparisonBasis: observation.binary ? "byte_equality" : "diff_u", hunkCount: observation.hunkCount, capture: { diffStdoutBytes: observation.diffStdoutBytes, diffExitCode: observation.diffExitCode }, limits: { maxChars: observation.maxChars, selectorCodeUnits: 4096, materializedBytesPerSide: DIFF_REVISIONS_FILE_BYTES, compactUtf8Bytes: DIFF_REVISIONS_MAX_BYTES }, excerpt: observation.binary ? null : excerpt(selected) } as const) };
    const completeness = { read: "complete" as const, capture: "complete" as const, projection: !data.excerpt?.truncated };
    const payload = { schemaVersion: 1, action: "diff-revisions", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok: true, completeness, data } as const;
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > DIFF_REVISIONS_MAX_BYTES && !observation.binary) {
        let low = 0, high = selected;
        while (low < high) { const mid = Math.ceil((low + high) / 2); data.excerpt = excerpt(mid); completeness.projection = !data.excerpt.truncated; if (Buffer.byteLength(JSON.stringify(payload), "utf8") <= DIFF_REVISIONS_MAX_BYTES) low = mid; else high = mid - 1; }
        data.excerpt = excerpt(low);
        completeness.projection = !data.excerpt.truncated;
    }
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > DIFF_REVISIONS_MAX_BYTES) throw new DiffRevisionsError("output_overflow", "producer");
    return payload;
}
export async function presentDiffRevisions(observation: DiffRevisionsObservation, args: DiffRevisionsArgs): Promise<string> {
    return formatTextDiff("diffRevisions", args.format, "revision-to-revision", observation.legacyResult, args.workdir, {}, args.maxChars);
}
export async function executeDiffRevisions(args: DiffRevisionsArgs): Promise<string> {
    return presentDiffRevisions(await assembleDiffRevisionsObservation(args), args);
}
