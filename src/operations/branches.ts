import { assembleBranchCreateReceipt } from "./branch-create";
import { presentBranchCreateReceipt } from "../presentation/branch-create";
import { assembleBranchListObservation, presentBranchListObservation, branchListPayload } from "./branch-list";
import { assembleCurrentBranchObservation, assembleBranchExistsObservation, presentCurrentBranchObservation, presentBranchExistsObservation } from "./branch-reads";
import { getBranchLeafName, resolveBranchCreationTarget } from "../domain/branches";
import { parsePlasticStatusBranch } from "../plastic-workspace";
import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { assembleBranchDeleteReceipt, presentBranchDeleteReceipt } from "./branch-delete-receipt";
import { outputFormatArg } from "../presentation/results";

export const __plasticBranchInternals = {
    getBranchLeafName,
    parsePlasticStatusBranch,
    resolveBranchCreationTarget,
};

// Capture enough subprocess output for diagnostics while keeping the default
// agent-facing response intentionally small. Callers may opt into a larger
// focused response, but never the full capture bound.

export const branchCreate = tool({
    description: "Create a hierarchical Plastic SCM branch, guarding rare top-level branch creation (cm branch create).",
    args: {
        branch: tool.schema.string().min(1).describe("Relative new-branch name or full hierarchical branch path. A relative name uses parent, or the current branch when parent is omitted."),
        parent: tool.schema.string().optional().describe("Parent branch for a relative branch name. May differ from the workspace branch; Plastic uses the parent's latest changeset by default."),
        changeset: tool.schema.string().optional().describe("Changeset used as the starting point instead of the parent branch's latest changeset."),
        label: tool.schema.string().optional().describe("Label used as the starting point."),
        comment: tool.schema.string().optional().describe("Optional branch comment."),
        commentsFile: tool.schema.string().optional().describe("File path containing the branch comment."),
        allowRootBranch: tool.schema.boolean().optional().describe("Allow intentional top-level branch creation such as /<new-branch>. Defaults to false."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const dto = await assembleBranchCreateReceipt(args);
        if (!dto.ok && dto.error.stage === "input") throw new Error(dto.error.message);
        return presentBranchCreateReceipt(dto);
    },
});

export const currentBranch = tool({
    description: "Get the current Plastic SCM branch from workspace status output.",
    args: {
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        return presentCurrentBranchObservation(await assembleCurrentBranchObservation(args), args);
    },
});

export const branchList = tool({
    description: "List Plastic SCM branches using cm find branch with optional filters.",
    args: {
        source: tool.schema.enum(["native", "names"]).optional().describe("Observation source. Defaults to native table; names selects strict UTF-8 reusable branch rows."),
        format: outputFormatArg,
        maxItems: tool.schema.number().int().min(1).max(500).optional().describe("Canonical projection rows (default 100); independent of the CLI query limit. Native rows are unavailable."),
        nameLike: tool.schema.string().optional().describe("Filter by branch leaf-name pattern (supports % wildcard); bounded to 4096 code units."),
        parent: tool.schema.string().optional().describe("Requested parent branch filter, bounded to 4096 code units; repository qualifiers are not verified."),
        owner: tool.schema.string().optional().describe("Filter by branch owner; bounded to 4096 code units."),
        includeHidden: tool.schema.boolean().optional().describe("Legacy hidden query policy. True is unsupported for names and rejected before execution."),
        limit: tool.schema.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().describe("CLI query row limit; not a repository total or projection limit."),
        orderBy: tool.schema.enum(["date", "branchname"]).optional().describe("Sort field for branch queries."),
        descending: tool.schema.boolean().optional().describe("Sort descending when true."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const observation = await assembleBranchListObservation(args);
        // Enforce compact projection bounds for canonical and JSON core calls;
        // default native text remains the legacy table/string route.
        if (args.source === "names" || args.format === "json") {
            const dto = branchListPayload(observation);
            if (args.format === "json") return JSON.stringify(dto);
        }
        return presentBranchListObservation(observation);
    },
});

export const branchExists = tool({
    description: "Check whether a branch exists using cm find branch.",
    args: {
        branch: tool.schema.string().min(1).describe("Branch name to check."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        return presentBranchExistsObservation(await assembleBranchExistsObservation(args));
    },
});

export const branchDelete = tool({
    description: "Delete a Plastic SCM branch (cm branch delete).",
    args: {
        branch: tool.schema.string().min(1).describe("Branch spec to delete."),
        deleteChangesets: tool.schema.boolean().optional().describe("Delete changesets inside the branch when required; completion does not prove history deletion."),
        preflight: tool.schema.boolean().optional().describe("Command-only preview, no CLI or branch/readiness analysis."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const dto = await assembleBranchDeleteReceipt(args);
        const result = presentBranchDeleteReceipt(dto);
        if (!dto.ok && args.preflight !== true) throw new Error(result);
        return args.format === "json" ? JSON.stringify(dto) : result;
    },
});
