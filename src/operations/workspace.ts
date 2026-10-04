import { tool } from "../tool-definition";
import { assembleWorkspaceListObservation, presentWorkspaceListObservation } from "./workspace-list";
import { workdirArg } from "./arguments";
import { assembleUpdateReceipt, presentUpdateReceipt } from "./update-receipt";
import { assembleAddReceipt, presentAddReceipt } from "./add-receipt";
import { assembleUndoReceipt, presentUndoReceipt } from "./undo-receipt";
import { runCm } from "../execution/cm";
import { outputFormatArg } from "../presentation/results";
import { assembleRemovalReceipt, presentRemovalReceipt } from "./removal-receipt";

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
        const receipt = await assembleAddReceipt(args);
        const text = presentAddReceipt(receipt);
        if (!receipt.ok) throw new Error(text);
        return text;
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
        const receipt = await assembleUndoReceipt(args);
        const text = presentUndoReceipt(receipt);
        if (!receipt.ok) throw new Error(text);
        return text;
    },
});

export const resolveDeleteChangeConflict = tool({
    description: "Request source-side deletion for a Plastic SCM delete/change conflict via cm remove; actual resolution remains unverified.",
    args: {
        paths: tool.schema.array(tool.schema.string()).min(1).describe("Controlled workspace paths to resolve by accepting the source-side deletion."),
        keepOnDisk: tool.schema.boolean().optional().describe("Request --nodisk to retain items on disk. Defaults to true; preservation remains unverified."),
        preflight: tool.schema.boolean().optional().describe("Preview the resolution command without executing it."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {

        const receipt = await assembleRemovalReceipt(args);
        const text = presentRemovalReceipt(receipt);
        if (!receipt.ok) throw new Error(text);
        return text;
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
