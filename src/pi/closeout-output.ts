import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleCloseoutReceipt } from "../operations/closeout-receipt";
import { closeoutCaptures, closeoutChildEffect, CLOSEOUT_DTO_BYTES, CLOSEOUT_STAGE_NAMES, type CloseoutReceipt } from "../domain/closeout-contract";
import { compareSwitchTarget, parseSwitchTarget } from "../domain/switch-contract";
import { nativeHeader, nativeOutcome } from "../domain/native-mutation";
import { nativeObject as obj, nativeDataProperties, validateNativeReceipt } from "./native-mutation-output";
import { workspaceMergeOutputSchema, validateWorkspaceMergeOutput } from "./workspace-merge-output";
import { checkinOutputSchema, validateCheckinOutput } from "./checkin-output";
import { presentCloseoutReceipt } from "../operations/closeout-receipt";
const str = () => Type.String(), nil = <T extends ReturnType<typeof Type.Object> | ReturnType<typeof Type.String>>(s: T) => Type.Union([s, Type.Null()]);
const branch = obj({ branch: str(), repository: str(), server: str(), basis: Type.Literal("standard-status"), scope: Type.Literal("loaded-workspace") });
const requested = obj({ ...Object.fromEntries(["source", "target", "cardRef", "message", "workdir"].map(k => [k, Type.Optional(str())])), ...Object.fromEntries(["updateTarget", "includePrivate", "preflight"].map(k => [k, Type.Optional(Type.Boolean())])), strategy: Type.Optional(Type.Union(["auto", "source", "destination"].map(s => Type.Literal(s)))), format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("json")])) });
const emission = obj({ id: str(), branch: str(), repository: str(), server: str(), mount: str() });
const stageName = Type.Union(CLOSEOUT_STAGE_NAMES.map(s => Type.Literal(s)));
const stage = Type.Union([obj({ name: stageName, kind: Type.Literal("read"), result: obj({ ...nativeDataProperties, branch: nil(branch) }) }), obj({ name: stageName, kind: Type.Literal("command"), result: obj(nativeDataProperties) }), obj({ name: stageName, kind: Type.Literal("merge"), result: workspaceMergeOutputSchema }), obj({ name: stageName, kind: Type.Literal("checkin"), result: checkinOutputSchema })]);
export const closeoutOutputSchema = Type.Unsafe<CloseoutReceipt>(obj({ schemaVersion: Type.Literal(2), action: Type.Literal("merge-to-branch"), provenance: obj({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }), completeness: obj({ capture: Type.Union(["complete", "incomplete", "unknown"].map(s => Type.Literal(s))), projection: Type.Boolean() }), ok: Type.Boolean(), outcome: Type.Union(["preflight", "completed", "blocked", "failed", "uncertain"].map(s => Type.Literal(s))), error: Type.Optional(obj({ code: str(), stage: str(), message: str() })), data: obj({ requested: nil(requested), workingDirectory: nil(str()), sourceBranch: nil(str()), targetBranch: nil(str()), plan: Type.Array(str()), stages: Type.Array(stage, { maxItems: 10 }), createdChangeset: nil(emission), linkedChangesets: Type.Array(emission), stoppedAt: nil(str()), effect: Type.Union(["not-attempted", "command-completed", "uncertain"].map(s => Type.Literal(s))) }) }));
export function validateCloseoutOutput(value: unknown): value is CloseoutReceipt {
    if (!Check(closeoutOutputSchema, value) || Buffer.byteLength(JSON.stringify(value), "utf8") > CLOSEOUT_DTO_BYTES) return false;
    const dto = value as CloseoutReceipt, d = dto.data, r = d.requested, stages = d.stages;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const captures = closeoutCaptures(stages), effects = stages.map(closeoutChildEffect);
    if (dto.completeness.capture !== (!captures.length ? "unknown" : captures.every(c => c.complete) ? "complete" : "incomplete") || dto.completeness.projection !== captures.every(c => !c.truncated) || d.effect !== (effects.includes("uncertain") ? "uncertain" : effects.includes("command-completed") ? "command-completed" : "not-attempted")) return false;
    if (!r) return !dto.ok && dto.outcome === "failed" && !stages.length && d.sourceBranch === null && d.targetBranch === null;
    if (r.preflight) return dto.ok && dto.outcome === "preflight" && !stages.length && d.sourceBranch === (r.source ?? null) && d.targetBranch === (r.target ?? null) && !d.createdChangeset && !d.linkedChangesets.length;
    const initial = stages[0];
    const initialBranch = initial?.kind === "read" ? initial.result.branch : null;
    if (d.sourceBranch && (!parseSwitchTarget(d.sourceBranch) || initialBranch && d.sourceBranch !== (r.source ?? initialBranch.branch)) || d.targetBranch && !parseSwitchTarget(d.targetBranch)) return false;
    const plan = ["loaded-before", ...(r.target === undefined ? ["parent"] : []), "pending-before", ...(initialBranch && d.targetBranch && compareSwitchTarget(initialBranch, d.targetBranch) !== "unverified" ? [] : ["switch"]), "loaded-target", ...(r.updateTarget !== false ? ["update", "loaded-before-merge"] : []), "merge", "checkin", "loaded-final"];
    for (const [index, s] of stages.entries()) {
        if (s.name !== plan[index]) return false;
        const expectedKind = s.name === "merge" ? "merge" : s.name === "checkin" ? "checkin" : ["switch", "update"].includes(s.name) ? "command" : "read";
        if (s.kind !== expectedKind) return false;
        if (s.kind === "read" || s.kind === "command") {
            if (!validateNativeReceipt({ ...nativeHeader(s.result), ...nativeOutcome(s.result, false), data: s.result }) || s.result.workingDirectory !== d.workingDirectory) return false;
            if (s.kind === "command" && !same(s.result.command, s.name === "switch" ? ["switch", "--silent", "--noinput", d.targetBranch] : s.name === "update" ? ["update", "--dontmerge", "--noinput"] : [])) return false;
            if (s.kind === "command" && index < stages.length - 1 && !s.result.commandCompleted) return false;
        } else if (s.kind === "merge") {
            if (s.name !== "merge" || !validateWorkspaceMergeOutput(s.result) || s.result.data.requested?.source !== d.sourceBranch || s.result.data.requested?.strategy !== (r.strategy ?? "auto") || s.result.data.workingDirectory !== d.workingDirectory || s.result.data.requested?.preflight === true || index < stages.length - 1 && !s.result.ok) return false;
        } else if (s.name !== "checkin" || !validateCheckinOutput(s.result) || s.result.data.workingDirectory !== d.workingDirectory || s.result.data.requested?.includeAll !== true || s.result.data.requested?.includePrivate !== (r.includePrivate ?? false) || s.result.data.requested?.paths !== undefined || s.result.data.requested?.preflight === true || index < stages.length - 1 && !s.result.ok) return false;
    }
    if (stages.some(s => s.kind !== "read")) {
        const pending = stages.find(s => s.name === "pending-before");
        if (initial?.kind !== "read" || !initial.result.commandCompleted || initial.result.capture?.truncated || initial.result.commandOutput?.stdout?.split(/\r?\n/).slice(1).some(l => l.trim()) || pending?.kind !== "read" || !pending.result.commandCompleted || pending.result.capture?.truncated || !/^STATUS\x1f[0-9]+\x1f[^\r\n\x1f]+\x1f[^\r\n\x1f]+\r?\n?$/.test(pending.result.commandOutput?.stdout ?? "")) return false;
    }
    const checked = stages.find(s => s.kind === "checkin");
    if (!same(d.createdChangeset, checked?.kind === "checkin" ? checked.result.data.createdChangeset : null) || !same(d.linkedChangesets, checked?.kind === "checkin" ? checked.result.data.linkedChangesets : [])) return false;
    return dto.ok ? dto.outcome === "completed" && stages.length === plan.length && checked?.kind === "checkin" && checked.result.ok && !d.stoppedAt : !!dto.error.code && dto.error.stage === (d.stoppedAt ?? "input") && dto.outcome === (d.effect !== "not-attempted" ? "uncertain" : dto.error.code === "dirty_workspace" ? "blocked" : "failed");
}
export async function executeCloseoutOutput(args: unknown) {
    const dto = await assembleCloseoutReceipt(args);
    if (!validateCloseoutOutput(dto)) throw Error("Native closeout ledger is inconsistent; inspect effects before any retry.");
    return { content: [{ type: "text" as const, text: presentCloseoutReceipt(dto, dto.data.requested?.format) }], details: {}, structuredContent: dto, isError: !dto.ok };
}
