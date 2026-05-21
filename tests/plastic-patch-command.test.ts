import { __plasticPatchInternals } from "../src/plastic-core.ts";

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

const main = (): void =>
{
    const { buildPatchCommandArgs } = __plasticPatchInternals;

    assertArgs(
        buildPatchCommandArgs({ source: "br:/main/task001" }),
        ["patch", "br:/main/task001"],
        "Expected one-spec patch command",
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

    console.log("PASS: plastic patch command tests succeeded");
};

main();
