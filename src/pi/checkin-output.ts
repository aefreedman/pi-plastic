import { Type, type TProperties } from "typebox";
import { Check } from "typebox/value";
import { assembleCheckinReceipt, presentCheckinReceipt, checkinSafeValue, parseCheckinChangeset, type CheckinReceipt } from "../operations/checkin-receipt";
const object = <P extends TProperties>(p: P) => Type.Object(p, { additionalProperties: false });
const enumOf = <const V extends readonly string[]>(v: V) => Type.Unsafe<V[number]>({ anyOf: v.map(value => ({ type: "string", const: value })) });
const str = (max = 4096) => Type.String({ maxLength: max });
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const nullable = <T extends ReturnType<typeof object> | ReturnType<typeof Type.Array>>(s: T) => Type.Union([s, Type.Null()]);
const cs = object({ id: Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$" }), branch: str(), repository: str(), server: str(), mount: Type.Literal("/") });
const summary = object({ totalPending: uint(499), tracked: uint(499), private: uint(499), added: uint(499), changed: uint(499), moved: uint(499), deleted: uint(499), other: uint(499) });
const attempt = object({ state: enumOf(["not-attempted", "not-started", "started", "unknown"]), terminal: enumOf(["not-observed", "observed"]), exitCode: Type.Union([uint(2147483647), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = object({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
const step = object({ name: enumOf(["pending-before", "initial-checkin", "private-add", "private-retry", "pending-recovery", "fallback-checkin", "pending-after", "merge-diagnostic"]), operation: enumOf(["status", "checkin", "add"]), attempt, capture, effect: enumOf(["not-attempted", "uncertain", "command-completed", "changeset-created", "read-observed"]), evidence: enumOf(["unadmitted", "admitted"]), records: uint(501), summary: nullable(summary), changeset: nullable(cs) });
const paths = Type.Array(str(), { maxItems: 100 });
const reasons = Type.Array(object({ path: str(), reason: str(256) }), { maxItems: 100 });
const data = { sourceAdmission: Type.Literal("windows-cm11.0.16.10371-observed"), requestedPaths: paths, includedPaths: paths, fallbackPaths: paths, excludedPaths: reasons, privateAddPaths: paths, blockedPrivatePaths: reasons, itemEvents: Type.Array(Type.Union([object({ operation: enumOf(["CO", "AD", "DE", "CP"]), path: str() }), object({ operation: Type.Literal("MV"), sourcePath: str(), path: str() })]), { maxItems: 100 }), observedChangesets: Type.Array(cs, { maxItems: 100 }), command: nullable(Type.Array(str(8192), { maxItems: 120 })), steps: Type.Array(step, { maxItems: 8 }), autoEnabledApplyChanged: Type.Boolean(), usedFallbackRetry: Type.Boolean(), usedPrivateAutoAddRecovery: Type.Boolean(), pendingBefore: nullable(summary), pendingAfter: nullable(summary), wouldRun: Type.Boolean(), omittedReferences: uint(10000), scopeExhaustion: Type.Literal("unverified"), branchHead: Type.Literal("unverified"), serverAliasEquivalence: Type.Literal("unverified"), xlinkEffects: Type.Literal("unverified"), mergeLinkIdentity: Type.Literal("unverified") };
const header = { schemaVersion: Type.Literal(1), action: Type.Literal("checkin"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: object({ capture: enumOf(["complete", "incomplete", "unknown"]), projection: Type.Boolean() }) };
const error = object({ code: str(64), stage: enumOf(["input", "pending", "checkin", "producer"]), message: str(512) });
export const checkinOutputSchema = Type.Unsafe<CheckinReceipt>(Type.Union([
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("completed"), data: object({ ...data, effect: Type.Literal("changeset-created"), createdChangeset: cs }) }),
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("preflight"), data: object({ ...data, effect: Type.Literal("not-attempted"), createdChangeset: Type.Null() }) }),
    object({ ...header, ok: Type.Literal(false), outcome: enumOf(["failed", "unsupported", "uncertain"]), error, data: object({ ...data, effect: enumOf(["not-attempted", "uncertain", "command-completed", "changeset-created"]), createdChangeset: nullable(cs) }) }),
]));
export function validateCheckinOutput(value: unknown): value is CheckinReceipt {
    if (!Check(checkinOutputSchema, value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 131072) return false;
    const d = (value as CheckinReceipt).data, dto = value as CheckinReceipt;
    const lists = [d.requestedPaths, d.includedPaths, d.fallbackPaths, d.excludedPaths, d.privateAddPaths, d.blockedPrivatePaths, d.itemEvents, d.observedChangesets, d.command ?? []];
    if (lists.reduce((n, a) => n + a.length, 0) > 100 || dto.completeness.projection !== (d.omittedReferences === 0)) return false;
    if (![...d.requestedPaths, ...d.includedPaths, ...d.fallbackPaths, ...d.privateAddPaths, ...d.excludedPaths.map(p => p.path), ...d.blockedPrivatePaths.map(p => p.path)].every(checkinSafeValue)) return false;
    const validCs = (c: NonNullable<typeof d.createdChangeset>) => !!parseCheckinChangeset(`cs:${c.id}@br:${c.branch}@${c.repository}@${c.server} (mount:'/')`);
    if (!d.observedChangesets.every(validCs) || d.createdChangeset && !validCs(d.createdChangeset)) return false;
    for (const e of d.itemEvents) if (!checkinSafeValue(e.path) || e.operation === "MV" && !checkinSafeValue(e.sourcePath)) return false;
    if (d.command && (d.command.reduce((n, a) => n + a.length, 0) > 32768 || Buffer.byteLength(JSON.stringify(d.command), "utf8") > 65536 || d.command[0] !== "cm" || d.command[1] !== "checkin")) return false;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const summaryValid = (s: NonNullable<typeof d.pendingBefore>) => s.totalPending === s.tracked + s.private && s.totalPending === s.added + s.changed + s.moved + s.deleted + s.private + s.other;
    if (d.pendingBefore && !summaryValid(d.pendingBefore) || d.pendingAfter && !summaryValid(d.pendingAfter)) return false;
    const normal = (s: typeof d.steps[number]) => s.attempt.state === "started" && s.attempt.terminal === "observed" && s.attempt.exitCode !== null && !s.attempt.aborted && !s.attempt.timedOut && s.capture.complete;
    for (const s of d.steps) {
        const a = s.attempt, c = s.capture;
        if (a.exitCode !== null && a.terminal !== "observed" || c.stdoutRetainedBytes > c.stdoutBytes || c.stderrRetainedBytes > c.stderrBytes || c.complete && (!c.validUtf8 || c.truncated || a.terminal !== "observed" || a.aborted || a.timedOut)) return false;
        if (s.summary && (!summaryValid(s.summary) || s.operation !== "status" || s.effect !== "read-observed")) return false;
        if (s.operation === "status" && !["not-attempted", "read-observed"].includes(s.effect)) return false;
        if (s.operation !== "status" && s.summary) return false;
        if (s.effect === "read-observed" && (!normal(s) || a.exitCode !== 0 || c.stderrBytes || s.evidence !== "admitted" || !s.summary)) return false;
        if (s.effect === "command-completed" && (s.operation !== "add" || !normal(s) || a.exitCode !== 0)) return false;
        if (s.effect === "changeset-created" && (s.operation !== "checkin" || !normal(s) || a.exitCode !== 0 || c.stderrBytes || s.evidence !== "admitted" || !s.changeset || !validCs(s.changeset))) return false;
        if (s.changeset && s.effect !== "changeset-created") return false;
        if (s.operation !== "status" && s.effect === "not-attempted" && !["not-attempted", "not-started"].includes(a.state)) return false;
    }
    const mutations = d.steps.filter(s => s.operation !== "status"), created = mutations.filter(s => s.effect === "changeset-created");
    const expected = created.length ? "changeset-created" : mutations.some(s => s.effect === "uncertain") ? "uncertain" : mutations.some(s => s.effect === "command-completed") ? "command-completed" : "not-attempted";
    if (d.effect !== expected || created.length > 1 || !!d.createdChangeset !== !!created.length || d.createdChangeset && !same(d.createdChangeset, created[0].changeset)) return false;
    if (dto.outcome === "completed" && (!d.createdChangeset || !d.pendingBefore || !d.wouldRun)) return false;
    if (dto.outcome === "preflight" && (mutations.length || !d.pendingBefore || !d.wouldRun || d.steps.length !== 1)) return false;
    if ((dto.outcome === "failed" || dto.outcome === "unsupported") && mutations.length) return false;
    if (d.usedFallbackRetry !== d.steps.some(s => s.name === "fallback-checkin")) return false;
    if (d.usedPrivateAutoAddRecovery !== d.steps.some(s => s.name === "private-add" && s.effect === "command-completed")) return false;
    if (dto.completeness.capture !== (d.steps.length ? d.steps.every(s => s.capture.complete) ? "complete" : "incomplete" : "unknown")) return false;
    if (d.pendingBefore && !same(d.pendingBefore, d.steps.find(s => s.name === "pending-before")?.summary)) return false;
    if (d.pendingAfter && !d.steps.some(s => ["pending-recovery", "pending-after"].includes(s.name) && same(s.summary, d.pendingAfter))) return false;
    return true;
}
export async function executeCheckinOutput(args: unknown) {
    const dto = await assembleCheckinReceipt(args);
    if (!validateCheckinOutput(dto)) throw new Error("The bounded checkin producer receipt could not be verified.");
    const text = presentCheckinReceipt(dto, (args as { format?: unknown })?.format === "json" ? "json" : "text");
    return { content: [{ type: "text" as const, text }], details: {}, structuredContent: dto, isError: !dto.ok };
}
