import { runCmRaw, normalizeFindOutputLines } from "./cm";

let cachedCmVersion: string | null = null;
let cmVersionPromise: Promise<string> | null = null;

export const getCmVersion = async (workdir?: string): Promise<string> =>
{
    if (cachedCmVersion)
    {
        return cachedCmVersion;
    }

    if (!cmVersionPromise)
    {
        cmVersionPromise = runCmRaw(["version"], workdir)
            .then((value) =>
            {
                const parsed = normalizeFindOutputLines(value)[0] ?? "unknown";
                cachedCmVersion = parsed;
                cmVersionPromise = null;
                return parsed;
            })
            .catch(() =>
            {
                cmVersionPromise = null;
                return "unknown";
            });
    }

    return cmVersionPromise;
};
