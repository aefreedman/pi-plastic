import { parseCodeReviewsXml, type CodeReviewXmlRow } from "../domain/code-review-xml";
import { captureNativeMutation } from "../execution/native-mutation-command";
import { tool } from "../tool-definition";

const subcommands = ["create", "edit", "delete", "comment", "reviewer", "review", "subscribe", "unsubscribe", "subscription", "merge"] as const;
type Subcommand = typeof subcommands[number];

type CommandResult = {
    ok: boolean;
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    truncated: boolean;
    error: string | null;
};
type MergeRequestRow = Pick<CodeReviewXmlRow, "id" | "guid" | "title" | "target" | "destination" | "mergeRequestStatusName" | "codeReviewStatusName">;
type FindResult = CommandResult & { rows: MergeRequestRow[] | null };

function rejected(error: string): CommandResult {
    return { ok: false, exitCode: null, stdout: null, stderr: null, truncated: false, error };
}

async function run(argv: string[], workdir: string | undefined, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
    if (workdir !== undefined && (typeof workdir !== "string" || !workdir.trim() || workdir.includes("\0"))) {
        return rejected("Expected a valid working directory.");
    }
    if (Buffer.byteLength(JSON.stringify(argv), "utf8") > 32768) return rejected("Arguments exceed the execution byte budget.");
    const { attempt, capture, stdout, stderr } = await captureNativeMutation(argv, workdir, undefined, undefined, env);
    const error = attempt.aborted ? "Native command cancelled; effects may remain."
        : attempt.timedOut ? "Native command timed out; effects may remain."
        : attempt.state === "not-started" ? "Could not start cm."
        : !capture.complete ? "Native command or UTF-8 output could not be observed completely."
        : attempt.exitCode !== 0 ? "Native command failed; inspect its output before taking another action."
        : null;
    return { ok: error === null, exitCode: attempt.exitCode, stdout, stderr, truncated: capture.truncated, error };
}

export async function runMergeRequest(input: { subcommand?: unknown; args?: unknown; workdir?: string }): Promise<CommandResult> {
    const { subcommand, args, workdir } = input;
    if (!subcommands.includes(subcommand as Subcommand) || !Array.isArray(args) || !Array.from(args).every(arg => typeof arg === "string" && !arg.includes("\0"))) {
        return rejected("Expected a native merge-request subcommand and a string argument array.");
    }
    if (args.some((arg, index) => /^--?(?:commentsfile|descriptionfile)=\s*-\s*$/i.test(arg)
        || /^--?(?:commentsfile|descriptionfile)$/i.test(arg) && args[index + 1]?.trim() === "-")) {
        return rejected("Standard-input operands are not supported.");
    }
    // Native merge and discussion commands can launch PLASTICEDITOR. Keep the
    // parent's environment intact and let cm take its native no-editor path.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PLASTICEDITOR"));
    return run(["mergerequest", subcommand as Subcommand, ...args], workdir, env);
}

export async function findMergeRequests({ query, workdir }: { query?: unknown; workdir?: string }): Promise<FindResult> {
    // A single native find clause, not a CLI option (in particular, no output file).
    if (query !== undefined && (typeof query !== "string" || query.includes("\0")
        || !/^(?:where|on\s+repositor(?:y|ies)|order\s+by|limit|offset)(?:\s|$)/i.test(query.trimStart()))) {
        return { ...rejected("Supply one native find clause, not CLI options."), rows: null };
    }
    const result = await run(["find", "mergerequest", ...(query === undefined ? [] : [query]), "--xml", "--encoding=utf-8"], workdir);
    if (!result.ok) return { ...result, rows: null };
    if (result.truncated) return { ...result, ok: false, rows: null, error: "Find output exceeded the capture limit. Narrow the native query." };
    try {
        const rows = parseCodeReviewsXml(result.stdout ?? "").map(({ id, guid, title, target, destination, mergeRequestStatusName, codeReviewStatusName }) => (
            { id, guid, title, target, destination, mergeRequestStatusName, codeReviewStatusName }
        ));
        return { ...result, stdout: null, rows };
    } catch {
        return { ...result, ok: false, rows: null, error: "Could not read merge requests from native XML." };
    }
}

export function presentMergeRequest(result: CommandResult | FindResult): string {
    const rows = "rows" in result ? result.rows : null;
    return [
        rows ? `${rows.length} merge request${rows.length === 1 ? "" : "s"} returned` : `Merge request command: ${result.exitCode === null ? "no observed exit code" : `exit ${result.exitCode}`}`,
        ...(rows?.map(row => `${row.id}: ${row.title} — ${row.target} → ${row.destination}; ${row.mergeRequestStatusName} / ${row.codeReviewStatusName}`) ?? []),
        result.error && `Error: ${result.error}`,
        result.truncated && "Warning: Native output truncated.",
        result.stdout,
        result.stderr,
    ].filter(Boolean).join("\n");
}

async function coreText(result: Promise<CommandResult | FindResult>): Promise<string> {
    const observed = await result;
    const text = presentMergeRequest(observed);
    if (!observed.ok) throw new Error(text);
    return text;
}

export const mergeRequestFind = tool({
    description: "Find Unity VCS merge requests in native XML (CM 11.0.16.10694+). Returns IDs, native branch selectors, and separate merge-request and review statuses.",
    args: {
        query: tool.schema.string().optional().describe("A single native cm find clause, e.g. where id=1367 or where reviewer='me' limit 20. No CLI options."),
        workdir: tool.schema.string().optional().describe("Working directory for the command."),
    },
    execute: args => coreText(findMergeRequests(args)),
});

export const mergeRequest = tool({
    description: "Run one native cm mergerequest subcommand (CM 11.0.16.10694+). Can mutate reviews or merge branches. merge <id> analyzes; merge <id> --merge applies. Reports native completion and output, not verified effects.",
    args: {
        subcommand: tool.schema.enum(subcommands).describe("Native subcommand. Use args=['--help'] for its syntax."),
        args: tool.schema.array(tool.schema.string()).describe("Native operands/options in order, one string per argument, without shell quotes. For example: ['add', '1367', '-c=Looks good'] with subcommand='comment'. Stdin is not supported."),
        workdir: tool.schema.string().optional().describe("Working directory for the command."),
    },
    execute: args => coreText(runMergeRequest(args)),
});
