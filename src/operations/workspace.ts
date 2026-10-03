import { tool } from "../tool-definition";
import { assembleWorkspaceListObservation, presentWorkspaceListObservation } from "./workspace-list";
import { workdirArg } from "./arguments";
import { assembleUpdateReceipt, presentUpdateReceipt } from "./update-receipt";
import { runCm, runCmRaw } from "../execution/cm";
import { outputFormatArg, toStructuredResult, formatPreflightText } from "../presentation/results";
import { summarizeShortStatus } from "../domain/pending";

export const update = tool({
    description: "Update workspace safely without launching interactive merge (cm update --dontmerge --noinput).",
    args: {
        workdir: workdirArg,
    },
    async execute(args)
    {
        const receipt = await assembleUpdateReceipt(args);
        const text = presentUpdateReceipt(receipt);
        if (!receipt.ok) throw new Error(text);
        return text;
    },
});

export const add = tool({
    description: "Add items to Plastic SCM (cm add).",
    args: {
        paths: tool.schema.array(tool.schema.string()).min(1).describe("Paths to add."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        return runCm(["add", ...args.paths], args.workdir);
    },
});

export const undo = tool({
    description: "Undo changes for specified items (cm undo).",
    args: {
        paths: tool.schema.array(tool.schema.string()).min(1).describe("Paths to undo."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        return runCm(["undo", ...args.paths], args.workdir);
    },
});

export const resolveDeleteChangeConflict = tool({
    description: "Resolve a Plastic SCM delete/change conflict by accepting the source-side deletion with cm remove.",
    args: {
        paths: tool.schema.array(tool.schema.string()).min(1).describe("Controlled workspace paths to resolve by accepting the source-side deletion."),
        keepOnDisk: tool.schema.boolean().optional().describe("Keep removed items on disk as private files via --nodisk. Defaults to true."),
        preflight: tool.schema.boolean().optional().describe("Preview the resolution command without executing it."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const keepOnDisk = args.keepOnDisk ?? true;
        const preflight = args.preflight ?? false;
        const cmdArgs = ["remove", ...(keepOnDisk ? ["--nodisk"] : []), ...args.paths];

        if (preflight)
        {
            return toStructuredResult(
                "resolve-delete-change-conflict-preflight",
                format,
                formatPreflightText("## Delete/Change Conflict Resolution Preflight", [
                    "- Would run: yes",
                    "- Resolution: accept source-side deletion",
                    `- Keep removed items on disk: ${keepOnDisk ? "yes (--nodisk)" : "no"}`,
                    `- Command: cm ${cmdArgs.join(" ")}`,
                ]),
                {
                    wouldRun: true,
                    resolution: "accept-source-deletion",
                    keepOnDisk,
                    command: ["cm", ...cmdArgs],
                    paths: args.paths,
                },
                args.workdir,
            );
        }

        const output = await runCm(cmdArgs, args.workdir);
        const shortStatusAfterResolution = await runCmRaw(["status", "--short"], args.workdir).catch(() => "");
        const pendingSummaryAfterResolution = summarizeShortStatus(shortStatusAfterResolution);
        const reportLines = [
            "## Delete/Change Conflict Resolution Result",
            "",
            "- Resolution: accepted source-side deletion",
            `- Keep removed items on disk: ${keepOnDisk ? "yes (--nodisk)" : "no"}`,
            `- Paths resolved: ${args.paths.length}`,
            `- Pending items after resolution: ${pendingSummaryAfterResolution.totalPending}`,
        ];

        if (output.trim().length > 0 && output.trim() !== "(no output)")
        {
            reportLines.push("", "Raw command output:", output.trim());
        }

        return toStructuredResult(
            "resolve-delete-change-conflict",
            format,
            reportLines.join("\n"),
            {
                resolution: "accept-source-deletion",
                keepOnDisk,
                command: ["cm", ...cmdArgs],
                paths: args.paths,
                shortStatusAfterResolution,
                pendingSummaryAfterResolution,
                rawOutput: output,
            },
            args.workdir,
            keepOnDisk ? ["Removed items were kept on disk as private files via --nodisk."] : undefined,
            "Rerun plastic_merge(...) for the original source branch to continue the merge.",
        );
    },
});

export const workspaceCreate = tool({
    description: "Create a Plastic SCM workspace (cm workspace create).",
    args: {
        name: tool.schema.string().min(1).describe("Workspace name."),
        path: tool.schema.string().min(1).describe("Workspace path."),
        repositorySpec: tool.schema.string().optional().describe("Optional repository specification for the new workspace."),
        selectorFile: tool.schema.string().optional().describe("Optional selector file path for the new workspace."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        if (args.repositorySpec && args.selectorFile)
        {
            throw new Error("Provide either repositorySpec or selectorFile, not both.");
        }

        const cmdArgs: string[] = ["workspace", "create", args.name, args.path];

        if (args.repositorySpec)
        {
            cmdArgs.push(args.repositorySpec);
        }

        if (args.selectorFile)
        {
            cmdArgs.push(`--selector=${args.selectorFile}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const workspaceList = tool({
    description: "List Plastic SCM workspaces (cm workspace list).",
    args: {
        format: tool.schema.string().optional().describe("Native CLI template (up to 4096 code units), not a presentation enum. Conflicts with fields source unless empty."),
        source: tool.schema.enum(["native", "fields"]).optional().describe("Defaults to native. Fields requires independently known ASCII-only original workspace names and paths; formatter may silently best-fit non-ASCII to ASCII."),
        maxItems: tool.schema.number().int().min(1).max(500).optional().describe("Fields projection limit, default 100; not a CLI query limit."),
        output: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const observation = await assembleWorkspaceListObservation(args);
        return presentWorkspaceListObservation(observation, args);
    },
});
