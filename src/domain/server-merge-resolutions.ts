import { open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";

export const RESOLUTIONS_MAX_BYTES = 1024 * 1024;
export const RESOLUTIONS_MAX_ENTRIES = 500;
const unsafe = /[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export type ResolutionFileSummary = { path: string; sha256: string; entries: number; resultFiles: number; keepSource: number; keepDestination: number };
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function safePath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4096 && !unsafe.test(value); }
export function assertAbsoluteResolutionPath(value: unknown): asserts value is string {
    if (!safePath(value) || !isAbsolute(value)) throw new Error("Resolution input paths must be bounded absolute local paths without control/malformed characters.");
}
/** Read-only local validation. CLI remains responsible for matching entries to current conflicts. */
export async function inspectResolutionFile(path: string): Promise<ResolutionFileSummary> {
    assertAbsoluteResolutionPath(path);
    let bytes: Buffer;
    if (!(await stat(path)).isFile()) throw new Error("Resolutions JSON must be a regular file.");
    const file = await open(path, "r");
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > RESOLUTIONS_MAX_BYTES) throw new Error("Resolutions JSON must be a regular file of at most 1 MiB.");
        // Bounded even if another process grows the file after stat.
        const buffer = Buffer.alloc(RESOLUTIONS_MAX_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
        }
        if (length > RESOLUTIONS_MAX_BYTES) throw new Error("Resolutions JSON exceeds 1 MiB.");
        bytes = buffer.subarray(0, length);
    } finally { await file.close(); }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error("Resolutions file must contain valid UTF-8 JSON."); }
    if (!object(value) || Object.keys(value).some(k => k !== "resolutions") || !Array.isArray(value.resolutions) || value.resolutions.length > RESOLUTIONS_MAX_ENTRIES) throw new Error("Resolutions JSON requires only a resolutions array with at most 500 entries.");
    const summary: ResolutionFileSummary = { path, sha256: createHash("sha256").update(bytes).digest("hex"), entries: value.resolutions.length, resultFiles: 0, keepSource: 0, keepDestination: 0 };
    const paths = new Set<string>();
    for (let index = 0; index < value.resolutions.length; index++) {
        const entry = value.resolutions[index];
        const bad = () => new Error(`Invalid resolution entry ${index + 1}: require a unique destination conflict path and exactly one of keep (source/destination) or an absolute readable resultFile.`);
        if (!object(entry) || Object.keys(entry).some(k => !["path", "keep", "resultFile"].includes(k)) || !safePath(entry.path) || !entry.path.startsWith("/") || paths.has(entry.path) || Object.hasOwn(entry, "keep") === Object.hasOwn(entry, "resultFile")) throw bad();
        paths.add(entry.path);
        if (Object.hasOwn(entry, "keep")) {
            if (entry.keep === "source") summary.keepSource++;
            else if (entry.keep === "destination") summary.keepDestination++;
            else throw bad();
        } else {
            try {
                assertAbsoluteResolutionPath(entry.resultFile);
                if (!(await stat(entry.resultFile)).isFile()) throw bad();
                const result = await open(entry.resultFile, "r");
                try { if (!(await result.stat()).isFile()) throw bad(); }
                finally { await result.close(); }
            } catch { throw bad(); }
            summary.resultFiles++;
        }
    }
    return summary;
}
