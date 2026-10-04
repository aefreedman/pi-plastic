import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { runCm } from "../execution/cm";
import { executeShelvesetList } from "./shelveset-list";
import { assembleObjectDeleteReceipt, presentObjectDeleteReceipt } from "./object-delete-receipt";
import { outputFormatArg } from "../presentation/results";

export const shelvesetCreate = tool({
    description: "Create a shelveset (cm shelveset create).",
    args: {
        comment: tool.schema.string().optional().describe("Shelveset comment."),
        commentsFile: tool.schema.string().optional().describe("File path containing shelveset comment."),
        paths: tool.schema.array(tool.schema.string()).optional().describe("Optional item paths to shelve."),
        all: tool.schema.boolean().optional().describe("Include changed, moved, and deleted items."),
        dependencies: tool.schema.boolean().optional().describe("Include local change dependencies."),
        summaryFormat: tool.schema.boolean().optional().describe("Print only created shelveset spec for automation."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        if (args.comment && args.commentsFile)
        {
            throw new Error("Provide either comment or commentsFile, not both.");
        }

        if (args.comment !== undefined && args.comment.trim().length === 0)
        {
            throw new Error("Comment must be non-empty when provided.");
        }

        const cmdArgs: string[] = ["shelveset", "create"];

        if (args.paths && args.paths.length > 0)
        {
            cmdArgs.push(...args.paths);
        }

        if (args.all)
        {
            cmdArgs.push("--all");
        }

        if (args.dependencies)
        {
            cmdArgs.push("--dependencies");
        }

        if (args.summaryFormat)
        {
            cmdArgs.push("--summaryformat");
        }

        if (args.comment)
        {
            cmdArgs.push(`-c=${args.comment}`);
        }

        if (args.commentsFile)
        {
            cmdArgs.push(`-commentsfile=${args.commentsFile}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const shelvesetApply = tool({
    description: "Apply a shelveset (cm shelveset apply).",
    args: {
        shelveset: tool.schema.string().min(1).describe("Shelveset spec to apply (for example, sh:3)."),
        changePaths: tool.schema.array(tool.schema.string()).optional().describe("Optional shelve server paths to apply."),
        preview: tool.schema.boolean().optional().describe("Preview changes without applying them."),
        dontCheckout: tool.schema.boolean().optional().describe("Keep applied changes as local modifications without checkout."),
        comparisonMethod: tool.schema.enum([
            "ignoreeol",
            "ignorewhitespaces",
            "ignoreeolandwhitespaces",
            "recognizeall",
        ]).optional().describe("Comparison method used when applying changes."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["shelveset", "apply", args.shelveset];

        if (args.changePaths && args.changePaths.length > 0)
        {
            cmdArgs.push(...args.changePaths);
        }

        if (args.preview)
        {
            cmdArgs.push("--preview");
        }

        if (args.dontCheckout)
        {
            cmdArgs.push("--dontcheckout");
        }

        if (args.comparisonMethod)
        {
            cmdArgs.push(`--comparisonmethod=${args.comparisonMethod}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const shelvesetDelete = tool({
    description: "Delete a shelveset (cm shelveset delete).",
    args: {
        shelveset: tool.schema.string().min(1).describe("Shelveset spec to delete (for example, sh:3)."),
        preflight: tool.schema.boolean().optional().describe("Command-only zero-CLI preview; no existence/readiness analysis."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const request = Object.freeze({...args});
        const dto = await assembleObjectDeleteReceipt("shelveset-delete",request);
        const result = presentObjectDeleteReceipt(dto);
        if (!dto.ok && request.preflight !== true) throw new Error(result);
        return result;
    },
});

export const shelvesetList = tool({
    description: "List shelvesets using cm find shelve.",
    args: {
        owner: tool.schema.string().optional().describe("Filter by shelveset owner."),
        commentLike: tool.schema.string().optional().describe("Filter by shelveset comment pattern (supports % wildcard)."),
        limit: tool.schema.number().int().min(1).optional().describe("Maximum number of shelvesets to return."),
        dateFrom: tool.schema.string().optional().describe("Filter shelvesets created on or after this date/date constant."),
        source: tool.schema.enum(["native", "ids"]).optional().describe("Native output (default) or one canonical shelveset-ID query."),
        output: tool.schema.enum(["text", "json"]).optional().describe("Presentation only; does not change query source."),
        maxItems: tool.schema.number().int().min(1).max(500).optional().describe("Projected record cap (default 100); separate from CLI limit."),
        format: tool.schema.string().optional().describe("Format string for query output; conflicts with ids source."),
        dateFormat: tool.schema.string().optional().describe("Date format for query output."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        return executeShelvesetList(args);
    },
});
