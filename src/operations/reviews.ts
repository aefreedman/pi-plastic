import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { assembleObjectWriteReceipt, presentObjectWriteReceipt } from "./object-write-receipt";
import { outputFormatArg } from "../presentation/results";
import { executeCodeReviewFind } from "./code-review-find";
import { assembleObjectDeleteReceipt, presentObjectDeleteReceipt } from "./object-delete-receipt";

export const codeReviewCreate = tool({
    description: "Create a code review (cm codereview).",
    args: {
        target: tool.schema.string().min(1).describe("Review target spec (branch, changeset, or shelveset spec)."),
        title: tool.schema.string().min(1).describe("Code review title."),
        status: tool.schema.string().optional().describe("Initial review status."),
        assignee: tool.schema.string().optional().describe("Initial review assignee."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        format: tool.schema.string().optional().describe("Format string for creation output."),
        preflight: tool.schema.boolean().optional().describe("Command-only zero-CLI preview; no existence/conflict/state analysis."),
        output: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args) {
        const dto = await assembleObjectWriteReceipt("code-review-create", Object.freeze({...args}));
        const result = presentObjectWriteReceipt(dto);
        if (!dto.ok) throw new Error(result);
        return result;
    },
});

export const codeReviewUpdate = tool({
    description: "Update an existing code review (cm codereview -e).",
    args: {
        id: tool.schema.string().min(1).describe("Code review id or GUID."),
        status: tool.schema.string().optional().describe("Updated review status."),
        assignee: tool.schema.string().optional().describe("Updated review assignee."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        preflight: tool.schema.boolean().optional().describe("Command-only zero-CLI preview; no existence/conflict/state analysis."),
        output: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args) {
        const dto = await assembleObjectWriteReceipt("code-review-update", Object.freeze({...args}));
        const result = presentObjectWriteReceipt(dto);
        if (!dto.ok) throw new Error(result);
        return result;
    },
});

export const codeReviewDelete = tool({
    description: "Delete one or more code reviews (cm codereview -d).",
    args: {
        ids: tool.schema.array(tool.schema.string()).min(1).describe("Code review IDs or GUIDs to delete."),
        repository: tool.schema.string().optional().describe("Repository specification when no workspace is used."),
        preflight: tool.schema.boolean().optional().describe("Command-only zero-CLI preview; no existence/readiness analysis."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const request = Object.freeze({...args});
        const dto = await assembleObjectDeleteReceipt("code-review-delete",request);
        const result = presentObjectDeleteReceipt(dto);
        if (!dto.ok && request.preflight !== true) throw new Error(result);
        return result;
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
