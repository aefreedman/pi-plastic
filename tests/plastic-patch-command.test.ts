import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __plasticPatchInternals } from "../src/operations/patch.ts";

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
    const { buildPatchCommandArgs, qualifyPatchBranchSpec, resolvePatchBranchSpecs, runPatchOutputTransaction, PATCH_MOVE_REPRESENTATION } = __plasticPatchInternals;
    assert(PATCH_MOVE_REPRESENTATION === "unverified", "Native rename support does not prove the representation of an individual patch.");

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
        "Moved-item fixture selectors must reach cm patch unchanged; individual rename representation is not proven by command construction",
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
        buildPatchCommandArgs({ source: "br:/main/task001", includeBinaries: true }),
        ["patch", "br:/main/task001", "--include-binaries"],
        "Expected native raw binary hunk flag",
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

    const allArgs = buildPatchCommandArgs({
        source: "br:/main/task001",
        destination: "br:/main",
        output: "review.patch",
        includeBinaries: true,
        clean: true,
        integration: true,
    });
    assert(!allArgs.some((arg) => arg.startsWith("--apply") || arg.startsWith("--tool")), "Native generation must not emit application flags.");
    assertArgs(allArgs, ["patch", "br:/main/task001", "br:/main", "--output=review.patch", "--clean", "--integration", "--include-binaries"], "Expected native generation argv in stable order");

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
