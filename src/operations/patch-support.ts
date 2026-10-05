import { spawnAndCollect, ExecutableEnvironment, resolveExecutable } from "../execution/process";
import { discoverPlasticWorkspace, parsePlasticSelector } from "../plastic-workspace";
import { promises as fs, realpathSync } from "node:fs";
import { join, dirname, basename, isAbsolute, resolve } from "path";
import { tmpdir } from "os";
import { isUtf8 } from "node:buffer";
import { constants } from "node:fs";
import { boundDiffOutput } from "../diff/text";

export const PLASTIC_PATCH_EXECUTABLE_ENV = "PI_PLASTIC_PATCH_EXECUTABLE";

export type PatchExecutableProbe = (command: string) => Promise<boolean>;
// Plastic's server/backend determines whether a moved item is encoded as a
// move or as delete/add records. Do not claim either without a live fixture.

export const PATCH_MOVE_REPRESENTATION = "backend-determined" as const;

export type PatchCommandArgs = {
    source: string;
    destination?: string;
    output?: string;
    toolPath?: string;
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

export const probePatchExecutable = async (command: string): Promise<boolean> =>
{
    try
    {
        // This establishes only that the configured executable can launch.
        // `cm patch` remains the authoritative verifier for its --binary contract.
        const result = await spawnAndCollect(command, ["--version"], process.cwd(), undefined, AbortSignal.timeout(3000), {
            abortKillDelayMs: 100,
            outputLimitChars: 1024,
        });
        return !result.aborted;
    }
    catch
    {
        return false;
    }
};

export const getPatchBackendCapabilityWarning = async (
    environment: ExecutableEnvironment = process.env,
    platform: NodeJS.Platform = process.platform,
    probe: PatchExecutableProbe = probePatchExecutable,
): Promise<string | undefined> =>
{
    const configuredPatchExecutable = environment[PLASTIC_PATCH_EXECUTABLE_ENV]?.trim();
    if (configuredPatchExecutable)
    {
        if (await probe(configuredPatchExecutable))
        {
            return undefined;
        }

        return "Pi Plastic capability warning: the configured PI_PLASTIC_PATCH_EXECUTABLE could not be launched. Set it to a verified patch-capable non-GUI diff executable, or remove the override to use this platform's documented fallback. The configured path is not shown for privacy.";
    }

    if (platform === "win32")
    {
        return "Pi Plastic capability warning: plastic_patch requires PI_PLASTIC_PATCH_EXECUTABLE on Windows. Set it to a verified patch-capable non-GUI diff executable (for example Git's diff.exe). PI_PLASTIC_DIFF_EXECUTABLE is only for text diffs.";
    }

    return undefined;
};

export const resolvePatchToolPath = (
    toolPath?: string,
    environment: ExecutableEnvironment = process.env,
    platform: NodeJS.Platform = process.platform,
): string =>
{
    // A per-call path is deliberately the strongest override: callers may
    // select a known patch-capable executable without changing process policy.
    if (toolPath?.trim())
    {
        return toolPath.trim();
    }

    const configuredPatchExecutable = environment[PLASTIC_PATCH_EXECUTABLE_ENV]?.trim();
    if (configuredPatchExecutable)
    {
        return configuredPatchExecutable;
    }

    if (platform === "win32")
    {
        // GnuWin32 diff 2.8.7 is known to reject cm patch directory operands.
        // Do not inherit PI_PLASTIC_DIFF_EXECUTABLE here: that setting remains
        // for text diffs and may name the incompatible executable.
        throw new Error(
            "cm patch requires a patch-capable non-GUI diff executable on Windows. Set PI_PLASTIC_PATCH_EXECUTABLE to a verified tool (for example Git's diff.exe), or pass toolPath for this one call. PI_PLASTIC_DIFF_EXECUTABLE is used only for text diffs and is not a safe Windows patch default.",
        );
    }

    // Retain the pre-existing non-Windows fallback while keeping the patch-specific
    // environment variable authoritative. The caller must verify that the resolved
    // executable supports the local Plastic client's patch argument contract.
    return resolveExecutable(environment, "PI_PLASTIC_DIFF_EXECUTABLE", "diff");
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
        throw new Error("Refusing to publish an empty patch output. Plastic produced no patch bytes; rerun without output to inspect the empty result or verify the patch backend.");
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

export const redactPatchStagingOutput = (message: string, stagingOutput: string): string =>
{
    const stagingPaths = new Set([stagingOutput]);
    try
    {
        // macOS commonly exposes /var through the canonical /private/var path.
        // cm may report the latter even though it received the former.
        stagingPaths.add(join(realpathSync.native(dirname(stagingOutput)), basename(stagingOutput)));
    }
    catch
    {
        // The staging parent normally exists; retain raw-path redaction if it does not.
    }

    return Array.from(stagingPaths)
        .sort((left, right) => right.length - left.length)
        .reduce((redacted, path) => redacted.split(path).join("<package-owned-staging-file>"), message);
};

export const withPatchBackendContractDiagnostic = (error: unknown, toolPath: string, stagingOutput: string): Error =>
{
    const message = redactPatchStagingOutput(error instanceof Error ? error.message : String(error), stagingOutput);
    // Plastic 11 on macOS invokes its patch backend with --binary. Apple's BSD
    // /usr/bin/diff rejects that flag, while GNU diffutils accepts it. Detect
    // the observed contract failure instead of guessing from a path or OS.
    if (/unrecognized option [`']?--binary/i.test(message))
    {
        return new Error(
            `${message}\n\nPlastic patch requires a diff executable that accepts --binary. '${toolPath}' rejected that argument. Configure PI_PLASTIC_PATCH_EXECUTABLE (or this call's toolPath) to a verified GNU diffutils-compatible non-GUI diff executable. Text diff configuration is independent; Apple BSD diff may still be used for text-only diffs.`,
        );
    }
    return new Error(message);
};

export const buildPatchCommandArgs = (args: PatchCommandArgs): string[] =>
{
    assertRequiredPatchValue("source", args.source);
    assertNonBlankPatchValue("destination", args.destination);
    assertNonBlankPatchValue("output", args.output);
    assertNonBlankPatchValue("toolPath", args.toolPath);

    const cmdArgs: string[] = ["patch", args.source];

    if (args.destination)
    {
        cmdArgs.push(args.destination);
    }

    if (args.output)
    {
        cmdArgs.push(`--output=${args.output}`);
    }

    if (args.toolPath)
    {
        cmdArgs.push(`--tool=${args.toolPath}`);
    }

    if (args.clean)
    {
        cmdArgs.push("--clean");
    }

    if (args.integration)
    {
        cmdArgs.push("--integration");
    }

    return cmdArgs;
};

export const __plasticPatchInternals = {
    buildPatchCommandArgs,
    resolvePatchToolPath,
    getPatchBackendCapabilityWarning,
    qualifyPatchBranchSpec,
    resolvePatchBranchSpecs,
    createPatchOutputStaging,
    publishPatchOutput,
    runPatchOutputTransaction,
    withPatchBackendContractDiagnostic,
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
