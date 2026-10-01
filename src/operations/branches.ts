import { getBranchLeafName, resolveBranchCreationTarget, normalizeBranchSpecForComparison, resolveCurrentBranchName, cmWhereLike, cmWhereEquals, isSameBranchSpec } from "../domain/branches";
import { parsePlasticStatusBranch } from "../plastic-workspace";
import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { runCm, runCmRaw, normalizeFindOutputLines } from "../execution/cm";
import { outputFormatArg, toStructuredResult } from "../presentation/results";

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
        if (args.branch.trim().length === 0)
        {
            throw new Error("Branch must be non-empty.");
        }

        if (args.changeset && args.label)
        {
            throw new Error("Provide either changeset or label, not both.");
        }

        if (args.comment && args.commentsFile)
        {
            throw new Error("Provide either comment or commentsFile, not both.");
        }

        if (args.comment !== undefined && args.comment.trim().length === 0)
        {
            throw new Error("Comment must be non-empty when provided.");
        }

        const normalizedRequested = normalizeBranchSpecForComparison(args.branch);
        const needsParent = !normalizedRequested.startsWith("/");
        const parentBranch = needsParent
            ? args.parent ?? await resolveCurrentBranchName(args.workdir)
            : args.parent;
        const targetBranch = resolveBranchCreationTarget(args.branch, parentBranch, args.allowRootBranch);
        const cmdArgs: string[] = ["branch", "create", targetBranch];

        if (args.changeset)
        {
            cmdArgs.push(`--changeset=${args.changeset}`);
        }

        if (args.label)
        {
            cmdArgs.push(`--label=${args.label}`);
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

export const currentBranch = tool({
    description: "Get the current Plastic SCM branch from workspace status output.",
    args: {
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const branch = await resolveCurrentBranchName(args.workdir);
        return toStructuredResult(
            "current-branch",
            format,
            branch,
            {
                branch,
            },
            args.workdir,
        );
    },
});

export const branchList = tool({
    description: "List Plastic SCM branches using cm find branch with optional filters.",
    args: {
        nameLike: tool.schema.string().optional().describe("Filter by branch name pattern (supports % wildcard)."),
        parent: tool.schema.string().optional().describe("Filter by parent branch spec."),
        owner: tool.schema.string().optional().describe("Filter by branch owner."),
        includeHidden: tool.schema.boolean().optional().describe("Include hidden branches in the query result."),
        limit: tool.schema.number().int().min(1).optional().describe("Maximum number of branches to return."),
        orderBy: tool.schema.enum(["date", "branchname"]).optional().describe("Sort field for branch queries."),
        descending: tool.schema.boolean().optional().describe("Sort descending when true."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const whereClauses: string[] = [];

        if (args.nameLike)
        {
            whereClauses.push(cmWhereLike("name", args.nameLike));
        }

        if (args.parent)
        {
            whereClauses.push(cmWhereEquals("parent", args.parent));
        }

        if (args.owner)
        {
            whereClauses.push(cmWhereEquals("owner", args.owner));
        }

        if (args.includeHidden !== true)
        {
            whereClauses.push("hidden = 'false'");
        }
        else
        {
            whereClauses.push("(hidden = 'true' or hidden = 'false')");
        }

        const cmdArgs: string[] = ["find", "branch"];
        if (whereClauses.length > 0)
        {
            cmdArgs.push(`where ${whereClauses.join(" and ")}`);
        }

        if (args.orderBy)
        {
            cmdArgs.push(`order by ${args.orderBy}${args.descending ? " desc" : " asc"}`);
        }

        if (args.limit)
        {
            cmdArgs.push(`limit ${args.limit}`);
        }

        cmdArgs.push("--nototal");
        return runCm(cmdArgs, args.workdir);
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
        // Plastic's `name` query field contains only the leaf segment even though
        // `{name}` renders the full branch path. Query by leaf, then compare the
        // returned full paths so identical leaf names under other parents do not
        // produce a false positive.
        const output = await runCmRaw([
            "find",
            "branch",
            `where ${cmWhereEquals("name", getBranchLeafName(args.branch))}`,
            "--format={name}",
            "--nototal",
        ], args.workdir);
        const exists = normalizeFindOutputLines(output).some((branch) => isSameBranchSpec(branch, args.branch));
        return exists ? "true" : "false";
    },
});

export const branchDelete = tool({
    description: "Delete a Plastic SCM branch (cm branch delete).",
    args: {
        branch: tool.schema.string().min(1).describe("Branch spec to delete."),
        deleteChangesets: tool.schema.boolean().optional().describe("Delete changesets inside the branch when required."),
        workdir: workdirArg,
    },
    async execute(args)
    {
        const cmdArgs: string[] = ["branch", "delete", args.branch];

        if (args.deleteChangesets)
        {
            cmdArgs.push("--delete-changesets");
        }

        return runCm(cmdArgs, args.workdir);
    },
});
