import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleStatusObservation, presentStatusObservation, type StatusObservationOptions, type StatusObservation } from "../operations/status";
import { StatusCommandError } from "../execution/status-command";

export const STATUS_OUTPUT_MAX_BYTES = 131072;
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const baseSummary = { totalPending: count, added: count, changed: count, moved: count, deleted: count, other: count };
const completeness = object({
    read: Type.Union([Type.Literal("complete"), Type.Literal("incomplete"), Type.Literal("unknown")]),
    capture: Type.Union([Type.Literal("complete"), Type.Literal("unknown")]),
    projection: Type.Boolean(),
});
const common = {
    schemaVersion: Type.Literal(1), action: Type.Literal("status"),
    provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }),
    completeness,
};
const item = object({
    statusCode: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.Union([Type.Literal("added"), Type.Literal("changed"), Type.Literal("moved"), Type.Literal("deleted"), Type.Literal("private"), Type.Literal("other")]),
    path: Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\uFFFD]*$" }), isDirectory: Type.Boolean(),
    revisionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[0-9]+$" })),
    sourcePath: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\uFFFD]*$" })),
});
export const statusOutputSchema = Type.Union([
    object({ ...common, ok: Type.Literal(true), data: object({
        mode: Type.Literal("machine"), requestedShort: Type.Boolean(),
        summaryBasis: Type.Literal("parsed_records"),
        items: Type.Array(item, { maxItems: 500 }),
        itemCount: object({ parsed: count, returned: count, omitted: count, excluded: count, overCap: count }),
        summary: object({ ...baseSummary, private: count, tracked: count }),
        parse: object({ valid: count, blank: count, header: count, unsupported: count, malformed: count, ambiguousLegacyMove: count }),
    }) }),
    object({ ...common, ok: Type.Literal(true), data: object({
        mode: Type.Literal("standard"), requestedShort: Type.Boolean(),
        summaryBasis: Type.Literal("short_output_classification"), summary: object(baseSummary),
        mergeHints: object({ basis: Type.Literal("text_hints"), hasPendingMergeLinks: Type.Boolean(), hasMergeInProgress: Type.Boolean(), pendingMergeLinkCount: count, mergeInProgressHintCount: count }),
    }) }),
    object({ ...common, ok: Type.Literal(false), error: object({
        code: Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow")]),
        message: Type.String({ maxLength: 256 }),
    }) }),
]);
export type StatusOutput = Static<typeof statusOutputSchema>;
const provenance = { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" } as const;
const envelope = { schemaVersion: 1, action: "status", provenance } as const;
type StatusErrorCode = Extract<StatusOutput, { ok: false }>["error"]["code"];
const errorOutput = (code: StatusErrorCode, message: string): StatusOutput => ({ ...envelope, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message } });

export function validateStatusOutput(value: unknown): StatusOutput {
    if (!Check(statusOutputSchema, value)) return errorOutput("invalid_producer_data", "Status producer data did not match the output contract.");
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > STATUS_OUTPUT_MAX_BYTES) return errorOutput("output_overflow", "Status output exceeded the compact UTF-8 byte limit.");
    return value as StatusOutput;
}

export function projectStatusOutput(observation: StatusObservation, maxItems = 100): StatusOutput {
    if (observation.kind === "machine") {
        const { diagnostics: parse, pendingItems } = observation;
        const eligible = pendingItems.map(row => ({
            statusCode: row.statusCode, kind: row.kind, path: row.workspacePath, isDirectory: row.isDirectory,
            ...(row.revisionId !== undefined ? { revisionId: row.revisionId } : {}),
            ...(row.sourceWorkspacePath !== undefined ? { sourcePath: row.sourceWorkspacePath } : {}),
        })).filter(row => Check(item, row));
        const items = eligible.slice(0, maxItems);
        const excluded = pendingItems.length - eligible.length;
        const summary = { totalPending: pendingItems.length, added: 0, changed: 0, moved: 0, deleted: 0, private: 0, other: 0, tracked: 0 };
        for (const row of pendingItems) summary[row.kind]++;
        summary.tracked = summary.totalPending - summary.private;
        const parseComplete = parse.unsupported + parse.malformed + parse.ambiguousLegacyMove === 0;
        return validateStatusOutput({ ...envelope, ok: true,
            completeness: { read: !parseComplete ? "incomplete" : observation.capture === "complete" ? "complete" : "unknown", capture: observation.capture, projection: items.length === pendingItems.length },
            data: { mode: "machine", requestedShort: observation.requestedShort, summaryBasis: "parsed_records", items, itemCount: { parsed: pendingItems.length, returned: items.length, omitted: pendingItems.length - items.length, excluded, overCap: eligible.length - items.length }, summary, parse },
        });
    }
    return validateStatusOutput({ ...envelope, ok: true,
        completeness: { read: "unknown", capture: observation.capture, projection: true },
        data: { mode: "standard", requestedShort: observation.usedShortFlag, summaryBasis: "short_output_classification", summary: observation.summary,
            mergeHints: { basis: "text_hints", hasPendingMergeLinks: observation.mergeState.hasPendingMergeLinks, hasMergeInProgress: observation.mergeState.hasMergeInProgress, pendingMergeLinkCount: observation.mergeState.pendingMergeLinks.length, mergeInProgressHintCount: observation.mergeState.mergeInProgressHints.length },
        },
    });
}

export async function executeStatusOutput(args: StatusObservationOptions & { format?: "text" | "json"; maxItems?: number; includeRaw?: boolean }) {
    let dto: StatusOutput;
    let rawResult: string | undefined;
    try {
        const observation = await assembleStatusObservation(args);
        dto = projectStatusOutput(observation, args.maxItems);
        if (dto.ok) rawResult = await presentStatusObservation(observation, args);
    } catch (error) {
        dto = validateStatusOutput(error instanceof StatusCommandError ? errorOutput(error.code, error.message) : errorOutput("invalid_producer_data", "Status producer failed to produce valid data."));
    }
    return {
        content: [{ type: "text" as const, text: dto.ok ? dto.data.mode === "machine" ? `Status: ${dto.data.itemCount.parsed} parsed records; ${dto.data.itemCount.returned} returned. Read: ${dto.completeness.read}.` : `Status: ${dto.data.summary.totalPending} classified short-output lines. Read: unknown.` : dto.error.message }],
        structuredContent: dto, isError: !dto.ok,
        details: { exportName: "status", rawResult, ...(args.workdir ? { workdir: args.workdir } : {}) },
    };
}
