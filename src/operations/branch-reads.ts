import { cmWhereEquals, getBranchLeafName, normalizeBranchSpecForComparison } from "../domain/branches";
import { runStatusCommand, StatusCommandError } from "../execution/status-command";
import { toStructuredResult, type OutputFormat } from "../presentation/results";

export class BranchReadError extends Error {
    constructor(readonly code: "command_failed" | "aborted" | "capture_incomplete" | "invalid_identity" | "malformed_output") {
        super(`Branch read failed (${code}); no verified identity or existence result is available.`);
    }
}
export const validBranchIdentity = (value: string): boolean => value.length > 0 && value.length <= 4096
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\uFFFD]/u.test(value)
    && !(process.platform === "win32" && value.includes("?"))
    && !/[\uD800-\uDFFF]/u.test(value);
const assertIdentity = (value: string): string => {
    if (!validBranchIdentity(value)) throw new BranchReadError("invalid_identity");
    return value;
};
const pathIdentity = (value: string): string => {
    assertIdentity(value);
    if (!/^\/(?:[^/@\\]+)(?:\/[^/@\\]+)*$/u.test(value)) throw new BranchReadError("malformed_output");
    return value;
};
const read = async (args: string[], workdir?: string): Promise<string> => {
    try {
        const result = await runStatusCommand(args, workdir, true);
        if (result.capture !== "complete") throw new BranchReadError("capture_incomplete");
        return result.output;
    } catch (error) {
        if (error instanceof StatusCommandError) throw new BranchReadError(error.code);
        throw error;
    }
};
// Inspect every recognized changeset token, including empty/malformed ones.
// Delimiters accommodate the live cs:N@rep:... and (cs:N - head) forms;
// decimal/junk suffixes are part of the token, never a reusable numeric prefix.
const statusChangesetIds = (output: string): string[] => {
    const tokens = [...output.matchAll(/\bcs:([^\s@)]*)/giu)].map(match => match[1]);
    if (tokens.length > 1 || tokens.some(token => !/^[0-9]+$/u.test(token))) throw new BranchReadError("malformed_output");
    return tokens;
};
// Only explicit, delimited observations are reusable. Never take a whitespace
// prefix of a br: selector or normalize an observed path into a different one.
const statusIdentity = (output: string): string | undefined => {
    const candidates: string[] = [];
    for (const line of output.split(/\r?\n/).filter(line => line.trim())) {
        // At most the explicit leading source prefix may carry a br: marker.
        // A second selector in either path or repository text is ambiguous, not
        // part of a fabricated spaced branch or ignorable trailing metadata.
        const body = line.replace(/^(?:(?:branch\s*[:=]\s*|Branch\s+)(?:br:)?|br:)/iu, "");
        if (/\bbr:|\bbranch\s*[:=]\s*(?:br:)?\//iu.test(body)) throw new BranchReadError("malformed_output");
        if (/\bbr:.*[()]|^branch.*\(cs:/iu.test(line)) throw new BranchReadError("malformed_output");
        const match = line.match(/^(\/[^@]+)@.+$/u) ?? line.match(/^(?:(?:branch\s*[:=]\s*|Branch\s+)(?:br:)?|br:)(\/[^@]+)(?:@.+)?$/iu);
        if (match) candidates.push(pathIdentity(match[1]));
        else if (/\bbr:|^branch\b|^\//iu.test(line)) throw new BranchReadError("malformed_output");
    }
    if (new Set(candidates).size > 1) throw new BranchReadError("malformed_output");
    // Pending merge-link changesets describe sources, not the loaded identity.
    // Exclude only their standard-status lines once an explicit header exists;
    // changeset-only fallback still validates every token for ambiguity.
    const identityContext = candidates.length > 0
        ? output.split(/\r?\n/).filter(line => !/^    Merge from cs:[0-9]+ at /u.test(line)).join("\n")
        : output;
    statusChangesetIds(identityContext);
    return candidates[0];
};
export type CurrentBranchObservation = { action: "current-branch"; branch: string; basis: "status" | "compact_status" | "changeset_lookup"; scope: "workspace" };
export type BranchExistsObservation = { action: "branch-exists"; requestedBranch: string; comparisonBranch: string; scope: "workspace_repository"; qualifierVerified?: false; exists: boolean };
export type BranchReadObservation = CurrentBranchObservation | BranchExistsObservation;
export async function assembleCurrentBranchObservation(args: { workdir?: string }): Promise<CurrentBranchObservation> {
    const normal = await read(["status"], args.workdir);
    const branch = statusIdentity(normal);
    if (branch !== undefined) return { action: "current-branch", branch, basis: "status", scope: "workspace" };
    const compact = await read(["status", "--compact"], args.workdir);
    const compactBranch = statusIdentity(compact);
    if (compactBranch !== undefined) return { action: "current-branch", branch: compactBranch, basis: "compact_status", scope: "workspace" };
    const changesets = statusChangesetIds(compact);
    if (changesets.length !== 1) throw new BranchReadError("malformed_output");
    const output = await read(["find", "changeset", `where changesetid=${changesets[0]}`, "--format={branch}", "--nototal"], args.workdir);
    const rows = output.split(/\r?\n/).filter(line => line.length > 0);
    if (rows.length !== 1) throw new BranchReadError("malformed_output");
    return { action: "current-branch", branch: pathIdentity(rows[0]), basis: "changeset_lookup", scope: "workspace" };
}
export async function assembleBranchExistsObservation(args: { branch: string; workdir?: string }): Promise<BranchExistsObservation> {
    assertIdentity(args.branch);
    if (args.branch.includes("@") && args.branch.split("@").some(segment => segment.length === 0)) throw new BranchReadError("invalid_identity");
    const comparisonBranch = assertIdentity(normalizeBranchSpecForComparison(args.branch));
    if (comparisonBranch.includes("//") || comparisonBranch.endsWith("/") || comparisonBranch === "/" || /[|]/u.test(comparisonBranch)) throw new BranchReadError("invalid_identity");
    const output = await read(["find", "branch", `where ${cmWhereEquals("name", getBranchLeafName(args.branch))}`, "--format={name}", "--nototal"], args.workdir);
    const rows = output.split(/\r?\n/).filter(line => line.length > 0).map(pathIdentity);
    if (new Set(rows).size !== rows.length || rows.some(row => getBranchLeafName(row) !== getBranchLeafName(comparisonBranch))) throw new BranchReadError("malformed_output");
    return { action: "branch-exists", requestedBranch: args.branch, comparisonBranch, scope: "workspace_repository", ...(args.branch.includes("@") ? { qualifierVerified: false as const } : {}), exists: rows.some(row => row === comparisonBranch) };
}
export const presentCurrentBranchObservation = (observation: CurrentBranchObservation, args: { format?: OutputFormat; workdir?: string }) => toStructuredResult("current-branch", args.format ?? "text", observation.branch, { branch: observation.branch }, args.workdir);
export const presentBranchExistsObservation = (observation: BranchExistsObservation): string => observation.exists ? "true" : "false";
