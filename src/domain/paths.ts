import { promises as fs, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from "path";

export const isWindowsStyleAbsolutePath = (absolutePath: string): boolean => /^[A-Za-z]:\//.test(absolutePath) || absolutePath.startsWith("//");

export const toNormalizedAbsolutePath = (pathValue: string, cwd: string): string =>
{
    const normalizedPathValue = pathValue.replace(/\\/g, "/");
    const normalizedCwd = cwd.replace(/\\/g, "/");
    if (isWindowsStyleAbsolutePath(normalizedPathValue))
    {
        return win32.normalize(normalizedPathValue).replace(/\\/g, "/");
    }

    if (isWindowsStyleAbsolutePath(normalizedCwd))
    {
        return win32.resolve(normalizedCwd, normalizedPathValue).replace(/\\/g, "/");
    }

    const absolutePath = isAbsolute(pathValue) ? resolve(pathValue) : resolve(cwd, pathValue);
    return absolutePath.replace(/\\/g, "/");
};

export const darwinVolumeCaseSensitivity = new Map<string, boolean>();
export const isSameFilesystemDevice = (volumeDevice: number | bigint, candidateDevice: number | bigint): boolean =>
    volumeDevice === candidateDevice;

export const findCanonicalExistingAncestor = (absolutePath: string): string | null =>
{
    let candidate = absolutePath;
    while (true)
    {
        try
        {
            return realpathSync.native(candidate).replace(/\\/g, "/");
        }
        catch
        {
            const parent = dirname(candidate);
            if (parent === candidate)
            {
                return null;
            }

            candidate = parent;
        }
    }
};

export const toFilesystemIdentityPath = async (absolutePath: string): Promise<string> =>
{
    let candidate = absolutePath;
    const missingSegments: string[] = [];
    while (true)
    {
        try
        {
            const canonicalAncestor = (await fs.realpath(candidate)).replace(/\\/g, "/");
            return missingSegments.reduce((identityPath, segment) => join(identityPath, segment), canonicalAncestor).replace(/\\/g, "/");
        }
        catch (error)
        {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "ENOTDIR")
            {
                throw error;
            }

            const parent = dirname(candidate);
            if (parent === candidate)
            {
                throw error;
            }

            missingSegments.unshift(basename(candidate));
            candidate = parent;
        }
    }
};

export const toggleFirstAsciiLetterCase = (value: string): string | null =>
{
    const index = value.search(/[A-Za-z]/);
    if (index < 0)
    {
        return null;
    }

    const letter = value[index];
    const toggled = letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase();
    return `${value.slice(0, index)}${toggled}${value.slice(index + 1)}`;
};

// APFS may be formatted case-sensitive or case-insensitive, so Darwin must probe the
// canonical existing ancestor on the target volume instead of assuming a platform policy.
export const isDarwinCaseInsensitiveVolume = (absolutePath: string): boolean =>
{
    const canonicalAncestor = findCanonicalExistingAncestor(absolutePath);
    if (!canonicalAncestor)
    {
        return false;
    }

    try
    {
        const volumeDevice = statSync(canonicalAncestor).dev;
        const volumeKey = String(volumeDevice);
        const cached = darwinVolumeCaseSensitivity.get(volumeKey);
        if (cached !== undefined)
        {
            return cached;
        }

        let probePath = canonicalAncestor;
        while (true)
        {
            const parent = dirname(probePath);
            if (parent === probePath)
            {
                darwinVolumeCaseSensitivity.set(volumeKey, false);
                return false;
            }

            // A mount point's parent belongs to a different filesystem. Do not
            // infer the mounted volume's case policy from the parent/root volume.
            if (!isSameFilesystemDevice(volumeDevice, statSync(parent).dev))
            {
                darwinVolumeCaseSensitivity.set(volumeKey, false);
                return false;
            }

            const alternateName = toggleFirstAsciiLetterCase(probePath.slice(parent.length + 1));
            if (alternateName)
            {
                try
                {
                    const canonicalAlternate = realpathSync.native(join(parent, alternateName)).replace(/\\/g, "/");
                    const isCaseInsensitive = canonicalAlternate === probePath;
                    darwinVolumeCaseSensitivity.set(volumeKey, isCaseInsensitive);
                    return isCaseInsensitive;
                }
                catch
                {
                    darwinVolumeCaseSensitivity.set(volumeKey, false);
                    return false;
                }
            }

            probePath = parent;
        }
    }
    catch
    {
        // A failed probe must preserve distinct paths rather than risk conflating files.
        return false;
    }
};

export type PathComparisonPolicy = {
    platform?: NodeJS.Platform;
    isDarwinCaseInsensitiveVolume?: (absolutePath: string) => boolean;
};

export const toPathComparisonKeyFromAbsolutePath = (absolutePath: string, policy: PathComparisonPolicy = {}): string =>
{
    const normalizedPath = absolutePath.replace(/\\/g, "/");
    // Keep Windows and UNC behavior regardless of the host platform, including when parsing
    // status captured from a Windows workspace on another machine.
    if (isWindowsStyleAbsolutePath(normalizedPath))
    {
        return normalizedPath.toLowerCase();
    }

    if ((policy.platform ?? process.platform) === "darwin"
        && (policy.isDarwinCaseInsensitiveVolume ?? isDarwinCaseInsensitiveVolume)(normalizedPath))
    {
        return normalizedPath.toLowerCase();
    }

    return normalizedPath;
};

export const toPathComparisonKey = (pathValue: string, cwd: string): string => toPathComparisonKeyFromAbsolutePath(toNormalizedAbsolutePath(pathValue, cwd));

export const toCommandPath = (absolutePath: string, cwd: string): string =>
{
    const relativePath = isWindowsStyleAbsolutePath(absolutePath.replace(/\\/g, "/"))
        && isWindowsStyleAbsolutePath(cwd.replace(/\\/g, "/"))
        ? win32.relative(cwd, absolutePath)
        : relative(cwd, absolutePath);
    if (relativePath.length === 0)
    {
        return ".";
    }

    if (relativePath.startsWith(".."))
    {
        return absolutePath;
    }

    return relativePath;
};

export const isWithinPathScope = (candidatePath: string, scopePath: string): boolean =>
{
    if (candidatePath === scopePath)
    {
        return true;
    }

    return candidatePath.startsWith(`${scopePath}/`);
};

export const dedupeAndMinimizeAbsolutePaths = (absolutePaths: string[]): string[] =>
{
    const uniquePaths: string[] = [];
    const seenComparisonKeys = new Set<string>();
    for (const path of absolutePaths)
    {
        const comparisonKey = toPathComparisonKeyFromAbsolutePath(path);
        if (seenComparisonKeys.has(comparisonKey))
        {
            continue;
        }

        seenComparisonKeys.add(comparisonKey);
        uniquePaths.push(path);
    }

    const sortedPaths = uniquePaths.sort((left, right) => left.length - right.length);
    const minimizedPaths: string[] = [];
    const minimizedComparisonKeys: string[] = [];

    for (const path of sortedPaths)
    {
        const comparisonKey = toPathComparisonKeyFromAbsolutePath(path);
        if (minimizedComparisonKeys.some((scopePath) => isWithinPathScope(comparisonKey, scopePath)))
        {
            continue;
        }

        minimizedPaths.push(path);
        minimizedComparisonKeys.push(comparisonKey);
    }

    return minimizedPaths;
};

export const buildFallbackScopePaths = (absolutePaths: string[], cwd: string): string[] =>
{
    const fallbackAbsolutePaths = absolutePaths.map((path) => toNormalizedAbsolutePath(dirname(path), cwd));
    return dedupeAndMinimizeAbsolutePaths(fallbackAbsolutePaths).map((path) => toCommandPath(path, cwd));
};
