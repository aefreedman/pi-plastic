import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __plasticDiffInternals, __plasticProcessInternals } from "../src/plastic-core.ts";

const root = await mkdtemp(join(tmpdir(), "pi-plastic-diff-"));

try {
    const { resolveDiffFileRevision, isUnscopedDiffRevisionSpec, runPortableTextDiff, DIFF_OUTPUT_MAX_CHARS, safeTempExtension } = __plasticDiffInternals;

    assert.deepEqual(
        resolveDiffFileRevision("Assets/Scene.unity"),
        { supplied: null, kind: "workspace-base", resolved: "Assets/Scene.unity" },
        "omitting revision should select the workspace-base path",
    );
    assert.deepEqual(
        resolveDiffFileRevision("Assets/Scene.unity", "42"),
        { supplied: "42", kind: "changeset", resolved: "Assets/Scene.unity#cs:42" },
        "a number must be a changeset selector, not an item revision",
    );
    assert.equal(resolveDiffFileRevision("Assets/Scene.unity", "br:/dev/diff").kind, "branch");
    assert.equal(resolveDiffFileRevision("Assets/Scene.unity", "revid:123").kind, "global-revision");
    assert.throws(() => resolveDiffFileRevision("Assets/Scene.unity", "base"), /Unsupported revision 'base'/);
    assert.throws(() => resolveDiffFileRevision("Assets/Scene.unity", "cs:head"), /Unsupported revision 'cs:head'/);
    assert.throws(() => resolveDiffFileRevision("Assets/Scene.unity", "cs:br:\/main"), /Unsupported revision/);
    assert.equal(isUnscopedDiffRevisionSpec("base"), true);
    assert.equal(isUnscopedDiffRevisionSpec("head"), true);
    assert.equal(isUnscopedDiffRevisionSpec("cs:42"), true);
    assert.equal(isUnscopedDiffRevisionSpec("42"), true);
    assert.equal(isUnscopedDiffRevisionSpec("rev:"), true);
    assert.equal(isUnscopedDiffRevisionSpec("arbitrary"), true);
    assert.equal(isUnscopedDiffRevisionSpec("Assets/Scene.unity#cs:42"), false);
    assert.equal(isUnscopedDiffRevisionSpec("Assets/Scene.unity#br:/main"), false);
    assert.equal(isUnscopedDiffRevisionSpec("revid:123"), false);
    assert.equal(safeTempExtension("Assets/My Scene.unity"), ".unity");
    assert.equal(safeTempExtension("revid:99"), ".tmp");
    assert.equal(__plasticProcessInternals.resolveDiffExecutable({ PI_PLASTIC_DIFF_EXECUTABLE: "D:/tools/diff.exe" }), "D:/tools/diff.exe");

    const left = join(root, "Unity Scene ünicode.unity");
    const right = join(root, "Unity Scene ünicode copy.unity");
    await writeFile(left, "%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Before\n", "utf8");
    await writeFile(right, "%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: After\n", "utf8");
    const yamlResult = await runPortableTextDiff(left, right, root, "Assets/Scene.unity (Plastic base)", "Assets/Scene.unity (workspace)");
    assert.equal(yamlResult.backend, "diff");
    assert.equal(yamlResult.changed, true);
    assert.equal(yamlResult.binary, false, "Unity YAML must be treated as text based on bytes, not extension/attributes");
    assert.match(yamlResult.output, /^--- Assets\/Scene\.unity \(Plastic base\)\n\+\+\+ Assets\/Scene\.unity \(workspace\)/);
    assert.doesNotMatch(yamlResult.output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "temporary/local paths must not appear in normalized headers");

    const sameResult = await runPortableTextDiff(left, left, root, "left", "right");
    assert.equal(sameResult.changed, false);
    assert.equal(sameResult.binary, false);

    const binaryLeft = join(root, "fixture.asset");
    const binaryRight = join(root, "fixture-copy.asset");
    await writeFile(binaryLeft, Buffer.from([0, 1, 2, 3]));
    await writeFile(binaryRight, Buffer.from([0, 1, 4, 3]));
    const binaryResult = await runPortableTextDiff(binaryLeft, binaryRight, root, "base", "workspace");
    assert.equal(binaryResult.changed, true);
    assert.equal(binaryResult.binary, true);
    assert.equal(binaryResult.output, "");

    const invalidUtf8Left = join(root, "invalid-utf8-left.asset");
    const invalidUtf8Right = join(root, "invalid-utf8-right.asset");
    await writeFile(invalidUtf8Left, Buffer.from([0xff, 0x81, 0x41]));
    await writeFile(invalidUtf8Right, Buffer.from([0xff, 0x81, 0x42]));
    const invalidUtf8Result = await runPortableTextDiff(invalidUtf8Left, invalidUtf8Right, root, "base", "workspace");
    assert.equal(invalidUtf8Result.changed, true);
    assert.equal(invalidUtf8Result.binary, true, "non-UTF-8 bytes must be reported as binary instead of replacement-decoded text");
    assert.equal(invalidUtf8Result.output, "");

    const largeLeft = join(root, "large-left.txt");
    const largeRight = join(root, "large-right.txt");
    await writeFile(largeLeft, `${"before\n".repeat(12_000)}`, "utf8");
    await writeFile(largeRight, `${"after\n".repeat(12_000)}`, "utf8");
    const largeResult = await runPortableTextDiff(largeLeft, largeRight, root, "large base", "large workspace");
    assert.equal(largeResult.changed, true);
    assert.equal(largeResult.truncated, true);
    assert.ok(largeResult.totalChars > DIFF_OUTPUT_MAX_CHARS);
    assert.match(largeResult.output, /Diff output truncated/);

    console.log("PASS: plastic diff workflow tests passed");
} finally {
    await rm(root, { recursive: true, force: true });
}
