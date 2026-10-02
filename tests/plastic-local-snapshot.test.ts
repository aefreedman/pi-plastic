import assert from "node:assert/strict";
import { promises as fs, type Stats } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LOCAL_SNAPSHOT_MAX_BYTES, LocalSnapshotError, snapshotLocalFile, type LocalSnapshotFilesystem } from "../src/diff/local-snapshot";

const root = await fs.mkdtemp(join(tmpdir(), "pi-plastic-snapshot-test-"));
try {
    const workspace = join(root, "workspace"), other = join(root, "other");
    await fs.mkdir(workspace); await fs.mkdir(other);
    const path = join(workspace, "Example-日本-😀.txt");
    const original = Buffer.from("before 日本 😀\n");
    await fs.writeFile(path, original, { flag: "wx" });
    const result = await snapshotLocalFile(path, workspace);
    assert.deepEqual(result.bytes, original);
    await fs.writeFile(path, "after\n");
    assert.deepEqual(result.bytes, original, "Captured bytes do not follow later file edits.");
    assert.deepEqual(await fs.readFile(path), Buffer.from("after\n"), "Snapshot did not alter the working file.");
    const failure = (code: string) => (error: unknown) => error instanceof LocalSnapshotError && error.code === code && !error.message.includes(root);
    await assert.rejects(snapshotLocalFile(join(workspace, "missing.txt"), workspace), failure("missing_file"));
    await assert.rejects(snapshotLocalFile(workspace, workspace), failure("unsupported_file"));
    const external = join(other, "Example.txt"); await fs.writeFile(external, "outside");
    await assert.rejects(snapshotLocalFile(external, workspace), failure("outside_workspace"));
    await assert.rejects(snapshotLocalFile("Example.txt", workspace), failure("outside_workspace"));
    await fs.writeFile(path, Buffer.alloc(LOCAL_SNAPSHOT_MAX_BYTES));
    assert.equal((await snapshotLocalFile(path, workspace)).bytes.length, LOCAL_SNAPSHOT_MAX_BYTES);
    await fs.writeFile(path, Buffer.alloc(LOCAL_SNAPSHOT_MAX_BYTES + 1));
    await assert.rejects(snapshotLocalFile(path, workspace), failure("file_limit"));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(snapshotLocalFile(path, workspace, controller.signal), failure("aborted"));

    // Deterministic races and IO failures: no scheduling-dependent edits and no
    // Plastic working copy/registry/fixture history is involved.
    await fs.writeFile(path, "abc");
    const stat = await fs.lstat(path), physical = await fs.realpath(path), physicalRoot = await fs.realpath(workspace);
    const changed = { ...stat, mtimeMs: stat.mtimeMs + 1 } as Stats;
    Object.setPrototypeOf(changed, Object.getPrototypeOf(stat));
    type Case = { after?: Stats; current?: Stats; namespace?: string; content?: Buffer; abortDuringRead?: boolean; closeFails?: boolean; readFails?: boolean; symlink?: boolean };
    for (const [options,code] of [
        [{ after:changed }, "file_changed"],
        [{ current:changed }, "file_changed"],
        [{ namespace:external }, "file_changed"],
        [{ content:Buffer.from("abcd") }, "file_changed"],
        [{ content:Buffer.from("ab") }, "file_changed"],
        [{ abortDuringRead:true }, "aborted"],
        [{ readFails:true }, "read_failed"],
        [{ closeFails:true }, "read_failed"],
        [{ symlink:true }, "unsupported_file"],
    ] as Array<[Case,string]>) {
        let closed = 0, stats = 0, names = 0, paths = 0, opened = 0;
        const signal = new AbortController();
        const initial = options.symlink ? { ...stat, isFile:()=>false, isSymbolicLink:()=>true } as Stats : stat;
        const io: LocalSnapshotFilesystem = {
            async realpath(p) { if (p === workspace) return physicalRoot; names++; return names > 1 ? options.namespace ?? physical : physical; },
            async lstat() { paths++; return paths === 1 ? initial : options.current ?? stat; },
            async open() { opened++; return {
                async stat() { return ++stats === 1 ? stat : options.after ?? stat; },
                async read(buffer, offset, length, position) {
                    if (options.readFails) throw Error("private fixture diagnostic");
                    const content = options.content ?? Buffer.from("abc");
                    const bytesRead = content.copy(buffer, offset, position, Math.min(position + length, content.length));
                    if (options.abortDuringRead) signal.abort();
                    return { bytesRead };
                },
                async close() { closed++; if (options.closeFails) throw Error("private fixture diagnostic"); },
            }; },
        };
        await assert.rejects(snapshotLocalFile(path, workspace, signal.signal, io), failure(code));
        assert.equal(opened, options.symlink ? 0 : 1);
        assert.equal(closed, opened, "Every opened descriptor is closed on failures and cancellation.");
    }
    console.log("PASS: bounded local snapshots, Unicode/UTF-8, exact/over byte limits, physical containment, file-kind/read/change/namespace/abort failures, sanitized diagnostics and descriptor cleanup; zero Plastic commands.");
} finally { await fs.rm(root, { recursive:true, force:true }); }
