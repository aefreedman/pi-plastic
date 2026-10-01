import { isUtf8 } from "node:buffer";
import { promises as fs } from "node:fs";
import { join, extname } from "path";
import { spawnAndCollect, getDiffExecutable } from "../execution/process";
import { getActiveAbortSignal, commandExecutionStorage } from "../execution/context";
import { tmpdir } from "os";
import { runCm } from "../execution/cm";

export const DIFF_OUTPUT_MAX_CHARS = 60_000;

export type TextDiffResult = {
    backend: "diff";
    changed: boolean;
    binary: boolean;
    output: string;
    truncated: boolean;
    totalChars: number;
};

// Do not classify serialized Unity YAML by its extension or importer metadata:
// valid UTF-8 YAML is text, while NUL-containing or invalid UTF-8 bytes are binary.

export const isBinaryContent = (content: Buffer): boolean => content.includes(0) || !isUtf8(content);

export const stableDiffHeaders = (output: string, leftLabel: string, rightLabel: string): string =>
{
    const lines = output.split(/\r?\n/);
    // Both GNU and BSD `diff -u` put the source paths in the first two header
    // lines. Replacing only those lines keeps hunk content verbatim while never
    // leaking package-owned temporary paths or host-specific timestamps.
    if (lines[0]?.startsWith("--- "))
    {
        lines[0] = `--- ${leftLabel}`;
    }
    if (lines[1]?.startsWith("+++ "))
    {
        lines[1] = `+++ ${rightLabel}`;
    }
    return lines.join("\n").replace(/\n+$/, "");
};

export const boundDiffOutput = (output: string): Pick<TextDiffResult, "output" | "truncated" | "totalChars"> =>
{
    const totalChars = output.length;
    if (totalChars <= DIFF_OUTPUT_MAX_CHARS)
    {
        return { output, truncated: false, totalChars };
    }

    return {
        output: `${output.slice(0, DIFF_OUTPUT_MAX_CHARS)}\n\n[Diff output truncated at ${DIFF_OUTPUT_MAX_CHARS} characters; inspect a narrower file or use a review patch for the complete change.]`,
        truncated: true,
        totalChars,
    };
};

export const runPortableTextDiff = async (
    leftPath: string,
    rightPath: string,
    _cwd: string,
    leftLabel: string,
    rightLabel: string,
): Promise<TextDiffResult> =>
{
    const [leftContent, rightContent] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
    if (isBinaryContent(leftContent) || isBinaryContent(rightContent))
    {
        return { backend: "diff", changed: !leftContent.equals(rightContent), binary: true, output: "", truncated: false, totalChars: 0 };
    }

    // Do not pass either workspace or historical source paths to diff: a
    // Unicode workspace path reproduces an Invalid argument failure in the
    // configured Windows GnuWin32 backend. Labels intentionally stay out of
    // argv and are restored by stableDiffHeaders below.
    const materializationDir = await createAsciiTempDirectory("pi-plastic-diff-");
    const materializedLeftPath = join(materializationDir, `left${safeTempExtension(leftPath)}`);
    const materializedRightPath = join(materializationDir, `right${safeTempExtension(rightPath)}`);
    try
    {
        await Promise.all([
            fs.writeFile(materializedLeftPath, leftContent),
            fs.writeFile(materializedRightPath, rightContent),
        ]);
        const { stdout, stderr, exitCode, aborted, stdoutTruncated, stdoutTotalChars } = await spawnAndCollect(
            getDiffExecutable(),
            ["-u", materializedLeftPath, materializedRightPath],
            materializationDir,
            undefined,
            getActiveAbortSignal(),
            { ...commandExecutionStorage.getStore(), outputLimitChars: DIFF_OUTPUT_MAX_CHARS },
        );
        if (aborted)
        {
            throw new Error("Text diff was aborted.");
        }
        if (exitCode > 1)
        {
            const diagnostic = [stdout, stderr].filter(Boolean).join("\n").trim();
            const sanitized = diagnostic
                .split(materializedLeftPath).join(leftLabel)
                .split(materializedRightPath).join(rightLabel);
            throw new Error(sanitized || `Text diff failed with exit code ${exitCode}.`);
        }

        const normalized = stableDiffHeaders(stdout, leftLabel, rightLabel);
        const bounded = stdoutTruncated
            ? {
                output: `${normalized}\n\n[Diff output truncated at ${DIFF_OUTPUT_MAX_CHARS} characters; inspect a narrower file or generate a review patch for the complete change.]`,
                truncated: true,
                totalChars: stdoutTotalChars ?? normalized.length,
            }
            : boundDiffOutput(normalized);
        return { backend: "diff", changed: exitCode === 1, binary: false, ...bounded };
    }
    finally
    {
        await fs.rm(materializationDir, { recursive: true, force: true });
    }
};

export const safeTempExtension = (pathValue: string): string =>
{
    const extension = extname(pathValue);
    return /^\.[A-Za-z0-9]{1,12}$/.test(extension) ? extension : ".tmp";
};

export const isAsciiPath = (pathValue: string): boolean => /^[\x20-\x7e]*$/.test(pathValue);

// GnuWin32 diff cannot reliably accept Unicode operands. Keep every package
// materialization path ASCII-only; labels are restored after the backend exits.

export const createAsciiTempDirectory = async (prefix: string): Promise<string> =>
{
    const temporaryRoot = tmpdir();
    if (!isAsciiPath(temporaryRoot))
    {
        throw new Error("Text diff requires an ASCII-safe temporary directory because the configured backend cannot reliably accept Unicode paths. Set TEMP and TMP to a writable ASCII-only path.");
    }
    return fs.mkdtemp(join(temporaryRoot, prefix));
};

export const materializeRevision = async (revision: string, destination: string, workdir?: string): Promise<void> =>
{
    // --file keeps historical bytes out of the decoded stdout path. This is
    // required for both reliable binary detection and Unity YAML text handling.
    try
    {
        await runCm(["cat", revision, `--file=${destination}`], workdir);
        const destinationStat = await fs.stat(destination).catch(() => null);
        if (!destinationStat?.isFile())
        {
            throw new Error("Plastic did not materialize the requested historical file content.");
        }
    }
    catch (error)
    {
        // cm cat --file can leave a zero-byte output on failure. The destination
        // is package-owned, so remove it before surfacing a sanitized diagnostic.
        await fs.rm(destination, { force: true }).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.split(destination).join("<package-owned-temp-file>"));
    }
};

export const isNoDataError = (message: string): boolean =>
{
    const normalized = message.toLowerCase();
    return normalized.includes("--nodata")
        || normalized.includes("no data available")
        || normalized.includes("data is not available")
        || normalized.includes("cannot retrieve data")
        || normalized.includes("could not retrieve data");
};

export const withWorkspaceBaseUnavailableDiagnostic = (path: string, error: unknown): Error =>
{
    const message = error instanceof Error ? error.message : String(error);
    if (!isNoDataError(message))
    {
        return error instanceof Error ? error : new Error(message);
    }

    return new Error(
        `Plastic cannot supply historical/base bytes for '${path}' because this workspace/status record is --nodata. `
        + "A workspace diff cannot be calculated without those bytes. Run plastic_status(machineReadable=true, includeRevId=true) to verify the item, then update/refresh the workspace or use plastic_diffRevisions with two known file-qualified revisions when historical content is available.",
    );
};
