import { constants, promises as fs, type Stats } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

export const LOCAL_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;
export type LocalSnapshotErrorCode = "missing_file" | "unsupported_file" | "outside_workspace" | "file_limit" | "file_changed" | "aborted" | "read_failed";
export class LocalSnapshotError extends Error {
    constructor(readonly code: LocalSnapshotErrorCode) { super("A bounded local file snapshot could not be verified."); }
}
interface SnapshotHandle {
    stat(): Promise<Stats>;
    read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
}
export interface LocalSnapshotFilesystem {
    lstat(path: string): Promise<Stats>;
    realpath(path: string): Promise<string>;
    open(path: string): Promise<SnapshotHandle>;
}
const filesystem: LocalSnapshotFilesystem = {
    lstat: path => fs.lstat(path),
    realpath: path => fs.realpath(path),
    open: path => fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)),
};
const same = (a: Stats, b: Stats): boolean =>
    a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const regular = (s: Stats) => s.isFile() && !s.isSymbolicLink();
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new LocalSnapshotError("aborted"); };

// The caller supplies an absolute file and the discovered workspace root. This
// helper never discovers a different workspace, retries, or writes a local file.
// Timestamp/identity checks detect observable changes; they are not an atomic
// filesystem snapshot or protection against an adversary restoring timestamps.
export async function snapshotLocalFile(
    filePath: string,
    workspaceRoot: string,
    signal?: AbortSignal,
    io: LocalSnapshotFilesystem = filesystem,
): Promise<{ bytes: Buffer; physicalPath: string }> {
    abort(signal);
    if (!isAbsolute(filePath) || !isAbsolute(workspaceRoot)) throw new LocalSnapshotError("outside_workspace");
    try {
        const root = await io.realpath(workspaceRoot);
        const initial = await io.lstat(filePath);
        if (!regular(initial)) throw new LocalSnapshotError("unsupported_file");
        const physicalPath = await io.realpath(filePath);
        const scope = relative(root, physicalPath);
        if (!scope || scope === ".." || scope.startsWith(".." + sep) || isAbsolute(scope)) throw new LocalSnapshotError("outside_workspace");
        abort(signal);
        const handle = await io.open(filePath);
        try {
            const before = await handle.stat();
            if (!regular(before) || !same(initial, before)) throw new LocalSnapshotError("file_changed");
            if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > LOCAL_SNAPSHOT_MAX_BYTES) throw new LocalSnapshotError("file_limit");
            const buffer = Buffer.alloc(before.size + 1);
            let length = 0;
            while (length < buffer.length) {
                abort(signal);
                const read = await handle.read(buffer, length, buffer.length - length, length);
                if (!Number.isInteger(read.bytesRead) || read.bytesRead < 0 || read.bytesRead > buffer.length - length) throw new LocalSnapshotError("read_failed");
                if (!read.bytesRead) break;
                length += read.bytesRead;
            }
            const after = await handle.stat();
            const current = await io.lstat(filePath);
            if (length !== before.size || !same(before, after) || !regular(current) || !same(before, current) || await io.realpath(filePath) !== physicalPath) throw new LocalSnapshotError("file_changed");
            abort(signal);
            return { bytes: buffer.subarray(0, length), physicalPath };
        } finally { await handle.close(); }
    } catch (error) {
        if (error instanceof LocalSnapshotError) throw error;
        const code = (error as NodeJS.ErrnoException)?.code;
        throw new LocalSnapshotError(code === "ENOENT" ? "missing_file" : code === "ELOOP" ? "unsupported_file" : "read_failed");
    }
}
