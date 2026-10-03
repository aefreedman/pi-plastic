import { Type, type TProperties } from "typebox";
import { Check } from "typebox/value";
import { assembleBranchCreateReceipt, presentBranchCreateReceipt, safeBranchCreateText, type BranchCreateReceipt, type BranchCreateAttempt, type BranchCreateCapture } from "../operations/branch-create";
const object = <P extends TProperties>(p: P) => Type.Object(p, { additionalProperties: false });
const enumeration = <const V extends readonly string[]>(v: V) => Type.Unsafe<V[number]>({ anyOf: v.map(value => ({ type: "string", const: value })) });
const str = (max = 4096) => Type.String({ maxLength: max });
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
const nullable = <T extends ReturnType<typeof Type.Object> | ReturnType<typeof Type.String> | ReturnType<typeof Type.Array>>(s: T) => Type.Union([s, Type.Null()]);
const attempt = object({ state: enumeration(["not-attempted", "not-started", "started", "unknown"]), terminal: enumeration(["not-observed", "observed"]), exitCode: Type.Union([uint(2147483647), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() });
const capture = object({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() });
const argv = Type.Array(str(8192), { maxItems: 8, minItems: 1 });
const data = {
    requested: nullable(object({ branch: str(), parent: nullable(str()), changeset: nullable(str()), label: nullable(str()), comment: nullable(str()), commentsFile: nullable(str()), allowRootBranch: Type.Boolean() })),
    resolvedTarget: nullable(str()), parentResolution: object({ basis: enumeration(["not-required", "explicit", "status", "unresolved"]), observedBranch: nullable(str()), repositoryVerification: Type.Literal("unverified") }),
    parentCommands: Type.Array(object({ argv, attempt, capture }), { maxItems: 2 }),
    command: nullable(argv), attempt, capture: nullable(capture), observedCreatedIdentity: Type.Null(), repositoryVerification: Type.Literal("unverified"), workspaceSwitch: Type.Literal("not-requested"),
};
const header = { schemaVersion: Type.Literal(1), action: Type.Literal("branch-create"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: object({ capture: enumeration(["complete", "incomplete", "unknown"]), projection: Type.Literal(true) }) };
const error = object({ code: enumeration(["invalid_request", "unsupported_source", "ambiguous_qualifier", "parent_unresolved", "launch_failed", "aborted", "uncertain", "producer_failed"]), stage: enumeration(["input", "source", "parent", "create", "producer"]), message: str(256) });
export const branchCreateOutputSchema = Type.Unsafe<BranchCreateReceipt>(Type.Union([
    object({ ...header, ok: Type.Literal(true), outcome: Type.Literal("command-completed"), data: object({ ...data, effect: Type.Literal("not-proven") }) }),
    object({ ...header, ok: Type.Literal(false), outcome: enumeration(["failed", "unsupported"]), error, data: object({ ...data, effect: Type.Literal("not-attempted") }) }),
    object({ ...header, ok: Type.Literal(false), outcome: Type.Literal("uncertain"), error, data: object({ ...data, effect: Type.Literal("uncertain") }) }),
]));
const validAttempt = (a: BranchCreateAttempt) => !(a.exitCode !== null && a.terminal !== "observed") && !(a.state === "not-attempted" && (a.terminal !== "not-observed" || a.exitCode !== null || a.timedOut)) && !(a.state === "not-started" && a.exitCode !== null);
const validCapture = (c: BranchCreateCapture, a: BranchCreateAttempt) => c.stdoutRetainedBytes <= c.stdoutBytes && c.stderrRetainedBytes <= c.stderrBytes && (!c.complete || c.validUtf8 && !c.truncated && c.stdoutBytes === c.stdoutRetainedBytes && c.stderrBytes === c.stderrRetainedBytes && a.state === "started" && a.terminal === "observed" && a.exitCode !== null && !a.aborted && !a.timedOut);
export function validateBranchCreateOutput(value: unknown): value is BranchCreateReceipt {
    if (!Check(branchCreateOutputSchema, value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 131072) return false;
    const dto = value as BranchCreateReceipt, d = dto.data, a = d.attempt, p = d.parentResolution, r = d.requested;
    if (!validAttempt(a) || d.capture && !validCapture(d.capture, a)) return false;
    if (!dto.ok && !safeBranchCreateText(dto.error.message)) return false;
    if (r && (!r.branch.trim() || Object.values(r).some(v => typeof v === "string" && !safeBranchCreateText(v)) || r.changeset && r.label || r.comment && r.commentsFile || r.comment !== null && !r.comment.trim())) return false;
    if (d.resolvedTarget !== null && (!safeBranchCreateText(d.resolvedTarget) || !d.resolvedTarget.trim())) return false;
    if (p.observedBranch !== null && (!safeBranchCreateText(p.observedBranch) || !/^\/(?:[^/@\\]+)(?:\/[^/@\\]+)*$/u.test(p.observedBranch) || /[?\uFFFD]/u.test(p.observedBranch))) return false;
    if ((p.basis === "status") !== (p.observedBranch !== null)) return false;
    for (let i = 0; i < d.parentCommands.length; i++) {
        const c = d.parentCommands[i]!;
        if (JSON.stringify(c.argv) !== JSON.stringify(i === 0 ? ["status"] : ["status", "--compact"]) || !validAttempt(c.attempt) || !validCapture(c.capture, c.attempt)) return false;
    }
    if (p.basis === "status" && (d.parentCommands.length !== 1 || !d.parentCommands[0]!.capture.complete || d.parentCommands[0]!.capture.stderrBytes || d.parentCommands[0]!.attempt.exitCode !== 0)) return false;
    if (["explicit", "not-required"].includes(p.basis) && d.parentCommands.length) return false;
    const norm = (s: string) => s.trim().replace(/^br:/i, "").split("@")[0]!.replace(/\\/g, "/");
    if (r) {
        const relative = !norm(r.branch).startsWith("/");
        if (!relative && p.basis !== "not-required" || relative && p.basis === "explicit" && r.parent === null || relative && p.basis === "status" && r.parent !== null) return false;
        if (d.command && relative && (r.branch.includes("@") || r.parent?.includes("@"))) return false;
    }
    if (d.command) {
        if (!r || !d.resolvedTarget || Buffer.byteLength(JSON.stringify(d.command), "utf8") > 65536 || !d.command.every(s => !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s))) return false;
        let expectedTarget = r.branch.trim();
        if (!norm(r.branch).startsWith("/")) {
            const parent = p.basis === "status" ? p.observedBranch : r.parent;
            if (!parent || !["status", "explicit"].includes(p.basis)) return false;
            const normalizedParent = norm(parent).replace(/\/$/, "");
            if (!normalizedParent.startsWith("/") || normalizedParent === "/") return false;
            expectedTarget = normalizedParent + "/" + norm(r.branch);
        } else if (norm(r.branch).split("/").filter(Boolean).length === 1 && !r.allowRootBranch) return false;
        if (d.resolvedTarget !== expectedTarget) return false;
        const expected = ["branch", "create", expectedTarget];
        if (r.changeset) expected.push(`--changeset=${r.changeset}`);
        if (r.label) expected.push(`--label=${r.label}`);
        if (r.comment) expected.push(`-c=${r.comment}`);
        if (r.commentsFile) expected.push(`-commentsfile=${r.commentsFile}`);
        if (JSON.stringify(expected) !== JSON.stringify(d.command)) return false;
    } else if (d.resolvedTarget !== null || !["not-attempted", "unknown"].includes(a.state) || d.capture) return false;
    if (dto.outcome === "command-completed" && (!d.command || !d.capture?.complete || d.capture.stderrBytes || a.state !== "started" || a.terminal !== "observed" || a.exitCode !== 0 || a.aborted || a.timedOut)) return false;
    if (dto.outcome === "uncertain" && !["started", "unknown"].includes(a.state)) return false;
    if (["failed", "unsupported"].includes(dto.outcome) && !["not-attempted", "not-started"].includes(a.state)) return false;
    const lastCapture = d.capture ?? d.parentCommands.at(-1)?.capture;
    if (dto.completeness.capture !== (lastCapture ? lastCapture.complete ? "complete" : "incomplete" : "unknown")) return false;
    return true;
}
export async function executeBranchCreateOutput(args: unknown) {
    let dto = await assembleBranchCreateReceipt(args);
    const valid: boolean = validateBranchCreateOutput(dto);
    if (!valid) {
        const mayHaveStarted = !["not-attempted", "not-started"].includes(dto.data.attempt.state);
        const safe = await assembleBranchCreateReceipt({});
        dto = { ...safe, ok: false, outcome: mayHaveStarted ? "uncertain" : "failed", data: { ...safe.data, attempt: { ...safe.data.attempt, state: mayHaveStarted ? "unknown" : "not-attempted" }, effect: mayHaveStarted ? "uncertain" : "not-attempted" }, error: { code: "producer_failed", stage: "producer", message: "Branch creation receipt could not be validated; do not retry automatically." } } as BranchCreateReceipt;
        if (!validateBranchCreateOutput(dto)) throw new Error("Safe branch creation receipt could not be constructed.");
    }
    return { content: [{ type: "text" as const, text: presentBranchCreateReceipt(dto) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
