import { discoverPlasticWorkspace, parsePlasticSelector } from "../plastic-workspace";
import { promises as fs } from "node:fs";
import { join, dirname } from "path";
import { isUtf8 } from "node:buffer";
import { constants } from "node:fs";

// Native generation supports renames; this is not proof about an observed patch.
export const PATCH_MOVE_REPRESENTATION = "unverified" as const;

export type PatchCommandArgs = {
    source: string;
    destination?: string;
    output?: string;
    includeBinaries?: boolean;
    clean?: boolean;
    integration?: boolean;
};

export const assertRequiredPatchValue = (name: keyof PatchCommandArgs, value: string | undefined): void =>
{
    if (value === undefined || value.trim().length === 0)
    {
        throw new Error(`${name} must be non-empty.`);
    }
};

export const assertNonBlankPatchValue = (name: keyof PatchCommandArgs, value: string | undefined): void =>
{
    if (value !== undefined && value.trim().length === 0)
    {
        throw new Error(`${name} must be non-empty when provided.`);
    }
};

export type ResolvedPatchBranchSpecs = Pick<PatchCommandArgs, "source" | "destination">;

// Repository selectors are a single cm argv value, so spaces within a repository
// name are not shell separators. Require non-empty @-separated components without
// edge whitespace, while retaining Plastic's valid internal spaces and punctuation.

export const isSafePatchRepositorySelector = (repository: string | undefined): repository is string =>
{
    if (!repository || repository !== repository.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(repository))
    {
        return false;
    }

    return repository.split("@").every((component) => /^[^@\s](?:[^@]*[^@\s])?$/.test(component));
};

export const qualifyPatchBranchSpec = (branchSpec: string, repository?: string): string =>
{
    const normalizedBranchSpec = branchSpec.trim();
    if (!/^br:\/.+/i.test(normalizedBranchSpec) || normalizedBranchSpec.includes("@"))
    {
        return normalizedBranchSpec;
    }

    if (!isSafePatchRepositorySelector(repository))
    {
        throw new Error(
            `Cannot safely qualify unqualified branch selector '${normalizedBranchSpec}' against this workspace. Use the exact repository-qualified syntax 'br:/<branch>@<repository>@<server>'.`,
        );
    }

    return `${normalizedBranchSpec}@${repository}`;
};

export const resolvePatchBranchSpecs = async (args: PatchCommandArgs, cwd: string): Promise<ResolvedPatchBranchSpecs> =>
{
    const branchSpecs = [args.source, args.destination].filter((value): value is string => Boolean(value && /^br:\/.+/i.test(value.trim())));
    const needsQualification = branchSpecs.some((value) => !value.includes("@"));
    if (!needsQualification)
    {
        return { source: args.source.trim(), ...(args.destination ? { destination: args.destination.trim() } : {}) };
    }

    const workspace = await discoverPlasticWorkspace(cwd);
    if (workspace.kind !== "found")
    {
        throw new Error("Cannot safely qualify an unqualified branch selector because the current Plastic workspace repository is unavailable. Use exact repository-qualified syntax 'br:/<branch>@<repository>@<server>'.");
    }

    const selectorBytes = await readBoundedPatchFile(join(workspace.value.plasticDir, "plastic.selector"), 65536);
    if (!isUtf8(selectorBytes)) throw new Error("Patch selector metadata must be valid UTF-8.");
    const selectorText = selectorBytes.toString("utf8");
    const selector = selectorText === undefined ? { kind: "not_found" as const } : parsePlasticSelector(selectorText);
    const repository = selector.kind === "found" ? selector.value.repository : undefined;
    return {
        source: qualifyPatchBranchSpec(args.source, repository),
        ...(args.destination ? { destination: qualifyPatchBranchSpec(args.destination, repository) } : {}),
    };
};

export type PatchOutputStaging = {
    requestedOutput: string;
    stagingOutput: string;
    cleanup: () => Promise<void>;
};

export const ensurePatchOutputDoesNotExist = async (requestedOutput: string): Promise<void> =>
{
    const existing = await fs.lstat(requestedOutput).catch((error: unknown) =>
    {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    });
    if (existing)
    {
        throw new Error(`Refusing to overwrite existing patch output '${requestedOutput}'. Choose a new output path.`);
    }
};

export const createPatchOutputStaging = async (requestedOutput: string): Promise<PatchOutputStaging> =>
{
    await ensurePatchOutputDoesNotExist(requestedOutput);
    let stagingDirectory: string;
    try
    {
        stagingDirectory = await fs.mkdtemp(join(dirname(requestedOutput), ".pi-plastic-patch-"));
    }
    catch (error)
    {
        throw new Error(`Cannot create package-owned patch staging beside '${requestedOutput}'. Ensure its parent directory exists and is writable. ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
        requestedOutput,
        stagingOutput: join(stagingDirectory, "patch-output"),
        cleanup: async () => fs.rm(stagingDirectory, { recursive: true, force: true }),
    };
};

export const validatePatchStagingOutput = async (stagingOutput: string, requireContent = false): Promise<void> =>
{
    const patchStat = await fs.lstat(stagingOutput).catch(() => null);
    if (!patchStat?.isFile())
    {
        throw new Error("Plastic reported patch generation success but did not create package-owned staging output.");
    }
    if (requireContent && patchStat.size === 0)
    {
        // An omitted output may intentionally report an empty patch. A caller
        // who requested a file, however, must never receive a zero-byte file
        // that is indistinguishable from a failed/truncated backend outcome.
        throw new Error("Refusing to publish an empty patch output. Plastic produced no patch bytes; rerun without output to inspect the empty result.");
    }
};

// Creating a hard link is atomic and fails if the requested path appeared
// after our preflight. Unlike rename(), it can never replace an existing file.

export const publishPatchOutput = async (stagingOutput: string, requestedOutput: string): Promise<void> =>
{
    await validatePatchStagingOutput(stagingOutput, true);
    try
    {
        await fs.link(stagingOutput, requestedOutput);
    }
    catch (error)
    {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST")
        {
            throw new Error(`Refusing to overwrite existing patch output '${requestedOutput}'. Choose a new output path.`);
        }
        throw new Error(`Could not atomically publish patch output '${requestedOutput}'. ${error instanceof Error ? error.message : String(error)}`);
    }
};

export const runPatchOutputTransaction = async (requestedOutput: string, generate: (stagingOutput: string) => Promise<void>): Promise<void> =>
{
    const staging = await createPatchOutputStaging(requestedOutput);
    try
    {
        await generate(staging.stagingOutput);
        await publishPatchOutput(staging.stagingOutput, staging.requestedOutput);
    }
    finally
    {
        await staging.cleanup();
    }
};

export const buildPatchCommandArgs = (args: PatchCommandArgs): string[] =>
{
    assertRequiredPatchValue("source", args.source);
    assertNonBlankPatchValue("destination", args.destination);
    assertNonBlankPatchValue("output", args.output);

    const cmdArgs: string[] = ["patch", args.source];

    if (args.destination)
    {
        cmdArgs.push(args.destination);
    }

    if (args.output)
    {
        cmdArgs.push(`--output=${args.output}`);
    }

    if (args.clean)
    {
        cmdArgs.push("--clean");
    }

    if (args.integration)
    {
        cmdArgs.push("--integration");
    }

    if (args.includeBinaries)
    {
        cmdArgs.push("--include-binaries");
    }

    return cmdArgs;
};

export const __plasticPatchInternals = {
    buildPatchCommandArgs,
    qualifyPatchBranchSpec,
    resolvePatchBranchSpecs,
    createPatchOutputStaging,
    publishPatchOutput,
    runPatchOutputTransaction,
    PATCH_MOVE_REPRESENTATION,
};


/** One bounded file observation, not an atomic filesystem snapshot. */
export async function readBoundedPatchFile(path: string, limit: number): Promise<Buffer> {
    const before = await fs.lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > limit) throw new Error("Unsupported patch file or byte limit.");
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > limit) throw new Error("Patch file changed or exceeds byte limit.");
        const buffer = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < buffer.length) {
            const read = await handle.read(buffer, length, buffer.length - length, length);
            if (read.bytesRead === 0) break;
            length += read.bytesRead;
        }
        const after = await handle.stat();
        if (length > limit || length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("Patch file changed or exceeds byte limit.");
        return buffer.subarray(0, length);
    } finally { await handle.close(); }
}
