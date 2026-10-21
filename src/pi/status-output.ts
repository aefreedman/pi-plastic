import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleStatusObservation, type StatusObservationOptions, type StatusObservation, StatusOptionError, StatusXmlError } from "../operations/status";
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
    similarity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});
const xmlCount = Type.Integer({ minimum: 0, maximum: 20000 });
const xmlSummary = { totalPending: xmlCount, added: xmlCount, changed: xmlCount, moved: xmlCount, deleted: xmlCount, other: Type.Literal(0), private: xmlCount, tracked: xmlCount };
const xmlPathPattern = `^(?:/|[A-Za-z]:\\\\|\\\\\\\\)[^\\u0000-\\u001f${process.platform === "win32" ? "?" : ""}]*$`;
const xmlItem = object({
    statusCode: Type.Union([Type.Literal("CH"), Type.Literal("CO"), Type.Literal("CP"), Type.Literal("RP"), Type.Literal("AD"), Type.Literal("DE"), Type.Literal("LD"), Type.Literal("MV"), Type.Literal("LM"), Type.Literal("PR")]),
    kind: Type.Union([Type.Literal("added"), Type.Literal("changed"), Type.Literal("moved"), Type.Literal("deleted"), Type.Literal("private")]),
    path: Type.String({ minLength: 1, maxLength: 4096, pattern: xmlPathPattern }), isDirectory: Type.Boolean(),
    sourcePath: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: xmlPathPattern })),
    similarity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
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
        code: Type.Union([Type.Literal("command_failed"), Type.Literal("aborted"), Type.Literal("capture_incomplete"), Type.Literal("invalid_producer_data"), Type.Literal("output_overflow"), Type.Literal("unsupported_source"), Type.Literal("malformed_output")]),
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
type StatusErrorCode = Extract<StatusOutput, { ok: false; schemaVersion: 1 }>["error"]["code"];
const errorOutput = (code: StatusErrorCode, message: string, schemaVersion: 1 | 2 = 1): StatusOutput => ({ ...envelope, schemaVersion, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, message } });

// Independent DTO trust-boundary validation mirrors the observation identity rules.
const statusObservationPathKey = (value: string): string | null => {
    if (!value || value.length > 4096 || /[\u0000-\u001f\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) return null;
    const path = value.replace(/\\/g, "/");
    if (!/^(?:\/|[A-Za-z]:\/)/.test(path) || path.split("/").some(part => part === "." || part === "..")) return null;
    const windows = /^[A-Za-z]:\//.test(path) || path.startsWith("//");
    const tail = path.slice(path.startsWith("//") ? 2 : windows ? 3 : 1);
    if (tail.includes("//") || (windows && (/[<>:"|?*]/.test(tail) || tail.split("/").some(part => /[. ]$/.test(part))))) return null;
    if (path.startsWith("//") && !/^\/\/[^/]+\/[^/]+\//.test(path)) return null;
    const key = windows ? path.toLowerCase() : path;
    return key.length > (windows ? 3 : 1) ? key.replace(/\/$/, "") : key;
};
const statusObservationPathRoot = (value: string): string => {
    const path = value.replace(/\\/g, "/").toLowerCase();
    return path.match(/^[a-z]:/)?.[0] ?? (path.startsWith("//") ? path.split("/").slice(0, 4).join("/") : "/");
};

export function validateStatusOutput(value: unknown, schemaVersion: 1 | 2 = 1): StatusOutput {
    if (!Check(statusOutputSchema, value)) return errorOutput("invalid_producer_data", "Status producer data did not match the output contract.", schemaVersion);
    const checked = value as StatusOutput;
    if (checked.ok && checked.data.mode === "machine") {
        const invalidMove = checked.data.items.some(row => {
            if (row.statusCode !== "LM") return row.similarity !== undefined;
            const destination = statusObservationPathKey(row.path);
            const source = statusObservationPathKey(row.sourcePath ?? "");
            return row.kind !== "moved" || row.similarity === undefined || !source || !destination || source === destination ||
                statusObservationPathRoot(row.path) !== statusObservationPathRoot(row.sourcePath ?? "") || !/^[1-9][0-9]{0,19}$/.test(row.revisionId ?? "");
        });
        if (invalidMove) return errorOutput("invalid_producer_data", "Status producer data did not match the output contract.", schemaVersion);
    }
    if (checked.ok && checked.data.mode === "xml") {
        const data = checked.data;
        const { parsed, returned, omitted, excluded, overCap } = data.itemCount;
        const seen = new Set<string>();
        const kinds = { CH: "changed", CO: "changed", CP: "added", RP: "changed", AD: "added", DE: "deleted", LD: "deleted", MV: "moved", LM: "moved", PR: "private" };
        const invalidRows = data.items.some(row => {
            const unsafe = (path: string) => /[\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(path);
            const invalid = unsafe(row.path) || (row.sourcePath !== undefined && unsafe(row.sourcePath)) || row.kind !== kinds[row.statusCode] || (row.kind === "moved") !== Boolean(row.sourcePath) || row.sourcePath === row.path;
            const keys = [row.path, ...(row.sourcePath ? [row.sourcePath] : [])].map(statusObservationPathKey);
            const invalidIdentity = keys.some(key => !key || seen.has(key)) || new Set(keys).size !== keys.length;
            for (const key of keys) if (key) seen.add(key);
            const invalidSimilarity = row.statusCode === "LM" ? row.similarity === undefined || statusObservationPathRoot(row.path) !== statusObservationPathRoot(row.sourcePath ?? "") : row.similarity !== undefined;
            return invalid || invalidIdentity || invalidSimilarity;
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
            ...(row.similarity !== undefined ? { similarity: row.similarity } : {}),
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

// Presentation ceilings, independent of native DTO and transport/domain limits.
export const STATUS_PRESENTATION_MAX_BYTES = 32768;
export const STATUS_RAW_PRESENTATION_MAX_BYTES = 8192;
const safeLine = (line: string) => !line.includes("�") && !(process.platform === "win32" && line.includes("?")) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001e]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line);
const lines = (text: string) => text.split(/\r?\n/).filter(line => line.trim().length > 0);

/** Render native admitted rows, not legacy raw presentation. No command/version lookup. */
function presentStatusOutput(observation: StatusObservation, dto: Extract<StatusOutput, { ok: true }>, args: { format?: "text" | "json"; maxItems?: number; includeRaw?: boolean }): string {
    const standardLines = observation.kind === "standard" ? lines(observation.output) : [];
    const admittedLines = standardLines.filter(line => line.length <= 4096 && safeLine(line));
    const selectedLines = admittedLines.slice(0, args.maxItems ?? 100);
    const selectedItems = dto.data.mode === "standard" ? [] : [...dto.data.items];
    const rawSource = observation.kind === "xml" ? "status_xml (utf-8)" : observation.kind === "machine" ? "status --machinereadable" : "status text";
    const rawWarning = observation.kind === "xml" ? "Raw XML contains private workspace/repository/server metadata." : "Raw status contains private workspace/repository/server metadata.";
    // A diagnostic must not resurrect machine identities withheld by native admission.
    const rawWithheld = observation.kind === "machine" && (dto.completeness.read !== "complete" || !dto.completeness.projection);
    const rawLines = args.includeRaw && !rawWithheld ? lines(observation.output) : [];
    const selectedRaw: string[] = [];
    let rawBytes = 0;
    for (const line of rawLines) {
        const bytes = Buffer.byteLength(line, "utf8") + (selectedRaw.length ? 1 : 0);
        if (!safeLine(line) || (observation.kind === "standard" && line.length > 4096) || rawBytes + bytes > STATUS_RAW_PRESENTATION_MAX_BYTES) continue;
        selectedRaw.push(line); rawBytes += bytes;
    }
    const render = () => {
        const presentation = dto.data.mode === "standard"
            ? { basis: "external_text_lines", total: standardLines.length, returned: selectedLines.length, omitted: standardLines.length - selectedLines.length, excluded: standardLines.length - admittedLines.length }
            : { basis: "native_admitted_rows", total: dto.data.itemCount.parsed, returned: selectedItems.length, omitted: dto.data.itemCount.parsed - selectedItems.length, excluded: dto.data.itemCount.excluded };
        const raw = args.includeRaw ? { source: rawSource, warning: rawWarning, withheld: rawWithheld, text: selectedRaw.join("\n"), returnedLines: selectedRaw.length, omittedLines: rawWithheld ? null : rawLines.length - selectedRaw.length } : undefined;
        const data = dto.data.mode === "standard"
            ? { ...dto.data, lines: selectedLines, presentation }
            : { ...dto.data, items: selectedItems, nativeItemCount: dto.data.itemCount, itemCount: { parsed: presentation.total, returned: presentation.returned, omitted: presentation.omitted, excluded: presentation.excluded }, presentation };
        if (args.format === "json") return JSON.stringify({ ok: true, action: "status", completeness: dto.completeness, data, ...(raw ? { rawOutput: raw } : {}) });
        const heading = dto.data.mode === "standard" ? `Status (standard text): ${dto.data.summary.totalPending} classified short-output lines.` : `Status ${dto.data.mode} (synthesized): ${dto.data.itemCount.parsed} parsed records.`;
        const rows = dto.data.mode === "standard" ? selectedLines : selectedItems.map(row => `${row.statusCode} ${row.sourcePath ? `${row.sourcePath} -> ` : ""}${row.path}${row.isDirectory ? " [directory]" : ""}${"revisionId" in row ? ` [revision ${row.revisionId}]` : ""}`);
        const hints = dto.data.mode === "standard" ? [`Merge hints (text_hints): ${dto.data.mergeHints.pendingMergeLinkCount} pending merge links; ${dto.data.mergeHints.mergeInProgressHintCount} merge-in-progress hints (not verified conflicts).`] : [];
        return [heading, `Read: ${dto.completeness.read}; capture: ${dto.completeness.capture}; native projection: ${dto.completeness.projection ? "complete" : "incomplete"}.`, `Summary: ${JSON.stringify(dto.data.summary)}`, ...hints, ...rows,
            `Presentation: ${presentation.returned} returned; ${presentation.omitted} omitted; ${presentation.excluded} excluded.`,
            ...(dto.data.mode !== "standard" ? [`Native rows: ${dto.data.itemCount.returned} returned; ${dto.data.itemCount.omitted} omitted; ${dto.data.itemCount.excluded} excluded.`] : []),
            ...(dto.data.mode === "xml" ? ["Workspace scope; absolute paths; base revisions unavailable."] : []),
            ...(raw ? [raw.warning, `Raw ${raw.source}: ${raw.withheld ? "withheld due to incomplete native admission" : `${raw.returnedLines} lines returned; ${raw.omittedLines} omitted`}`, raw.text] : []),
        ].join("\n");
    };
    let result = render();
    while (Buffer.byteLength(result, "utf8") > STATUS_PRESENTATION_MAX_BYTES) {
        // Drop whole records only; JSON is serialized after selection, never byte-sliced.
        if (selectedRaw.length) selectedRaw.pop();
        else if (selectedItems.length) selectedItems.pop();
        else if (selectedLines.length) selectedLines.pop();
        else throw new Error("Status fixed presentation exceeded its ceiling.");
        result = render();
    }
    return result;
}

export async function executeStatusOutput(args: StatusObservationOptions & { format?: "text" | "json"; maxItems?: number; includeRaw?: boolean }) {
    let dto: StatusOutput;
    let rawResult: string | undefined;
    try {
        const observation = await assembleStatusObservation(args);
        dto = projectStatusOutput(observation, args.maxItems);
        if (dto.ok) rawResult = presentStatusOutput(observation, dto, args);
    } catch (error) {
        const version = args.source === "xml" ? 2 : 1;
        dto = validateStatusOutput(error instanceof StatusXmlError ? ({ ...envelope, schemaVersion: 2, ok: false, completeness: { read: "incomplete", capture: "complete", projection: false }, error: { code: error.code, message: error.message } }) : error instanceof StatusCommandError ? errorOutput(error.code, error.message, version) : error instanceof StatusOptionError ? errorOutput("command_failed", error.message, version) : errorOutput("invalid_producer_data", "Status producer failed to produce valid data.", version), version);
    }
    return {
        content: [{ type: "text" as const, text: dto.ok ? rawResult! : args.format === "json" ? JSON.stringify(dto) : dto.error.message }],
        structuredContent: dto, isError: !dto.ok,
        details: { exportName: "status", rawResult, ...(args.workdir && (dto.ok || args.source !== "xml") ? { workdir: args.workdir } : {}) },
    };
}
