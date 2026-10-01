import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleStatusObservation, presentStatusObservation, type StatusObservationOptions, type StatusObservation, StatusOptionError } from "../operations/status";
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
// Reject pre-decoding Windows substitution as well as UTF-8 replacement loss.
const statusPathPattern = process.platform === "win32" ? "^[^\\uFFFD?]*$" : "^[^\\uFFFD]*$";
const item = object({
    statusCode: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.Union([Type.Literal("added"), Type.Literal("changed"), Type.Literal("moved"), Type.Literal("deleted"), Type.Literal("private"), Type.Literal("other")]),
    path: Type.String({ minLength: 1, maxLength: 4096, pattern: statusPathPattern }), isDirectory: Type.Boolean(),
    revisionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[0-9]+$" })),
    sourcePath: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: statusPathPattern })),
});
const xmlCount = Type.Integer({ minimum: 0, maximum: 20000 });
const xmlSummary = { totalPending: xmlCount, added: xmlCount, changed: xmlCount, moved: xmlCount, deleted: xmlCount, other: Type.Literal(0), private: xmlCount, tracked: xmlCount };
const xmlPathPattern = `^(?:/|[A-Za-z]:\\\\|\\\\\\\\)[^\\u0000-\\u001f${process.platform === "win32" ? "?" : ""}]*$`;
const xmlItem = object({
    statusCode: Type.Union([Type.Literal("CH"), Type.Literal("AD"), Type.Literal("DE"), Type.Literal("LD"), Type.Literal("MV"), Type.Literal("PR")]),
    kind: Type.Union([Type.Literal("added"), Type.Literal("changed"), Type.Literal("moved"), Type.Literal("deleted"), Type.Literal("private")]),
    path: Type.String({ minLength: 1, maxLength: 4096, pattern: xmlPathPattern }), isDirectory: Type.Boolean(),
    sourcePath: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: xmlPathPattern })),
});
export const statusOutputSchema = Type.Union([
    object({ ...common, schemaVersion: Type.Literal(2), ok: Type.Literal(true), data: object({
        mode: Type.Literal("xml"), requestedShort: Type.Literal(false), summaryBasis: Type.Literal("parsed_records"),
        source: object({ transport: Type.Literal("status_xml"), encoding: Type.Literal("utf-8"), pathBasis: Type.Literal("absolute"), scope: Type.Literal("workspace"), baseRevisionAvailability: Type.Literal("unavailable") }),
        items: Type.Array(xmlItem, { maxItems: 500 }),
        itemCount: object({ parsed: xmlCount, returned: Type.Integer({ minimum: 0, maximum: 500 }), omitted: xmlCount, excluded: Type.Literal(0), overCap: xmlCount }),
        summary: object(xmlSummary),
        parse: object({ records: xmlCount, unsupportedRecords: Type.Literal(0), malformedRecords: Type.Literal(0) }),
    }) }),
    object({ ...common, schemaVersion: Type.Literal(2), ok: Type.Literal(false), error: object({
        code: Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow")]),
        message: Type.String({ maxLength: 256 }),
    }) }),
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
const errorOutput = (code: StatusErrorCode, message: string, schemaVersion: 1 | 2 = 1): StatusOutput => ({ ...envelope, schemaVersion, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message } });

export function validateStatusOutput(value: unknown, schemaVersion: 1 | 2 = 1): StatusOutput {
    if (!Check(statusOutputSchema, value)) return errorOutput("invalid_producer_data", "Status producer data did not match the output contract.", schemaVersion);
    const checked = value as StatusOutput;
    if (checked.ok && checked.data.mode === "xml") {
        const data = checked.data;
        const { parsed, returned, omitted, excluded, overCap } = data.itemCount;
        const seen = new Set<string>();
        const kinds = { CH: "changed", AD: "added", DE: "deleted", LD: "deleted", MV: "moved", PR: "private" };
        const invalidRows = data.items.some(row => {
            const unsafe = (path: string) => /[\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(path);
            const invalid = unsafe(row.path) || (row.sourcePath !== undefined && unsafe(row.sourcePath)) || row.kind !== kinds[row.statusCode] || (row.kind === "moved") !== Boolean(row.sourcePath) || row.sourcePath === row.path || seen.has(row.path);
            seen.add(row.path); return invalid;
        });
        if (data.summary.added + data.summary.changed + data.summary.deleted + data.summary.moved + data.summary.private + data.summary.other !== parsed || data.summary.other !== 0 || data.summary.tracked !== parsed - data.summary.private || invalidRows || returned !== data.items.length || parsed !== data.parse.records || parsed !== data.summary.totalPending || omitted !== parsed - returned || excluded !== 0 || overCap !== omitted || checked.completeness.read !== "complete" || checked.completeness.capture !== "complete" || checked.completeness.projection !== (returned === parsed)) return errorOutput("invalid_producer_data", "Status producer data did not match the output contract.", 2);
    }
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > STATUS_OUTPUT_MAX_BYTES) return errorOutput("output_overflow", "Status output exceeded the compact UTF-8 byte limit.", schemaVersion);
    return value as StatusOutput;
}

export function projectStatusOutput(observation: StatusObservation, maxItems = 100): StatusOutput {
    if (observation.kind === "xml") {
        const items = observation.items.slice(0, maxItems);
        const parsed = observation.items.length;
        const summary = observation.summary;
        return validateStatusOutput({ ...envelope, schemaVersion: 2, ok: true,
            completeness: { read: "complete", capture: "complete", projection: items.length === parsed },
            data: { mode: "xml", requestedShort: false, summaryBasis: "parsed_records",
                source: { transport: "status_xml", encoding: "utf-8", pathBasis: "absolute", scope: "workspace", baseRevisionAvailability: "unavailable" },
                items, itemCount: { parsed, returned: items.length, omitted: parsed - items.length, excluded: 0, overCap: parsed - items.length }, summary,
                parse: { records: parsed, unsupportedRecords: 0, malformedRecords: 0 } },
        }, 2);
    }
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
        const version = args.source === "xml" ? 2 : 1;
        dto = validateStatusOutput(error instanceof StatusCommandError ? errorOutput(error.code, error.message, version) : error instanceof StatusOptionError ? errorOutput("command_failed", error.message, version) : errorOutput("invalid_producer_data", "Status producer failed to produce valid data.", version), version);
    }
    return {
        content: [{ type: "text" as const, text: dto.ok ? dto.data.mode !== "standard" ? `Status: ${dto.data.itemCount.parsed} parsed records; ${dto.data.itemCount.returned} returned. Read: ${dto.completeness.read}.` : `Status: ${dto.data.summary.totalPending} classified short-output lines. Read: unknown.` : dto.error.message }],
        structuredContent: dto, isError: !dto.ok,
        details: { exportName: "status", rawResult, ...(args.workdir ? { workdir: args.workdir } : {}) },
    };
}
