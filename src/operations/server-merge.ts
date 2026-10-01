import { randomBytes } from "node:crypto";
import { spawnAndCollect, getCmExecutable } from "../execution/process";
import { getActiveAbortSignal, commandExecutionStorage } from "../execution/context";
import { tool } from "../tool-definition";
import { outputFormatArg, formatServerMergeResult } from "../presentation/results";
import { parseServerMergeOutput } from "../domain/merge-output";

export type QualifiedServerBranch = {
    raw: string;
    branch: string;
    repository: string;
    server: string;
};

export const SERVER_MERGE_OUTPUT_LIMIT = 16_384;

export const SERVER_MERGE_HELP_TIMEOUT_MS = 3_000;

export const SERVER_MERGE_COMMAND_TIMEOUT_MS = 30_000;

export const serverMergeControlPattern = /[\u0000-\u001f\u007f-\u009f]/;

export const serverMergeCapabilityTokens = ["--to", "--merge", "--nointeractiveresolution", "--machinereadable", "--startlineseparator", "--endlineseparator", "--fieldseparator"];

export const assertSafeServerMergeValue = (name: string, value: string): string =>
{
    const trimmed = value.trim();
    if (!trimmed || serverMergeControlPattern.test(value))
    {
        throw new Error(`${name} must be non-empty and must not contain control characters.`);
    }

    return trimmed;
};

export const parseQualifiedServerBranch = (name: string, value: string): QualifiedServerBranch =>
{
    const raw = assertSafeServerMergeValue(name, value);
    if (!raw.startsWith("br:/"))
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    const lastAt = raw.lastIndexOf("@");
    const previousAt = raw.lastIndexOf("@", lastAt - 1);
    if (previousAt <= 3 || lastAt <= previousAt + 1 || lastAt === raw.length - 1)
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    const branch = raw.slice(3, previousAt);
    const repository = raw.slice(previousAt + 1, lastAt);
    const server = raw.slice(lastAt + 1);
    if (!branch.startsWith("/") || branch.endsWith("/") || [branch, repository, server].some((part) => !part || part !== part.trim() || serverMergeControlPattern.test(part)))
    {
        throw new Error(`${name} must use fully qualified syntax 'br:/<branch>@<repository>@<server>'.`);
    }

    return { raw, branch, repository, server };
};

export const createServerMergeSeparators = (): { start: string; end: string; field: string } =>
{
    const nonce = randomBytes(16).toString("hex");
    return {
        start: `__PI_PLASTIC_MERGE_START_${nonce}__`,
        end: `__PI_PLASTIC_MERGE_END_${nonce}__`,
        field: `__PI_PLASTIC_MERGE_FIELD_${nonce}__`,
    };
};

export const getServerMergeCapability = async (): Promise<{ supported: boolean; diagnostics: string }> =>
{
    const result = await spawnAndCollect(getCmExecutable(), ["help", "merge"], process.cwd(), undefined, getActiveAbortSignal(), {
        ...(commandExecutionStorage.getStore() ?? {}),
        timeoutMs: SERVER_MERGE_HELP_TIMEOUT_MS,
        outputLimitChars: SERVER_MERGE_OUTPUT_LIMIT,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const missing = serverMergeCapabilityTokens.filter((token) => !output.includes(token));
    if (result.aborted || result.timedOut || result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated || missing.length > 0)
    {
        return { supported: false, diagnostics: `Local cm help merge capability check did not prove required syntax${missing.length > 0 ? `: missing ${missing.join(", ")}` : "."}` };
    }
    return { supported: true, diagnostics: "Local cm help merge advertised the required merge-to and machine-readable syntax. Server capability remains unverified until dispatch." };
};

export const mergeBranches = tool({
    description: "Perform one bounded workspace-free server-side merge between explicitly qualified branches; merge-link and xlink effects remain unverified.",
    args: {
        source: tool.schema.string().min(1).describe("Fully qualified source branch: br:/<branch>@<repository>@<server>."),
        target: tool.schema.string().min(1).describe("Fully qualified target branch in the same repository/server as source."),
        message: tool.schema.string().min(1).describe("Non-empty changeset comment; no editor fallback is allowed."),
        preflight: tool.schema.boolean().optional().describe("Render the exact command only; does not contact Plastic or analyze remote conflicts."),
        format: outputFormatArg,
    },
    async execute(args)
    {
        const format = args.format ?? "text";
        const source = parseQualifiedServerBranch("source", args.source);
        const target = parseQualifiedServerBranch("target", args.target);
        const message = assertSafeServerMergeValue("message", args.message);
        if (source.repository !== target.repository || source.server !== target.server)
        {
            throw new Error("source and target must identify the same exact repository and server.");
        }
        if (source.branch === target.branch)
        {
            throw new Error("source and target must identify different branches.");
        }

        const separators = createServerMergeSeparators();
        const command = [
            "merge", source.raw, `--to=${target.raw}`, "--merge", `-c=${message}`, "--nointeractiveresolution", "--machinereadable",
            `--startlineseparator=${separators.start}`, `--endlineseparator=${separators.end}`, `--fieldseparator=${separators.field}`,
        ];
        const requestedIdentity = { source: source.raw, target: target.raw, repository: source.repository, server: source.server };
        if (args.preflight)
        {
            return formatServerMergeResult(format, "preflight", [
                "## Server Merge Preflight",
                "",
                "- Would run: yes",
                "- Remote analysis: not performed",
                `- Command: cm ${command.join(" ")}`,
            ].join("\n"), { wouldRun: true, requestedIdentity, command: ["cm", ...command] });
        }

        const capability = await getServerMergeCapability();
        if (!capability.supported)
        {
            return formatServerMergeResult(format, "unsupported", "## Server Merge Unsupported\n\n- No merge command was dispatched because local client syntax could not be proven.", {
                requestedIdentity,
                capability,
                dispatched: false,
            });
        }

        const attempt = await spawnAndCollect(getCmExecutable(), command, process.cwd(), undefined, getActiveAbortSignal(), {
            ...(commandExecutionStorage.getStore() ?? {}),
            timeoutMs: SERVER_MERGE_COMMAND_TIMEOUT_MS,
            outputLimitChars: SERVER_MERGE_OUTPUT_LIMIT,
        });
        const output = [attempt.stdout, attempt.stderr].filter(Boolean).join("\n");
        const parsed = parseServerMergeOutput(output, separators);
        const matchingChangesets = parsed.changesets.filter((changeset) => changeset.branch === target.branch && changeset.repository === target.repository && changeset.mount === "/");
        const effect = "not-proven";
        const diagnostics = output.slice(0, 4_000);
        const baseData = {
            requestedIdentity,
            capability,
            command: ["cm", ...command],
            dispatched: true,
            exitCode: attempt.exitCode,
            aborted: attempt.aborted,
            timedOut: attempt.timedOut,
            outputTruncated: Boolean(attempt.stdoutTruncated || attempt.stderrTruncated),
            records: parsed.records,
            observedChangesets: parsed.changesets,
            diagnostics,
            mergeLinkIdentity: "unverified",
            xlinkEffects: "unverified",
            effect,
        };

        const ambiguous = attempt.aborted || attempt.timedOut || attempt.stdoutTruncated || attempt.stderrTruncated || parsed.malformed
            || parsed.unknownOperations.length > 0 || parsed.changesets.length > 1
            || (parsed.changesets.length > 0 && matchingChangesets.length !== 1)
            || (parsed.hasConflict && parsed.changesets.length > 0)
            || (parsed.isAlreadyConnected && (parsed.changesets.length > 0 || parsed.hasConflict));
        if (!ambiguous && attempt.exitCode === 0 && matchingChangesets.length === 1 && !parsed.hasConflict && !parsed.isAlreadyConnected)
        {
            const changeset = matchingChangesets[0]!;
            return formatServerMergeResult(format, "completed", `## Server Merge Completed\n\n- Created target changeset: cs:${changeset.id}\n- Merge-link identity: unverified\n- Xlink effects: unverified`, {
                ...baseData,
                createdChangeset: changeset,
                effect: "changeset-created",
            });
        }
        if (!ambiguous && attempt.exitCode === 0 && parsed.isAlreadyConnected && parsed.changesets.length === 0 && !parsed.hasConflict)
        {
            return formatServerMergeResult(format, "no-op", "## Server Merge No-op\n\n- Plastic reported ALREADY_CONNECTED.\n- Effect: not independently verified.", baseData);
        }
        if (!ambiguous && attempt.exitCode !== 0 && parsed.hasConflict && parsed.changesets.length === 0)
        {
            return formatServerMergeResult(format, "conflict", "## Server Merge Conflict\n\n- Plastic reported a file conflict.\n- Effect: uncertain; inspect the server before any retry.", { ...baseData, effect: "uncertain" });
        }
        return formatServerMergeResult(format, "uncertain", "## Server Merge Uncertain\n\n- The command may have had an effect, but its bounded output does not prove a safe classification.\n- Do not retry automatically; inspect server state first.", {
            ...baseData,
            effect: "uncertain",
            parseWarnings: {
                malformed: parsed.malformed,
                unknownOperations: parsed.unknownOperations,
                matchingChangesetCount: matchingChangesets.length,
            },
        });
    },
});
