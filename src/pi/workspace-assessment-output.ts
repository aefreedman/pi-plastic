import { Type, type TProperties } from "typebox";
import { validateXlinkOwnership, type WorkspaceAssessment } from "../operations/xlink-ownership";
const obj = <P extends TProperties>(properties: P) => Type.Object(properties, { additionalProperties: false });
const text = Type.String({ minLength: 1, maxLength: 4096 }), decimal = Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$" });
const identity = { changeset: decimal, sourceChangeset: decimal, branch: text, sourceBranch: text, repository: text, server: text };
const ownership = obj({
    cwd: Type.String({ maxLength: 4096 }), complete: Type.Boolean(), root: Type.Union([obj(identity), Type.Null()]), mount: Type.Union([obj({ path: text, ...identity }), Type.Null()]),
    rows: Type.Array(obj({ path: text, status: text, isDirectory: Type.Boolean(), changeset: decimal, repository: text, server: text, mount: text }), { maxItems: 32 }),
    reads: Type.Array(obj({ attempt: obj({ state: Type.Union(["not-attempted", "not-started", "started", "unknown"].map(s => Type.Literal(s))), terminal: Type.Union([Type.Literal("not-observed"), Type.Literal("observed")]), exitCode: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() }), capture: obj({ stdoutBytes: Type.Integer({ minimum: 0 }), stderrBytes: Type.Integer({ minimum: 0 }), stdoutRetainedBytes: Type.Integer({ minimum: 0, maximum: 65536 }), stderrRetainedBytes: Type.Integer({ minimum: 0, maximum: 16384 }), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() }) }), { maxItems: 4 }),
});
export const workspaceAssessmentSchema = Type.Object({
    ownership: Type.Optional(ownership),
    ready: Type.Boolean(), complete: Type.Boolean(), rowCount: Type.Integer({ minimum: 0, maximum: 499 }), mergeRowCount: Type.Integer({ minimum: 0, maximum: 499 }), ordinaryRowCount: Type.Integer({ minimum: 0, maximum: 499 }), linkCount: Type.Integer({ minimum: 0, maximum: 20000 }),
    blockers: Type.Array(Type.Object({ code: Type.String({ minLength: 1, maxLength: 64 }), path: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]) }, { additionalProperties: false }), { maxItems: 8 }),
}, { additionalProperties: false });
export function validateOwnershipAssessment(a: WorkspaceAssessment): boolean {
    const o = a.ownership;
    if (!o) return true;
    if (Buffer.byteLength(JSON.stringify(o),"utf8") > 32768) return false;
    for (const r of o.reads) if (r.capture.stdoutRetainedBytes > r.capture.stdoutBytes || r.capture.stderrRetainedBytes > r.capture.stderrBytes || r.capture.complete && (!r.capture.validUtf8 || r.capture.truncated || r.capture.stdoutRetainedBytes !== r.capture.stdoutBytes || r.capture.stderrRetainedBytes !== r.capture.stderrBytes || r.attempt.terminal !== "observed" || r.attempt.exitCode === null || r.attempt.aborted || r.attempt.timedOut)) return false;
    return o.complete ? validateXlinkOwnership(o) && a.linkCount === 2 && a.rowCount === o.rows.length && a.mergeRowCount === o.rows.length && a.ordinaryRowCount === 0 : !a.ready;
}
