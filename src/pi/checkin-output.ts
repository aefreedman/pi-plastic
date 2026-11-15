import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleCheckinReceipt, buildCheckinArgv } from "../operations/checkin-receipt";
import { checkinSafeComment, parseCheckinEmission, type CheckinReceipt } from "../domain/checkin-contract";
import { presentCheckinReceipt } from "../operations/checkin-receipt";
import { nativeObject as obj, nativeDataProperties, nativeReceiptSchema, validateNativeReceipt } from "./native-mutation-output";
const emission = obj({ id: Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$" }), branch: Type.String(), repository: Type.String(), server: Type.String(), mount: Type.String() });
const requested = obj({ message: Type.String(), paths: Type.Optional(Type.Array(Type.String())), ...Object.fromEntries(["applyChanged", "includePrivate", "includeAll", "updateAfter", "preflight"].map(k => [k, Type.Optional(Type.Boolean())])), format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("json")])), workdir: Type.Optional(Type.String()) });
export const checkinOutputSchema = Type.Unsafe<CheckinReceipt>(nativeReceiptSchema("checkin", obj({ ...nativeDataProperties, requested: Type.Union([requested, Type.Null()]), createdChangeset: Type.Union([emission, Type.Null()]), linkedChangesets: Type.Array(emission), observedChangesets: Type.Array(emission), identityObservation: obj({ complete: Type.Boolean(), omitted: Type.Integer({ minimum: 0 }), malformed: Type.Boolean(), ambiguousRoot: Type.Boolean() }) })));
export function validateCheckinOutput(value: unknown): value is CheckinReceipt {
    if (!Check(checkinOutputSchema, value)) return false;
    const dto = value as CheckinReceipt, d = dto.data;
    if (!validateNativeReceipt(dto) || Buffer.byteLength(JSON.stringify(d.observedChangesets), "utf8") > 32768) return false;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (d.observedChangesets.some(c => !parseCheckinEmission(`cs:${c.id}@br:${c.branch}@${c.repository}@${c.server} (mount:'${c.mount}')`))) return false;
    const roots = d.observedChangesets.filter(c => c.mount === "/"), ambiguous = roots.length > 1 || new Set(d.observedChangesets.map(c => c.mount)).size !== d.observedChangesets.length;
    if (d.identityObservation.ambiguousRoot !== ambiguous || !same(d.createdChangeset, !ambiguous && roots.length === 1 ? roots[0] : null) || !same(d.linkedChangesets, d.observedChangesets.filter(c => c.mount !== "/"))) return false;
    if (d.identityObservation.complete && (!d.capture?.complete || !d.observedChangesets.length || ambiguous || d.identityObservation.omitted || d.identityObservation.malformed)) return false;
    if (!d.requested) return !dto.ok && dto.error.code === "invalid_request" && d.command === null && d.capture === null && !d.observedChangesets.length;
    if (!checkinSafeComment(d.requested.message) || !d.requested.message.trim() || d.requested.updateAfter === true || d.requested.paths?.some(p => !p.trim() || p.trimStart().startsWith("-")) || Buffer.byteLength(JSON.stringify(d.requested), "utf8") > 24576) return false;
    const argv = d.command ?? [], option = (name: string) => argv.find(a => a.startsWith(name + "="))?.slice(name.length + 1) ?? "";
    const separators = { start: option("--startlineseparator"), end: option("--endlineseparator"), field: option("--fieldseparator") };
    return !!d.workingDirectory && /^__PI_CI_START_[a-f0-9]{32}__$/.test(separators.start) && same(argv, buildCheckinArgv(d.requested, separators)) && (dto.outcome === "preflight") === (d.requested.preflight === true) && (dto.outcome !== "preflight" || !d.observedChangesets.length);
}
export async function executeCheckinOutput(args: unknown) {
    const dto = await assembleCheckinReceipt(args);
    if (!validateCheckinOutput(dto)) throw Error("Native checkin receipt is inconsistent; inspect effects before any retry.");
    return { content: [{ type: "text" as const, text: presentCheckinReceipt(dto, dto.data.requested?.format) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
