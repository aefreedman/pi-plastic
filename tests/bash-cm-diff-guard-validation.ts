import { __bashCmDiffGuardInternals } from "../extensions/bash-cm-diff-guard.ts";

const assert = (condition: boolean, message: string): void =>
{
    if (!condition)
    {
        throw new Error(message);
    }
};

const expectBlocked = (command: string): void =>
{
    assert(
        __bashCmDiffGuardInternals.commandRunsCmDiff(command),
        `Expected command to be blocked: ${command}`,
    );
};

const expectAllowed = (command: string): void =>
{
    assert(
        !__bashCmDiffGuardInternals.commandRunsCmDiff(command),
        `Expected command to be allowed: ${command}`,
    );
};

const main = (): void =>
{
    expectBlocked("cm diff cs:123");
    expectBlocked("env FOO=bar cm diff cs:123");
    expectBlocked("command cm diff cs:123");
    expectBlocked("sudo cm diff cs:123");
    expectBlocked("time cm diff cs:123");
    expectBlocked("nice -n 5 cm diff cs:123");
    expectBlocked("zsh -lc \"cm diff cs:123\"");
    expectBlocked("zsh -c \"cm diff cs:123\"");
    expectBlocked("zsh -lc \"command cm diff cs:123\"");
    expectBlocked("bash -lc \"env FOO=bar cm diff cs:123\"");
    expectBlocked("cmd /c \"cm diff cs:123\"");
    expectBlocked("pwsh -command \"cm diff cs:123\"");

    expectAllowed("cm status");
    expectAllowed("cm merge br:/main");
    expectAllowed("git diff --stat");
    expectAllowed("zsh -lc \"cm status\"");

    console.log("PASS: bash cm diff guard validation succeeded");
};

main();
