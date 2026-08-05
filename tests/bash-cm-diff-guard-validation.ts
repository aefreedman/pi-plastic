import bashCmDiffGuard, { __bashCmDiffGuardInternals } from "../extensions/bash-cm-diff-guard.ts";

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

const main = async (): Promise<void> =>
{
    assert(/plastic_status.*plastic_diffFile.*plastic_workspaceDiff.*plastic_diffRevisions/.test(__bashCmDiffGuardInternals.blockMessage), "Expected cm diff guard guidance to route listing, one-file, pending-review, and historical-pair requests to safe tools.");
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
    expectBlocked("cmd /c cm diff cs:123");
    expectBlocked("pwsh -command \"cm diff cs:123\"");
    expectBlocked("powershell -command cm diff cs:123");
    expectBlocked("cm differences cs:123");
    expectBlocked("cm 'diff' cs:123");
    expectBlocked("call cm diff cs:123");
    expectBlocked("start cm diff cs:123");
    expectBlocked("start \"\" /wait cm diff cs:123");
    expectBlocked("start \"Plastic diff\" /wait cm diff cs:123");
    expectBlocked("cmd /s /c cm diff cs:123");
    expectBlocked("cmd /v:on /d /s /c cm diff cs:123");
    expectBlocked("cmd /d /s /c \"cm differences cs:123\"");
    expectBlocked("pwsh -c cm diff cs:123");
    expectBlocked("pwsh -NoProfile -Command cm diff cs:123");
    expectBlocked("powershell -NoLogo -ExecutionPolicy Bypass -Command \"cm diff cs:123\"");
    expectBlocked("powershell -command \"Start-Process cm -ArgumentList 'diff','cs:123'\"");
    expectBlocked("powershell -command \"start cm -ArgumentList 'differences','cs:123'\"");
    expectBlocked("powershell -command \"iex 'cm diff cs:123'\"");
    expectBlocked("cmd /c cm d^iff cs:123");
    expectBlocked("\"cm.exe\" diff cs:123");
    expectBlocked("\"C:\\Program Files\\PlasticSCM5\\client\\cm.exe\" diff cs:123");
    expectBlocked("cm status & cm diff cs:123");
    expectBlocked("cm status\ncm diff cs:123");

    expectAllowed("cm status");
    expectAllowed("cm merge br:/main");
    expectAllowed("git diff --stat");
    expectAllowed("zsh -lc \"cm status\"");
    expectAllowed("printf 'cm diff is unsafe\\n'");

    let toolCallHandler: ((event: any, ctx: any) => Promise<unknown>) | undefined;
    let userBashHandler: ((event: any, ctx: any) => Promise<unknown>) | undefined;
    bashCmDiffGuard({
        on(event: string, handler: (event: any, ctx: any) => Promise<unknown>) {
            if (event === "tool_call") toolCallHandler = handler;
            if (event === "user_bash") userBashHandler = handler;
        },
    } as any);
    assert(typeof toolCallHandler === "function", "Expected the extension to register its runtime tool_call guard.");
    const runtimeResult = await toolCallHandler!(
        { toolName: "bash", input: { command: "cm differences cs:123" } },
        { hasUI: false, ui: { notify() {} } },
    );
    assert((runtimeResult as { block?: boolean })?.block === true, "Expected the actual runtime tool_call handler to block the Plastic diff alias.");
    const nonBashResult = await toolCallHandler!(
        { toolName: "read", input: { path: "cm diff" } },
        { hasUI: false, ui: { notify() {} } },
    );
    assert(nonBashResult === undefined, "Expected the runtime guard to ignore non-bash tools.");
    assert(typeof userBashHandler === "function", "Expected the extension to register its runtime user_bash guard.");
    const userBashResult = await userBashHandler!(
        { command: "cmd /s /c cm diff cs:123", excludeFromContext: false, cwd: process.cwd() },
        { hasUI: false, ui: { notify() {} } },
    );
    assert((userBashResult as { result?: { exitCode?: number } })?.result?.exitCode === 1, "Expected direct !/!! shell commands to be rejected without execution.");

    console.log("PASS: bash cm diff guard validation succeeded");
};

await main();
