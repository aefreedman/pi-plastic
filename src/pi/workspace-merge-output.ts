import { safeNativeText } from "../domain/native-mutation";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleWorkspaceMergeReceipt, buildWorkspaceMergeArgv, type MergeAction, type WorkspaceMergeReceipt } from "../operations/workspace-merge-receipt";
import { presentWorkspaceMergeReceipt } from "../operations/workspace-merge-receipt";
import { nativeObject as obj, nativeDataProperties, nativeReceiptSchema, validateNativeReceipt } from "./native-mutation-output";
const requested = obj({ source: Type.String(), strategy: Type.Optional(Type.Union(["auto", "source", "destination"].map(s => Type.Literal(s)))), cherrypicking: Type.Optional(Type.Boolean()), forced: Type.Optional(Type.Boolean()), preflight: Type.Optional(Type.Boolean()), format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("json")])), workdir: Type.Optional(Type.String()) });
export const workspaceMergeOutputSchema = Type.Unsafe<WorkspaceMergeReceipt>(nativeReceiptSchema("merge", obj({ ...nativeDataProperties, requested: Type.Union([requested, Type.Null()]) })));
export function validateWorkspaceMergeOutput(value: unknown): value is WorkspaceMergeReceipt {
    if (!Check(workspaceMergeOutputSchema, value)) return false;
    const dto = value as WorkspaceMergeReceipt, d = dto.data;
    if (!validateNativeReceipt(dto)) return false;
    if (!d.requested) return !dto.ok && dto.error.code === "invalid_request" && d.command === null && d.capture === null;
    if (!safeNativeText(d.requested.source) || !d.requested.source.trim() || d.requested.source.trimStart().startsWith("-")) return false;
    const match = /^--startlineseparator=(__WM_[a-f0-9]{24}__)S__$/.exec(d.command?.[5] ?? "");
    return !!match && JSON.stringify(d.command) === JSON.stringify(buildWorkspaceMergeArgv(d.requested.source, d.requested.strategy ?? "auto", d.requested.cherrypicking ?? false, d.requested.forced ?? false, match[1])) && !!d.workingDirectory && (dto.outcome === "preflight") === (d.requested.preflight === true);
}
export async function executeWorkspaceMergeOutput(action: MergeAction, args: unknown) {
    const dto = await assembleWorkspaceMergeReceipt(action, args);
    if (!validateWorkspaceMergeOutput(dto)) throw Error("Native merge receipt is inconsistent; inspect effects before any retry.");
    return { content: [{ type: "text" as const, text: presentWorkspaceMergeReceipt(dto) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
