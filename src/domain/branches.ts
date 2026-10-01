import { runCmRaw, normalizeFindOutputLines } from "../execution/cm";
import { parsePlasticStatusBranch } from "../plastic-workspace";
import { normalizeErrorMessage } from "./merge-output";

export const normalizeBranchSpecForComparison = (branch: string): string =>
{
    const trimmed = branch.trim();
    const withoutPrefix = trimmed.replace(/^br:/i, "");
    const withoutRepository = withoutPrefix.split("@")[0] ?? withoutPrefix;
    return withoutRepository.replace(/\\/g, "/");
};

export const isSameBranchSpec = (left: string, right: string): boolean =>
{
    return normalizeBranchSpecForComparison(left) === normalizeBranchSpecForComparison(right);
};

export const assertWorkspaceOnBranch = (actualBranch: string, expectedBranch: string, phase: string): void =>
{
    if (isSameBranchSpec(actualBranch, expectedBranch))
    {
        return;
    }

    throw new Error([
        `Plastic workspace branch mismatch after ${phase}.`,
        `Expected target: ${expectedBranch}`,
        `Actual branch: ${actualBranch}`,
        "The requested merge/checkin was not completed on the target branch.",
        "Do not switch branches and assume the changeset moved; Plastic changesets remain on the branch where they were created. Inspect branch history and retry the merge from the actual target branch.",
    ].join("\n"));
};

export const getBranchLeafName = (branch: string): string =>
{
    const normalized = normalizeBranchSpecForComparison(branch);
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    return segments.at(-1) ?? normalized;
};

export const resolveBranchCreationTarget = (
    requestedBranch: string,
    parentBranch?: string,
    allowRootBranch = false,
): string =>
{
    const requested = requestedBranch.trim();
    const normalizedRequested = normalizeBranchSpecForComparison(requested);

    if (normalizedRequested.length === 0)
    {
        throw new Error("Branch must be non-empty.");
    }

    if (!normalizedRequested.startsWith("/"))
    {
        if (!parentBranch)
        {
            throw new Error("A relative branch name requires a parent branch.");
        }

        const normalizedParent = normalizeBranchSpecForComparison(parentBranch).replace(/\/$/, "");
        if (!normalizedParent.startsWith("/") || normalizedParent === "/")
        {
            throw new Error(`Parent branch must be a hierarchical branch path, received ${parentBranch}.`);
        }
        return `${normalizedParent}/${normalizedRequested}`;
    }

    const segments = normalizedRequested.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 1 && !allowRootBranch)
    {
        throw new Error(
            `Refusing to create top-level branch ${requested}. ` +
            "Create <parent-branch>/<new-branch>, pass parent with a relative branch name, " +
            "or set allowRootBranch=true when top-level branch creation is intentional.",
        );
    }

    return requested;
};

export const escapeCmWhereValue = (value: string): string => value.replace(/\\/g, "\\\\").replace(/'/g, "''");
export const cmWhereEquals = (field: string, value: string): string => `${field} = '${escapeCmWhereValue(value)}'`;
export const cmWhereLike = (field: string, value: string): string => `${field} like '${escapeCmWhereValue(value)}'`;
export const listRecentBranchNames = async (workdir?: string, limit = 200): Promise<string[]> =>
{
    const output = await runCmRaw([
        "find",
        "branch",
        `order by date desc limit ${limit}`,
        "--format={name}",
        "--nototal",
    ], workdir);
    return normalizeFindOutputLines(output);
};

export type BranchParentLookupOutcome =
    | { kind: "resolved"; branch: string; parent: string }
    | { kind: "root"; branch: string; matchedBranch: string }
    | { kind: "not-found"; branch: string; attemptedCandidates: string[] }
    | { kind: "malformed-output"; branch: string; attemptedCandidates: string[]; diagnostics: string[] }
    | { kind: "command-failed"; branch: string; attemptedCandidates: string[]; diagnostics: string[] };

export type BranchParentRow = { name: string; parent?: string };

export const parseBranchParentRows = (output: string): BranchParentRow[] | undefined =>
{
    const lines = normalizeFindOutputLines(output);
    const rows: BranchParentRow[] = [];
    for (const line of lines)
    {
        const separator = line.indexOf("|");
        if (separator <= 0 || line.indexOf("|", separator + 1) !== -1)
        {
            return undefined;
        }
        const name = line.slice(0, separator).trim();
        const parent = line.slice(separator + 1).trim();
        if (!name)
        {
            return undefined;
        }
        rows.push({ name, ...(parent ? { parent } : {}) });
    }
    return rows;
};

export const branchRepositoryQualifier = (branch: string): string | undefined =>
{
    const match = branch.trim().match(/^(?:br:)?[^@]+(@.+)$/);
    return match?.[1];
};

export const branchRepositorySpec = (branch: string): string | undefined =>
{
    const qualifier = branchRepositoryQualifier(branch);
    return qualifier?.slice(1);
};

export const branchNameForLookup = (branch: string): string => normalizeBranchSpecForComparison(branch);

export const qualifyBranchName = (branchName: string, requestedBranch: string): string =>
{
    const qualifier = branchRepositoryQualifier(requestedBranch);
    return qualifier && !branchName.includes("@") ? `${branchName}${qualifier}` : branchName;
};

export const resolveBranchParentName = async (branch: string, workdir?: string): Promise<BranchParentLookupOutcome> =>
{
    const requestedBranch = branch.trim();
    // A qualified selector is identity-bearing input; never strip its repository/server.
    const lookupBranchName = branchNameForLookup(requestedBranch);
    const candidates = Array.from(new Set(
        (requestedBranch.includes("@")
            ? [lookupBranchName]
            : [requestedBranch, lookupBranchName, `br:${lookupBranchName}`])
            .filter((candidate) => candidate.length > 0),
    ));
    const diagnostics: string[] = [];
    const repositorySpec = branchRepositorySpec(requestedBranch);
    const repositoryClause = repositorySpec
        ? ` on repository '${repositorySpec.replace(/'/g, "''")}'`
        : "";

    for (const candidate of candidates)
    {
        try
        {
            const output = await runCmRaw([
                "find",
                "branch",
                `where ${cmWhereEquals("name", candidate)}${repositoryClause}`,
                "--format={name}|{parent}",
                "--nototal",
            ], workdir);
            const rows = parseBranchParentRows(output);
            if (!rows || rows.length > 1)
            {
                return {
                    kind: "malformed-output",
                    branch: requestedBranch,
                    attemptedCandidates: candidates,
                    diagnostics: [`Expected one name|parent row, received ${rows ? rows.length : "malformed"}.`],
                };
            }
            const row = rows[0];
            if (row && branchNameForLookup(row.name) !== lookupBranchName)
            {
                return {
                    kind: "malformed-output",
                    branch: requestedBranch,
                    attemptedCandidates: candidates,
                    diagnostics: ["Returned branch identity did not match the requested branch name."],
                };
            }
            if (row?.parent)
            {
                return {
                    kind: "resolved",
                    branch: qualifyBranchName(row.name, requestedBranch),
                    parent: qualifyBranchName(row.parent, requestedBranch),
                };
            }
            if (row)
            {
                return { kind: "root", branch: requestedBranch, matchedBranch: qualifyBranchName(row.name, requestedBranch) };
            }
        }
        catch (error)
        {
            diagnostics.push(normalizeErrorMessage(error).slice(0, 256));
        }
    }

    if (diagnostics.length > 0)
    {
        return { kind: "command-failed", branch: requestedBranch, attemptedCandidates: candidates, diagnostics: diagnostics.slice(0, 3) };
    }

    return { kind: "not-found", branch: requestedBranch, attemptedCandidates: candidates };
};

export const resolveCurrentBranchName = async (workdir?: string): Promise<string> =>
{
    const statusOutput = await runCmRaw(["status"], workdir);
    const statusBranch = parsePlasticStatusBranch(statusOutput);
    if (statusBranch.kind === "found" && statusBranch.value.branch)
    {
        return statusBranch.value.branch;
    }

    const compactOutput = await runCmRaw(["status", "--compact"], workdir);
    const compactBranch = parsePlasticStatusBranch(compactOutput);
    if (compactBranch.kind === "found" && compactBranch.value.branch)
    {
        return compactBranch.value.branch;
    }

    if (compactBranch.kind === "found" && compactBranch.value.changesetId)
    {
        const changesetBranchOutput = await runCmRaw([
            "find",
            "changeset",
            `where changesetid=${compactBranch.value.changesetId}`,
            "--format={branch}",
            "--nototal",
        ], workdir);
        const branchLines = normalizeFindOutputLines(changesetBranchOutput);
        if (branchLines.length > 0)
        {
            return branchLines[0];
        }
    }

    const trimmed = compactOutput.trim();
    if (trimmed.length === 0)
    {
        throw new Error("Unable to determine current branch from empty status output.");
    }

    throw new Error(`Unable to parse current branch from status output: ${trimmed}`);
};

