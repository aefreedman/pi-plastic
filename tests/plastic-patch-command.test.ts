import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __plasticPatchInternals, __plasticProcessInternals } from "../src/plastic-core.ts";

const assert = (condition: boolean, message: string): void =>
{
    if (!condition)
    {
        throw new Error(message);
    }
};

const assertArgs = (actual: string[], expected: string[], message: string): void =>
{
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
};

const assertThrows = (fn: () => void, expectedMessage: string, message: string): void =>
{
    try
    {
        fn();
    }
    catch (error)
    {
        assert(error instanceof Error, `${message}: expected an Error instance.`);
        assert(error.message.includes(expectedMessage), `${message}: expected message to include '${expectedMessage}', got '${error.message}'.`);
        return;
    }

    throw new Error(`${message}: expected function to throw.`);
};

const main = async (): Promise<void> =>
{
    const { buildPatchCommandArgs, resolvePatchToolPath, qualifyPatchBranchSpec, resolvePatchBranchSpecs, runPatchOutputTransaction, withPatchBackendContractDiagnostic, PATCH_MOVE_REPRESENTATION } = __plasticPatchInternals;

    // Command construction must not promise a Plastic patch move encoding: that
    // is server/backend output and requires a controlled live fixture to prove.
    assert(PATCH_MOVE_REPRESENTATION === "backend-determined", "Patch metadata must explicitly leave moved-item encoding backend-determined rather than fabricating move evidence.");

    assert(resolvePatchToolPath(undefined, {}, "linux") === "diff", "Expected non-Windows patch default to be bare diff.");
    assert(resolvePatchToolPath(undefined, { PI_PLASTIC_DIFF_EXECUTABLE: "/tools/text-diff" }, "linux") === "/tools/text-diff", "Expected non-Windows legacy text-diff override to remain compatible.");
    assert(resolvePatchToolPath(undefined, { PI_PLASTIC_DIFF_EXECUTABLE: "/tools/text-diff", PI_PLASTIC_PATCH_EXECUTABLE: "/tools/patch-diff" }, "linux") === "/tools/patch-diff", "Expected patch-specific executable policy to outrank text-diff compatibility.");
    assert(resolvePatchToolPath(" C:\\custom\\diff.exe ", { PI_PLASTIC_PATCH_EXECUTABLE: "C:\\configured\\diff.exe" }, "win32") === "C:\\custom\\diff.exe", "Expected an explicit patch backend to have highest priority.");
    assert(resolvePatchToolPath(undefined, { PI_PLASTIC_PATCH_EXECUTABLE: "C:\\Program Files\\Git\\usr\\bin\\diff.exe" }, "win32") === "C:\\Program Files\\Git\\usr\\bin\\diff.exe", "Expected an explicit Windows patch policy executable to be accepted.");
    assertThrows(
        () => resolvePatchToolPath(undefined, { PI_PLASTIC_DIFF_EXECUTABLE: "C:\\GnuWin32\\bin\\diff.exe" }, "win32"),
        "PI_PLASTIC_PATCH_EXECUTABLE",
        "Expected Windows patching to reject the text-diff/GnuWin32 fallback before cm patch",
    );
    assert(__plasticProcessInternals.resolveDiffExecutable({ PI_PLASTIC_DIFF_EXECUTABLE: "C:\\GnuWin32\\bin\\diff.exe" }) === "C:\\GnuWin32\\bin\\diff.exe", "Expected the ordinary text-diff policy to remain independent.");
    const diagnosticStagingDirectory = await mkdtemp(join(tmpdir(), "pi-plastic-patch-diagnostic-"));
    try
    {
        const stagingOutput = join(diagnosticStagingDirectory, "patch-output");
        // On macOS this resolves /var/... to /private/var/... without relying
        // on a machine-specific hardcoded path.
        const canonicalStagingOutput = join(await realpath(diagnosticStagingDirectory), "patch-output");
        const bsdPatchDiagnostic = withPatchBackendContractDiagnostic(new Error(`diff: unrecognized option \`--binary' while writing ${canonicalStagingOutput}`), "/usr/bin/diff", stagingOutput);
        assert(bsdPatchDiagnostic.message.includes("PI_PLASTIC_PATCH_EXECUTABLE"), "Expected an actionable patch-specific executable diagnostic when a backend rejects --binary.");
        assert(bsdPatchDiagnostic.message.includes("GNU diffutils-compatible"), "Expected the --binary diagnostic to identify the required GNU-compatible patch contract.");
        assert(!bsdPatchDiagnostic.message.includes(stagingOutput), "Expected patch backend diagnostics to redact the requested package-owned staging output path.");
        assert(!bsdPatchDiagnostic.message.includes(canonicalStagingOutput), "Expected patch backend diagnostics to redact the dynamically resolved canonical staging output path.");
    }
    finally
    {
        await rm(diagnosticStagingDirectory, { recursive: true, force: true });
    }

    const workspaceRepository = "Cloud Repositories/demo-project@sample-account@sample-server";
    assert(qualifyPatchBranchSpec("br:/main/pi-plastic-edge-20260801", workspaceRepository) === `br:/main/pi-plastic-edge-20260801@${workspaceRepository}`, "Expected a space-containing workspace repository selector to remain one safe cm argv value.");
    assert(qualifyPatchBranchSpec("br:/main/task001@Other@server", workspaceRepository) === "br:/main/task001@Other@server", "Expected an explicitly repository-qualified branch selector to remain unchanged.");
    assert(qualifyPatchBranchSpec("cs:42", workspaceRepository) === "cs:42", "Expected non-branch revision specs to remain unchanged.");
    assertThrows(
        () => qualifyPatchBranchSpec("br:/main/task001", "Repo@@server"),
        "repository-qualified syntax",
        "Expected ambiguous repository selector components to be rejected",
    );
    assertThrows(
        () => qualifyPatchBranchSpec("br:/main/task001", "Repo@server\u0000"),
        "repository-qualified syntax",
        "Expected control characters in a repository selector to be rejected",
    );
    assertThrows(
        () => qualifyPatchBranchSpec("br:/main/task001"),
        "br:/<branch>@<repository>@<server>",
        "Expected unqualified branch selector without an exact workspace repository to be rejected before execution",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/task001" }),
        ["patch", "br:/main/task001"],
        "Expected one-spec patch command",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/moved-item-fixture", destination: "br:/main" }),
        ["patch", "br:/main/moved-item-fixture", "br:/main"],
        "Moved-item fixture selectors must reach cm patch unchanged; the backend determines whether its output is move-aware or delete/add",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/task001", clean: true }),
        ["patch", "br:/main/task001", "--clean"],
        "Expected clean flag to be included",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/task001", integration: true }),
        ["patch", "br:/main/task001", "--integration"],
        "Expected integration flag to be included",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/task001", clean: true, integration: true }),
        ["patch", "br:/main/task001", "--clean", "--integration"],
        "Expected clean and integration flags in stable order",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "cs:2", destination: "cs:4", output: "review.patch" }),
        ["patch", "cs:2", "cs:4", "--output=review.patch"],
        "Expected destination before output flag",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/task001", toolPath: "C:\\gnu\\diff.exe" }),
        ["patch", "br:/main/task001", "--tool=C:\\gnu\\diff.exe"],
        "Expected custom diff tool path flag",
    );

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/task001", clean: false, integration: false }),
        ["patch", "br:/main/task001"],
        "Expected false booleans to be omitted",
    );

    assertThrows(
        () => buildPatchCommandArgs({ source: "" }),
        "source must be non-empty",
        "Expected blank source to be rejected",
    );

    assertThrows(
        () => buildPatchCommandArgs({ source: "br:/main/task001", destination: "   " }),
        "destination must be non-empty",
        "Expected blank destination to be rejected",
    );

    assertThrows(
        () => buildPatchCommandArgs({ source: "br:/main/task001", output: "   " }),
        "output must be non-empty",
        "Expected blank output to be rejected",
    );

    assertThrows(
        () => buildPatchCommandArgs({ source: "br:/main/task001", toolPath: "   " }),
        "toolPath must be non-empty",
        "Expected blank toolPath to be rejected",
    );

    const allArgs = buildPatchCommandArgs({
        source: "br:/main/task001",
        destination: "br:/main",
        output: "review.patch",
        toolPath: "C:\\gnu\\diff.exe",
        clean: true,
        integration: true,
    });
    assert(!allArgs.some((arg) => arg === "--apply" || arg.startsWith("--apply=")), "Patch generation helper must not emit --apply.");

    const root = await mkdtemp(join(tmpdir(), "pi-plastic-patch-"));
    try
    {
        const plasticDirectory = join(root, ".plastic");
        await mkdir(plasticDirectory);
        await writeFile(join(plasticDirectory, "plastic.workspace"), "workspace marker\n");
        await writeFile(join(plasticDirectory, "plastic.selector"), `repository ${workspaceRepository}\n  smartbranch /main\n`);
        const resolvedBranches = await resolvePatchBranchSpecs({ source: "br:/main/pi-plastic-edge-20260801", destination: "br:/main" }, root);
        assert(resolvedBranches.source === `br:/main/pi-plastic-edge-20260801@${workspaceRepository}` && resolvedBranches.destination === `br:/main@${workspaceRepository}`, "Expected patch branch resolution to use the exact space-containing current workspace selector repository.");
        const alreadyQualified = await resolvePatchBranchSpecs({ source: "br:/main/pi-plastic-edge-20260801@Other Repository@other-server" }, join(root, "missing-workspace"));
        assert(alreadyQualified.source === "br:/main/pi-plastic-edge-20260801@Other Repository@other-server", "Expected an explicitly qualified selector to bypass workspace repository resolution unchanged.");
        await resolvePatchBranchSpecs({ source: "br:/main/topic" }, join(root, "missing-workspace")).then(
            () => { throw new Error("Expected unavailable workspace branch qualification to reject."); },
            (error: unknown) => assert(error instanceof Error && error.message.includes("repository-qualified syntax"), "Expected actionable repository-qualified branch syntax guidance."),
        );

        const output = join(root, "review.patch");
        await runPatchOutputTransaction(output, async (stagingOutput) =>
        {
            await writeFile(stagingOutput, "patch bytes\n");
        });
        assert((await readFile(output, "utf8")) === "patch bytes\n", "Expected completed staging output to publish at the requested path.");
        assert((await readdir(root)).filter((name) => name !== ".plastic").join(",") === "review.patch", "Expected successful publication to remove package-owned staging files.");

        let existingOutputGeneratorRan = false;
        await runPatchOutputTransaction(output, async () =>
        {
            existingOutputGeneratorRan = true;
        }).then(
            () => { throw new Error("Expected existing requested output to be rejected."); },
            (error: unknown) => assert(error instanceof Error && error.message.includes("Refusing to overwrite"), "Expected existing output rejection before patch generation."),
        );
        assert(!existingOutputGeneratorRan, "Existing output must be rejected before cm patch generation could run.");

        const failedOutput = join(root, "failed.patch");
        await runPatchOutputTransaction(failedOutput, async (stagingOutput) =>
        {
            await writeFile(stagingOutput, "");
            throw new Error("simulated cm patch failure");
        }).then(
            () => { throw new Error("Expected failed patch generation to reject."); },
            () => undefined,
        );
        assert((await readdir(root)).filter((name) => name !== ".plastic").join(",") === "review.patch", "Expected failed patch generation to remove zero-byte staging artifacts without publishing output.");

        // An explicit output is transactional: unlike an omitted output's
        // reportable empty result, a zero-byte file cannot safely distinguish
        // an empty patch from a failed/truncated backend write.
        const emptyOutput = join(root, "empty.patch");
        await runPatchOutputTransaction(emptyOutput, async (stagingOutput) =>
        {
            await writeFile(stagingOutput, "");
        }).then(
            () => { throw new Error("Expected zero-byte explicit patch output to be rejected."); },
            (error: unknown) => assert(error instanceof Error && error.message.includes("Refusing to publish an empty patch output"), "Expected zero-byte publication to explain why no requested output was created."),
        );
        await readFile(emptyOutput).then(
            () => { throw new Error("Expected zero-byte staging output not to publish."); },
            (error: unknown) => assert((error as NodeJS.ErrnoException).code === "ENOENT", "Expected rejected zero-byte output to leave no destination."),
        );

        // fs.link is the publication primitive: if another writer creates the
        // requested name after preflight, the generated staging file must not
        // replace it. This exercises the real local filesystem race contract.
        const racedOutput = join(root, "raced output ü.patch");
        await runPatchOutputTransaction(racedOutput, async (stagingOutput) =>
        {
            await writeFile(stagingOutput, "generated patch bytes\n");
            await writeFile(racedOutput, "concurrent writer bytes\n");
        }).then(
            () => { throw new Error("Expected a publication race to reject."); },
            (error: unknown) => assert(error instanceof Error && error.message.includes("Refusing to overwrite"), "Expected a raced destination to be rejected rather than overwritten."),
        );
        assert((await readFile(racedOutput, "utf8")) === "concurrent writer bytes\n", "Expected atomic no-overwrite publication to preserve concurrent destination bytes.");
        assert(!(await readdir(root)).some((name) => name.startsWith(".pi-plastic-patch-")), "Expected all package-owned staging directories to be removed after failed publication.");

        let missingParentGeneratorRan = false;
        await runPatchOutputTransaction(join(root, "missing parent", "review.patch"), async () =>
        {
            missingParentGeneratorRan = true;
        }).then(
            () => { throw new Error("Expected a missing output parent to reject before generation."); },
            (error: unknown) => assert(error instanceof Error && error.message.includes("Ensure its parent directory exists and is writable"), "Expected missing parent diagnostics to be actionable."),
        );
        assert(!missingParentGeneratorRan, "A missing output parent must be rejected before backend generation.");
    }
    finally
    {
        await rm(root, { recursive: true, force: true });
    }

    console.log("PASS: plastic patch command tests succeeded");
};

void main();
