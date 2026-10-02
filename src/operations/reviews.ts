import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { runCm } from "../execution/cm";
import { outputFormatArg } from "../presentation/results";
import { executeCodeReviewFind } from "./code-review-find";

export const codeReviewCreate = tool({
    description: "Create a code review (cm codereview).",
    args: {
        target: tool.schema.string().min(1).describe("Review target spec (branch, changeset, or shelveset spec)."),
        title: tool.schema.string().min(1).describe("Code review title."),
        status: tool.schema.string().optional().describe("Initial review status."),
        assignee: tool.schema.string().optional().describe("Initial review assignee."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        format: tool.schema.string().optional().describe("Format string for creation output."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["codereview", args.target, args.title];

        if (args.status)
        {
            cmdArgs.push(`--status=${args.status}`);
        }

        if (args.assignee)
        {
            cmdArgs.push(`--assignee=${args.assignee}`);
        }

        if (args.repository)
        {
            cmdArgs.push(`--repository=${args.repository}`);
        }

        if (args.format)
        {
            cmdArgs.push(`--format=${args.format}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const codeReviewUpdate = tool({
    description: "Update an existing code review (cm codereview -e).",
    args: {
        id: tool.schema.string().min(1).describe("Code review id or GUID."),
        status: tool.schema.string().optional().describe("Updated review status."),
        assignee: tool.schema.string().optional().describe("Updated review assignee."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["codereview", "-e", args.id];

        if (args.status)
        {
            cmdArgs.push(`--status=${args.status}`);
        }

        if (args.assignee)
        {
            cmdArgs.push(`--assignee=${args.assignee}`);
        }

        if (args.repository)
        {
            cmdArgs.push(`--repository=${args.repository}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const codeReviewDelete = tool({
    description: "Delete one or more code reviews (cm codereview -d).",
    args: {
        ids: tool.schema.array(tool.schema.string()).min(1).describe("Code review IDs or GUIDs to delete."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["codereview", "-d", ...args.ids];

        if (args.repository)
        {
            cmdArgs.push(`--repository=${args.repository}`);
        }

        return runCm(cmdArgs, args.workdir);
    },
});

export const codeReviewFind = tool({
    description: "Find code reviews with filters using cm find review.",
    args: {
        status: tool.schema.string().optional().describe("Filter by review status."),
        assignee: tool.schema.string().optional().describe("Filter by review assignee."),
        owner: tool.schema.string().optional().describe("Filter by review owner."),
        target: tool.schema.string().optional().describe("Filter by review target branch/changeset spec."),
        targetType: tool.schema.enum(["branch", "changeset"]).optional().describe("Filter by review target type."),
        titleLike: tool.schema.string().optional().describe("Filter by title pattern (supports % wildcard)."),
        source: tool.schema.enum(["native", "ids"]).optional().describe("Native output (default) or one canonical review-ID query."),
        maxItems: tool.schema.number().int().min(1).max(500).optional().describe("Projected record cap (default 100); separate from CLI limit."),
        limit: tool.schema.number().int().min(1).optional().describe("Maximum number of reviews to return."),
        orderBy: tool.schema.enum(["date", "modifieddate", "status"]).optional().describe("Sort field for review queries."),
        descending: tool.schema.boolean().optional().describe("Sort descending when true."),
        format: tool.schema.string().optional().describe("Format string for query output."),
        dateFormat: tool.schema.string().optional().describe("Date format for query output."),
        output: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        return executeCodeReviewFind(args);
    },
});
