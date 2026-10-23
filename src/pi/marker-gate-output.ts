import { Type } from "typebox";
import { Check } from "typebox/value";
import type { MarkerGate } from "../operations/marker-lifecycle";
const obj = (p: Record<string, any>) => Type.Object(p, { additionalProperties: false });
const enm = (v: string[]) => Type.Union(v.map(x => Type.Literal(x)));
const uint = (max = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum: 0, maximum: max });
export const markerGateSchema = obj({
 state: enm(["clear", "pending", "unknown"]),
 attempt: obj({ state: enm(["not-attempted", "not-started", "started", "unknown"]), terminal: enm(["not-observed", "observed"]), exitCode: Type.Union([uint(2147483647), Type.Null()]), aborted: Type.Boolean(), timedOut: Type.Boolean() }),
 capture: Type.Union([Type.Null(), obj({ stdoutBytes: uint(), stderrBytes: uint(), stdoutRetainedBytes: uint(65536), stderrRetainedBytes: uint(16384), truncated: Type.Boolean(), complete: Type.Boolean(), validUtf8: Type.Boolean() })]),
});
export function validateMarkerGate(value: unknown): value is MarkerGate {
 if (!Check(markerGateSchema, value)) return false;
 const { state, attempt: a, capture: c } = value as MarkerGate;
 if (a.exitCode !== null && (a.terminal !== "observed" || !["started", "unknown"].includes(a.state))) return false;
 if (c && (c.stdoutRetainedBytes > c.stdoutBytes || c.stderrRetainedBytes > c.stderrBytes || c.complete && (!c.validUtf8 || c.truncated || c.stdoutBytes !== c.stdoutRetainedBytes || c.stderrBytes !== c.stderrRetainedBytes || a.state !== "started" || a.terminal !== "observed" || a.exitCode === null || a.aborted || a.timedOut))) return false;
 // The component currently admits only exactly empty, complete native exit-zero
 // listings. No nonempty protocol has been independently established.
 const clear = !!c?.complete && a.state === "started" && a.terminal === "observed" && a.exitCode === 0 && !a.aborted && !a.timedOut && c.stdoutBytes === 0 && c.stderrBytes === 0;
 return state === (clear ? "clear" : "unknown");
}
