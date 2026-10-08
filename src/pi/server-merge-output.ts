import { isAbsolute } from "node:path";
import { Type, type TProperties } from "typebox";
import { Check } from "typebox/value";
import { assembleServerMergeReceipt, presentServerMergeReceipt, splitServerBranch, type MergeReceipt } from "../operations/server-merge";
const object = <P extends TProperties>(p: P) => Type.Object(p, { additionalProperties: false });
const enumOf = <const V extends readonly string[]>(v: V) => Type.Unsafe<V[number]>({ anyOf: v.map(value => ({ type: "string", const: value })) });
const str = (max = 4096) => Type.String({ maxLength: max });
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const changeset = object({ id: Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$" }), branch: str(), repository: str(), server: str(), mount: str() });
const nullable = <T extends ReturnType<typeof object> | ReturnType<typeof Type.Array>>(s: T) => Type.Union([s, Type.Null()]);
const attempt = object({ state: enumOf(["not-attempted", "not-started", "started", "unknown"]), terminal: enumOf(["not-observed", "observed"]), exitCode: Type.Union([uint(2147483647), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = object({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
const data = {
    mode: enumOf(["apply", "analyze"]),
    resolutionsFile: nullable(object({ path: str(), sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }), entries: uint(500), resultFiles: uint(500), keepSource: uint(500), keepDestination: uint(500) })),
    unlistedConflictPolicy: Type.Union([enumOf(["source", "destination"]), Type.Null()]),
    requestedIdentity: nullable(object({ source: str(), target: str(), branch: str(), repository: str(), server: str() })),
    command: nullable(Type.Array(str(8192), { maxItems: 16 })),
    capability: object({ state: enumOf(["not-checked", "advertised", "missing", "unavailable"]), missingTokens: Type.Array(str(64), { maxItems: 9 }) }),
    attempt, capture: object({ help: nullable(capture), merge: nullable(capture) }),
    parse: nullable(object({ records: uint(500), malformed: Type.Boolean(), unknownOperations: uint(500), changesetsObserved: uint(500), conflictsObserved: uint(500) })),
    observedChangesets: Type.Array(changeset, { maxItems: 100 }), conflictPaths: Type.Array(str(), { maxItems: 100 }),
    counts: object({ changesetsReturned: uint(100), changesetsOmitted: uint(500), conflictsReturned: uint(100), conflictsOmitted: uint(500) }),
    serverAliasEquivalence: Type.Literal("unverified"), mergeLinkIdentity: Type.Literal("unverified"), xlinkEffects: Type.Literal("unverified"), wouldRun: Type.Boolean(), remoteAnalysis: enumOf(["not-performed", "performed"]),
};
const header = { schemaVersion: Type.Literal(1), action: Type.Literal("merge-branches"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: object({ capture: enumOf(["complete", "incomplete", "unknown"]), projection: Type.Boolean() }) };
const error = object({ code: enumOf(["invalid_request", "capability_unavailable", "unsupported", "aborted", "launch_failed", "conflict", "uncertain", "producer_failed"]), stage: enumOf(["input", "help", "merge", "producer"]), message: str(256) });
export const serverMergeOutputSchema = Type.Unsafe<MergeReceipt>(Type.Union([
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("completed"), data: object({ ...data, createdChangeset: changeset, effect: Type.Literal("changeset-created") }) }),
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("analyzed"), data: object({ ...data, createdChangeset: Type.Null(), effect: Type.Literal("not-attempted") }) }),
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("preflight"), data: object({ ...data, createdChangeset: Type.Null(), effect: Type.Literal("not-attempted") }) }),
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("no-op"), data: object({ ...data, createdChangeset: Type.Null(), effect: Type.Literal("not-proven") }) }),
    object({ ...header, ok: Type.Literal(false), outcome: enumOf(["failed", "unsupported"]), error, data: object({ ...data, createdChangeset: Type.Null(), effect: Type.Literal("not-attempted") }) }),
    object({ ...header, ok: Type.Literal(false), outcome: enumOf(["conflict", "uncertain"]), error, data: object({ ...data, createdChangeset: Type.Null(), effect: Type.Literal("uncertain") }) }),
]));
export function validateServerMergeOutput(value: unknown): value is MergeReceipt {
    if (!Check(serverMergeOutputSchema, value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 131072) return false;
    const dto = value as MergeReceipt, d = dto.data, a = d.attempt, p = d.parse;
    const safeText = (s: string) => !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
    for (const cs of [...d.observedChangesets, ...(d.createdChangeset ? [d.createdChangeset] : [])]) if (!splitServerBranch("br:" + cs.branch + "@" + cs.repository + "@" + cs.server) || ![cs.branch, cs.repository, cs.server, cs.mount].every(safeText)) return false;
    if (!d.conflictPaths.every(s => s.startsWith("/") && safeText(s))) return false;
    if (!p && (d.observedChangesets.length || d.conflictPaths.length || Object.values(d.counts).some(Boolean))) return false;
    if (dto.completeness.capture === "complete" && !(d.capture.merge?.complete ?? d.capture.help?.complete)) return false;
    if (dto.outcome === "preflight" && dto.completeness.capture !== "unknown") return false;
    if (d.resolutionsFile && (d.resolutionsFile.resultFiles + d.resolutionsFile.keepSource + d.resolutionsFile.keepDestination !== d.resolutionsFile.entries || !safeText(d.resolutionsFile.path) || !isAbsolute(d.resolutionsFile.path))) return false;
    if (d.mode === "analyze" && (d.resolutionsFile || d.unlistedConflictPolicy || d.command?.some(a => a === "--merge" || a.startsWith("-c=") || a.startsWith("--fileconflictsresolutionsfile=") || a === "--keepsource" || a === "--keepdestination"))) return false;
    if (dto.outcome === "analyzed" && (d.mode !== "analyze" || d.remoteAnalysis !== "performed" || a.exitCode !== 0 || !d.command || !d.requestedIdentity || d.command[0] !== "cm" || d.command[1] !== "merge" || !d.command.includes("--nointeractiveresolution") || d.capture.merge?.stderrBytes || p?.changesetsObserved !== 0 || !p.records || dto.completeness.capture !== "complete")) return false;
    if (dto.outcome !== "analyzed" && d.remoteAnalysis !== "not-performed") return false;
    if (["completed", "no-op", "conflict"].includes(dto.outcome) && d.mode !== "apply") return false;
    if (a.exitCode !== null && a.terminal !== "observed") return false;
    if (["preflight", "unsupported", "failed"].includes(dto.outcome) && !["not-attempted", "not-started"].includes(a.state)) return false;
    if (["completed", "no-op", "conflict", "analyzed"].includes(dto.outcome) && (a.state !== "started" || a.terminal !== "observed" || a.exitCode === null || a.aborted || a.timedOut || !d.capture.merge?.complete || !p || p.malformed || p.unknownOperations)) return false;
    if (dto.outcome === "preflight" && (d.capture.help !== null || d.capture.merge !== null || d.capability.state !== "not-checked" || !d.command || !d.requestedIdentity || !d.wouldRun)) return false;
    if (d.requestedIdentity) {
        const s = splitServerBranch(d.requestedIdentity.source), t = splitServerBranch(d.requestedIdentity.target);
        if (!s || !t || s.repository !== t.repository || s.server !== t.server || t.branch !== d.requestedIdentity.branch || t.repository !== d.requestedIdentity.repository || t.server !== d.requestedIdentity.server || s.branch === t.branch) return false;
    }
    const c = d.counts;
    if (c.changesetsReturned + c.conflictsReturned > 100) return false;
    if (c.changesetsReturned !== d.observedChangesets.length || c.conflictsReturned !== d.conflictPaths.length || p && (c.changesetsReturned + c.changesetsOmitted !== p.changesetsObserved || c.conflictsReturned + c.conflictsOmitted !== p.conflictsObserved)) return false;
    if ((c.changesetsOmitted || c.conflictsOmitted) && dto.completeness.projection) return false;
    if (dto.outcome === "completed" && (a.exitCode !== 0 || !d.requestedIdentity || !d.createdChangeset || d.createdChangeset.branch !== d.requestedIdentity.branch || d.createdChangeset.repository !== d.requestedIdentity.repository || d.createdChangeset.mount !== "/" || p?.changesetsObserved !== 1 || p.conflictsObserved !== 0)) return false;
    if (dto.outcome === "no-op" && (a.exitCode !== 0 || p?.changesetsObserved !== 0 || p.conflictsObserved !== 0)) return false;
    if (dto.outcome === "conflict" && (a.exitCode === 0 || p?.changesetsObserved !== 0 || !p.conflictsObserved)) return false;
    for (const cap of [d.capture.help, d.capture.merge]) if (cap && (cap.stdoutRetainedBytes > cap.stdoutBytes || cap.stderrRetainedBytes > cap.stderrBytes || cap.complete && (!cap.validUtf8 || cap.truncated))) return false;
    return true;
}
export async function executeServerMergeOutput(args: unknown) {
    let dto = await assembleServerMergeReceipt(args);
    const valid: boolean = validateServerMergeOutput(dto);
    if (!valid) {
        const mayHaveStarted = dto.data.attempt.state === "started" || dto.data.attempt.state === "unknown";
        // Build a minimal bounded failure with no commands; damaged producer fields
        // must not survive as apparently verified identities/capture facts.
        const safe = await assembleServerMergeReceipt({});
        dto = { ...safe, ok: false, outcome: mayHaveStarted ? "uncertain" : "failed", data: { ...safe.data, attempt: { ...safe.data.attempt, state: mayHaveStarted ? "unknown" : "not-attempted" }, effect: mayHaveStarted ? "uncertain" : "not-attempted" }, completeness: { capture: "unknown", projection: false }, error: { code: "producer_failed", stage: "producer", message: "The bounded server merge receipt could not be verified; do not retry automatically." } } as MergeReceipt;
        if (!validateServerMergeOutput(dto)) throw new Error("The safe server merge receipt could not be constructed.");
    }
    const json = (args as { format?: unknown })?.format === "json";
    let text = json ? JSON.stringify(dto) : await presentServerMergeReceipt(dto);
    if (text.length > 24000) text = JSON.stringify({ action: dto.action, outcome: dto.outcome, ok: dto.ok, note: "Presentation omitted; inspect structuredContent for the bounded receipt." });
    return { content: [{ type: "text" as const, text }], details: {}, structuredContent: dto, isError: !dto.ok };
}
