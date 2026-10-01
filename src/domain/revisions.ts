import { promises as fs } from "node:fs";
import { dirname } from "path";
import { runCmRaw } from "../execution/cm";
import { discoverPlasticWorkspace } from "../plastic-workspace";
import { toNormalizedAbsolutePath, toFilesystemIdentityPath, toPathComparisonKeyFromAbsolutePath, isWithinPathScope } from "./paths";
import { PendingItem } from "./pending";

export const isRevisionNotFoundError = (message: string): boolean =>
{
    const normalized = message.toLowerCase();
    return normalized.includes("the specified revision was not found");
};

export const isGlobalRevisionSpec = (revision: string): boolean =>
{
    const normalized = revision.toLowerCase();
    return normalized.startsWith("rev:")
        || normalized.startsWith("revid:")
        || normalized.startsWith("itemid:")
        || normalized.startsWith("serverpath:");
};

export const isItemSelectorRevisionSpec = (revision: string): boolean =>
{
    const normalized = revision.toLowerCase();
    return /^\d+$/.test(revision)
        || normalized.startsWith("cs:")
        || normalized.startsWith("br:")
        || normalized.startsWith("lb:");
};

export type DiffFileRevisionResolution = {
    supplied: string | null;
    kind: "workspace-base" | "changeset" | "branch" | "label" | "global-revision" | "file-qualified";
    resolved: string;
};

export const resolveDiffFileRevision = (pathForRevision: string, revision?: string): DiffFileRevisionResolution =>
{
    const normalizedPath = pathForRevision.trim();
    const normalizedRevision = revision?.trim() ?? "";
    if (!normalizedPath)
    {
        throw new Error("path must identify a workspace file.");
    }

    // A bare item path is the unambiguous common case: cm cat resolves the
    // workspace's loaded/base revision without asking agents to guess a revspec.
    if (!normalizedRevision)
    {
        return { supplied: null, kind: "workspace-base", resolved: normalizedPath };
    }

    const lowerRevision = normalizedRevision.toLowerCase();
    if (lowerRevision === "base" || lowerRevision === "head" || lowerRevision === "cs:head" || /^cs:br:/i.test(normalizedRevision))
    {
        throw new Error(
            `Unsupported revision '${revision}'. Omit revision for the workspace base, or use a changeset number/cs:<number>, br:/<branch>, lb:<label>, a file-qualified '<path>#<selector>', or a global revid:/rev: spec.`,
        );
    }

    if (normalizedRevision.includes("#"))
    {
        return { supplied: normalizedRevision, kind: "file-qualified", resolved: normalizedRevision };
    }

    if (isGlobalRevisionSpec(normalizedRevision))
    {
        return { supplied: normalizedRevision, kind: "global-revision", resolved: normalizedRevision };
    }

    if (/^\d+$/.test(normalizedRevision) || /^cs:\d+$/i.test(normalizedRevision))
    {
        const selector = /^\d+$/.test(normalizedRevision) ? `cs:${normalizedRevision}` : normalizedRevision;
        return { supplied: normalizedRevision, kind: "changeset", resolved: `${normalizedPath}#${selector}` };
    }

    if (/^br:\/.+/i.test(normalizedRevision))
    {
        return { supplied: normalizedRevision, kind: "branch", resolved: `${normalizedPath}#${normalizedRevision}` };
    }

    if (/^lb:[^\s#]+/i.test(normalizedRevision))
    {
        return { supplied: normalizedRevision, kind: "label", resolved: `${normalizedPath}#${normalizedRevision}` };
    }

    throw new Error(
        `Unsupported revision '${revision}'. Omit revision for the workspace base, or use a changeset number/cs:<number>, br:/<branch>, lb:<label>, a file-qualified '<path>#<selector>', or a global revid:/rev: spec.`,
    );
};

// Kept as a small compatibility seam for older focused tests and consumers.
export const normalizeDiffFileRevisionSpec = (pathForRevision: string, revision: string): string =>
    resolveDiffFileRevision(pathForRevision, revision).resolved;

export const isValidGlobalRevisionSpec = (revision: string): boolean =>
    /^(?:rev|revid|itemid|serverpath):\S+$/i.test(revision.trim());

export const isValidFileQualifiedRevisionSpec = (revision: string): boolean =>
{
    const normalized = revision.trim();
    const separator = normalized.lastIndexOf("#");
    if (separator <= 0 || separator === normalized.length - 1)
    {
        return false;
    }

    const selector = normalized.slice(separator + 1);
    return /^cs:\d+$/i.test(selector)
        || /^br:\/.+/i.test(selector)
        || /^lb:[^\s#]+$/i.test(selector)
        || isValidGlobalRevisionSpec(selector);
};

export const isValidDiffRevisionSpec = (revision: string): boolean =>
    isValidGlobalRevisionSpec(revision) || isValidFileQualifiedRevisionSpec(revision);

export const isUnscopedDiffRevisionSpec = (revision: string): boolean => !isValidDiffRevisionSpec(revision);

export const extractBranchSelectorFromRevision = (revision: string): string | null =>
{
    const match = revision.match(/(?:^|#)(br:[^\s#]+)/i);
    if (!match)
    {
        return null;
    }

    const selector = (match[1] ?? "").trim();
    return selector.length > 0 ? selector : null;
};

export const extractBranchNameFromSelector = (branchSelector: string): string | null =>
{
    const normalized = branchSelector.trim().replace(/^br:/i, "");
    if (!normalized)
    {
        return null;
    }

    const atIndex = normalized.indexOf("@");
    const branchName = atIndex >= 0 ? normalized.slice(0, atIndex).trim() : normalized.trim();
    return branchName.length > 0 ? branchName : null;
};

export type PendingBaseIdentityResolver = {
    resolve: (item: PendingItem) => Promise<string>;
};

export type RepositoryIdentity = {
    repository: string;
    server: string;
};

export const parseRepositoryIdentity = (selector: string | undefined): RepositoryIdentity | null =>
{
    if (!selector || /[\u0000-\u001f\u007f]/.test(selector))
    {
        return null;
    }
    // Repository names cannot contain @; cloud server names can (for example,
    // an organization-qualified cloud endpoint), so split only at the first @.
    const separator = selector.indexOf("@");
    if (separator <= 0 || separator === selector.length - 1)
    {
        return null;
    }
    return { repository: selector.slice(0, separator), server: selector.slice(separator + 1) };
};

export const parseRepositorySelector = (output: string): RepositoryIdentity | null =>
{
    const match = output.match(/^\s*(?:repository|rep)\s+(?:"([^"]+)"|(\S+))\s*$/mi);
    return parseRepositoryIdentity(match?.[1] ?? match?.[2]);
};

export const parseXlinkRepositorySelector = (output: string): RepositoryIdentity | null =>
{
    // `cm xlink --show` reports wxlink:<serverpath>@<loaded-revision>@<repository>@<server>.
    const match = output.match(/^.+?\s+-->\s+wxlink:.+?@(?:\d+|cs:\d+)@(.+)\s*$/mi);
    return parseRepositoryIdentity(match?.[1]?.trim());
};

export const isNotXlinkError = (error: unknown): boolean => /\bis not an xlink\.?\s*$/i.test(error instanceof Error ? error.message.trim() : String(error).trim());

export const createPendingBaseIdentityResolver = (cwd: string, workdir?: string): PendingBaseIdentityResolver =>
{
    let workspaceRoot: Promise<string> | undefined;
    const getWorkspaceRoot = (): Promise<string> =>
    {
        workspaceRoot ??= discoverPlasticWorkspace(cwd).then((outcome) =>
        {
            if (outcome.kind !== "found")
            {
                throw new Error(`Plastic cannot determine the workspace root for pending base resolution: ${outcome.kind === "unavailable" ? outcome.reason : "no workspace marker found"}.`);
            }
            return toNormalizedAbsolutePath(outcome.value.root, cwd);
        });
        return workspaceRoot;
    };
    const xlinkLookups = new Map<string, Promise<RepositoryIdentity | null>>();
    let workspaceRepository: Promise<RepositoryIdentity> | undefined;
    const getWorkspaceRepository = (): Promise<RepositoryIdentity> =>
    {
        workspaceRepository ??= runCmRaw(["showselector"], workdir).then((output) =>
        {
            const repository = parseRepositorySelector(output);
            if (!repository)
            {
                throw new Error("Plastic returned no repository/server identity for this workspace.");
            }
            return repository;
        });
        return workspaceRepository;
    };
    const getXlinkRepository = async (candidate: string): Promise<RepositoryIdentity | null> =>
    {
        // Use the physical identity for cache keys, but keep candidate lexical for cm.
        const key = toPathComparisonKeyFromAbsolutePath(await toFilesystemIdentityPath(candidate));
        let lookup = xlinkLookups.get(key);
        if (!lookup)
        {
            lookup = runCmRaw(["xlink", "--show", candidate], workdir)
                .then((output) =>
                {
                    const repository = parseXlinkRepositorySelector(output);
                    if (!repository)
                    {
                        throw new Error(`Plastic returned malformed Xlink ownership for '${candidate}'.`);
                    }
                    return repository;
                })
                .catch((error) =>
                {
                    if (isNotXlinkError(error))
                    {
                        return null;
                    }
                    throw error;
                });
            xlinkLookups.set(key, lookup);
        }
        return lookup;
    };

    return {
        async resolve(item)
        {
            if (!item.revisionId)
            {
                throw new Error(`Plastic status did not provide a base revision ID for '${item.workspacePath}'.`);
            }
            const root = await getWorkspaceRoot();
            const rootIdentity = await toFilesystemIdentityPath(root);
            const ownershipPath = item.kind === "moved" && item.sourceWorkspacePath
                ? toNormalizedAbsolutePath(item.sourceWorkspacePath, cwd)
                : item.normalizedPath;
            if (!isWithinPathScope(
                toPathComparisonKeyFromAbsolutePath(await toFilesystemIdentityPath(ownershipPath)),
                toPathComparisonKeyFromAbsolutePath(rootIdentity),
            ))
            {
                throw new Error(`Plastic cannot resolve an owning repository for '${item.workspacePath}' outside the requested workspace.`);
            }
            let candidate = dirname(ownershipPath);
            while (isWithinPathScope(
                toPathComparisonKeyFromAbsolutePath(await toFilesystemIdentityPath(candidate)),
                toPathComparisonKeyFromAbsolutePath(rootIdentity),
            ))
            {
                // The workspace root belongs to its selector; cm rejects Xlink queries there.
                if (toPathComparisonKeyFromAbsolutePath(await toFilesystemIdentityPath(candidate))
                    === toPathComparisonKeyFromAbsolutePath(rootIdentity))
                {
                    break;
                }
                // A missing ancestor can be a removed Xlink mount. Status does not
                // retain ownership, so parent-repository fallback would be unsafe.
                if ((item.kind === "deleted" || item.kind === "moved") && !(await fs.stat(candidate).catch(() => null)))
                {
                    throw new Error(`Plastic cannot resolve the owning repository for '${item.workspacePath}' because an ownership ancestor is missing.`);
                }
                const repository = await getXlinkRepository(candidate);
                if (repository)
                {
                    item.baseRepository = `${repository.repository}@${repository.server}`;
                    return `revid:${item.revisionId}@rep:${repository.repository}@repserver:${repository.server}`;
                }
                const parent = dirname(candidate);
                if (parent === candidate)
                {
                    break;
                }
                candidate = parent;
            }
            const repository = await getWorkspaceRepository();
            item.baseRepository = `${repository.repository}@${repository.server}`;
            return `revid:${item.revisionId}@rep:${repository.repository}@repserver:${repository.server}`;
        },
    };
};

