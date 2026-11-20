import { Type } from "typebox";
import { findMergeRequests, presentMergeRequest, runMergeRequest } from "../operations/merge-requests";

const nullableText = Type.Union([Type.String(), Type.Null()]);
const commandFields = {
    ok: Type.Boolean(),
    exitCode: Type.Union([Type.Integer(), Type.Null()]),
    stdout: nullableText,
    stderr: nullableText,
    truncated: Type.Boolean(),
    error: nullableText,
};
const row = Type.Object({
    id: Type.String(), guid: Type.String(), title: Type.String(), target: Type.String(), destination: Type.String(),
    mergeRequestStatusName: Type.String(), codeReviewStatusName: Type.String(),
}, { additionalProperties: false });

export const mergeRequestOutputSchema = Type.Object(commandFields, { additionalProperties: false });
export const mergeRequestFindOutputSchema = Type.Object({ ...commandFields, rows: Type.Union([Type.Array(row), Type.Null()]) }, { additionalProperties: false });

export async function executeMergeRequestOutput(name: "mergeRequest" | "mergeRequestFind", params: Record<string, unknown>) {
    const result = name === "mergeRequest" ? await runMergeRequest(params) : await findMergeRequests(params);
    return { content: [{ type: "text" as const, text: presentMergeRequest(result) }], structuredContent: result, details: {}, isError: !result.ok };
}
