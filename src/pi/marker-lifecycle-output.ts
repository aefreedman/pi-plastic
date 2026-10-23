import path from "node:path";
import { Type, type TProperties } from "typebox";
import { Check } from "typebox/value";
import { classifyMarkerInspection, emptyMarkerInspection, markerReceipt, safeMarkerText, type MarkerAction, type MarkerReceipt } from "../operations/marker-lifecycle";
import { assembleMarkerLifecycleReceipt, presentMarkerLifecycleReceipt } from "../operations/marker-lifecycle";
const object = <P extends TProperties>(p: P) => Type.Object(p, { additionalProperties: false });
const enumeration = <const V extends readonly string[]>(v: V) => Type.Unsafe<V[number]>({ anyOf: v.map(value => ({ type: "string", const: value })) });
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const nullable = <T extends ReturnType<typeof Type.Object> | ReturnType<typeof Type.String> | ReturnType<typeof Type.Array>>(s: T) => Type.Union([s, Type.Null()]);
const str = (max = 4096) => Type.String({ maxLength: max });
const attempt = object({ state: enumeration(["not-attempted", "not-started", "started", "unknown"]), terminal: enumeration(["not-observed", "observed"]), exitCode: Type.Union([uint(2147483647), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = object({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
const request = object({ workdir: str(), format: enumeration(["text", "json"]), paths: Type.Array(str(), { maxItems: 64 }), acknowledgeIntentionalMarkers: Type.Boolean(), preflight: Type.Boolean() });
const schema = (action: MarkerAction) => Type.Unsafe<MarkerReceipt>(object({
    schemaVersion: Type.Literal(1), action: Type.Literal(action), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }),
    ok: Type.Boolean(), outcome: enumeration(["clear", "preflight", "command-completed", "failed", "uncertain"]),
    data: object({ requested: nullable(request), command: nullable(Type.Array(str(), { minItems: 2, maxItems: 66 })), inspection: object({ state: enumeration(["clear", "pending", "unknown"]), attempt, capture: nullable(capture), stdout: nullable(str(65536)), stderr: nullable(str(16384)) }), commandCompleted: Type.Boolean(), effect: enumeration(["not-attempted", "not-proven", "uncertain"]), checkinReadiness: Type.Literal("unknown"), verification: Type.Literal("unverified") }),
    error: nullable(object({ code: enumeration(["invalid_request", "unknown_evidence", "producer_failed"]), message: str(256) })),
}));
export const mergeListConflictMarkersOutputSchema = schema("merge-list-conflict-markers");
export const mergeMarkResolvedOutputSchema = schema("merge-mark-resolved");
export function validateMarkerLifecycleOutput(value: unknown): value is MarkerReceipt {
    if (!Check(Type.Union([mergeListConflictMarkersOutputSchema, mergeMarkResolvedOutputSchema]), value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 262144) return false;
    const r = value as MarkerReceipt, d = r.data, i = d.inspection, a = i.attempt, c = i.capture, q = d.requested;
    const mark = r.action === "merge-mark-resolved";
    if (a.exitCode !== null && (a.terminal !== "observed" || !["started", "unknown"].includes(a.state)) || a.terminal === "observed" && a.state === "not-attempted" || a.state === "not-attempted" && a.timedOut) return false;
    if (c) {
        if (c.stdoutRetainedBytes > c.stdoutBytes || c.stderrRetainedBytes > c.stderrBytes) return false;
        if (c.validUtf8 ? i.stdout === null || i.stderr === null || Buffer.byteLength(i.stdout, "utf8") !== c.stdoutRetainedBytes || Buffer.byteLength(i.stderr, "utf8") !== c.stderrRetainedBytes : i.stdout !== null || i.stderr !== null) return false;
        if (c.complete && (!c.validUtf8 || c.truncated || c.stdoutBytes !== c.stdoutRetainedBytes || c.stderrBytes !== c.stderrRetainedBytes || a.state !== "started" || a.terminal !== "observed" || a.exitCode === null || a.aborted || a.timedOut)) return false;
    } else if (i.stdout !== null || i.stderr !== null || !["unknown", "not-attempted"].includes(a.state) || a.terminal !== "not-observed" || a.exitCode !== null || a.aborted || a.timedOut) return false;
    if (i.state !== (mark ? "unknown" : classifyMarkerInspection(i))) return false;
    if (q) {
        if (!safeMarkerText(q.workdir) || !path.isAbsolute(q.workdir) || path.normalize(q.workdir) !== q.workdir || q.paths.some(p => !safeMarkerText(p) || /[*?\[\]]/u.test(p) || !path.isAbsolute(p) || path.normalize(p) !== p) || new Set(q.paths).size !== q.paths.length) return false;
        if (mark ? !q.acknowledgeIntentionalMarkers || !q.paths.length : q.acknowledgeIntentionalMarkers || q.paths.length !== 0 || q.preflight) return false;
        if (q.paths.some(p => { const relative = path.relative(q.workdir, p); return !relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative); })) return false;
        const expected = mark ? ["merge", "--mark-resolved", ...q.paths] : ["merge", "--list-conflict-markers"];
        if (JSON.stringify(d.command) !== JSON.stringify(expected) || Buffer.byteLength(JSON.stringify(expected), "utf8") > 65536) return false;
        if (q.preflight && JSON.stringify(i) !== JSON.stringify(emptyMarkerInspection())) return false;
    } else if (d.command !== null || JSON.stringify(i) !== JSON.stringify(emptyMarkerInspection()) || r.error?.code !== "invalid_request") return false;
    const expected = markerReceipt(r.action, q, d.command, i, !q);
    return r.ok === expected.ok && r.outcome === expected.outcome && d.commandCompleted === expected.data.commandCompleted && d.effect === expected.data.effect && JSON.stringify(r.error) === JSON.stringify(expected.error);
}
export async function executeMarkerLifecycleOutput(action: MarkerAction, args: unknown) {
    const dto = await assembleMarkerLifecycleReceipt(action, args);
    // Producer failures must never trigger another process or silently become success.
    if (!validateMarkerLifecycleOutput(dto)) throw Error("Marker lifecycle producer receipt is invalid; do not retry automatically or infer rollback.");
    return { content: [{ type: "text" as const, text: presentMarkerLifecycleReceipt(dto) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
