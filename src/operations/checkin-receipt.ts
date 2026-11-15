import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { nativeHeader, nativeOutcome, safeNativeText } from "../domain/native-mutation";
import { checkinIdentityCollector, checkinSafeComment, type CheckinData, type CheckinReceipt, type CheckinRequest, type CheckinSeparators } from "../domain/checkin-contract";
import { emptyNativeData, runNativeMutation } from "./native-mutation";
export { presentCheckinReceipt } from "../presentation/checkin-results";
export { checkinSafeValue, checkinSafeComment, parseCheckinChangeset, parseCheckinEmission } from "../domain/checkin-contract";
export type { CheckinReceipt } from "../domain/checkin-contract";
export function buildCheckinArgv(request: CheckinRequest, s: CheckinSeparators): string[] {
    return ["checkin", `-c=${request.message}`, ...(request.includeAll ? ["--all"] : []), ...(request.applyChanged ? ["--applychanged"] : []), ...(request.includePrivate ? ["--private"] : []), ...(request.paths ?? []), "--machinereadable", `--startlineseparator=${s.start}`, `--endlineseparator=${s.end}`, `--fieldseparator=${s.field}`];
}
export async function assembleCheckinReceipt(input: unknown): Promise<CheckinReceipt> {
    const data: CheckinData = { ...emptyNativeData(), requested: null, createdChangeset: null, observedChangesets: [], linkedChangesets: [], identityObservation: { complete: false, omitted: 0, malformed: false, ambiguousRoot: false } };
    const finish = (invalid = false): CheckinReceipt => ({ ...nativeHeader(data), ...nativeOutcome(data, data.requested?.preflight === true, invalid), action: "checkin", data });
    if (!input || typeof input !== "object" || Array.isArray(input)) return finish(true);
    const request = { ...input } as CheckinRequest;
    if (request.updateAfter === true) {
        const receipt = finish(true);
        if (!receipt.ok) receipt.error.message = "updateAfter is disabled for unattended safety; run an explicit noninteractive update separately.";
        return receipt;
    }
    if (Object.keys(request).some(k => !["message", "paths", "applyChanged", "includePrivate", "includeAll", "updateAfter", "preflight", "format", "workdir"].includes(k)) || !checkinSafeComment(request.message) || !request.message.trim() || request.workdir !== undefined && !safeNativeText(request.workdir) || request.format !== undefined && !["text", "json"].includes(request.format) || [request.applyChanged, request.includePrivate, request.includeAll, request.updateAfter, request.preflight].some(v => v !== undefined && typeof v !== "boolean") || request.paths !== undefined && (!Array.isArray(request.paths) || Array.from(request.paths).some(p => !safeNativeText(p) || !p.trim() || p.trimStart().startsWith("-"))) || Buffer.byteLength(JSON.stringify(request), "utf8") > 24576) return finish(true);
    if (request.paths) request.paths = [...request.paths];
    data.requested = request; data.workingDirectory = resolve(request.workdir ?? process.cwd());
    const nonce = randomBytes(16).toString("hex"), separators = { start: `__PI_CI_START_${nonce}__`, end: `__PI_CI_END_${nonce}__`, field: `__PI_CI_FIELD_${nonce}__` };
    data.command = buildCheckinArgv(request, separators);
    if (Buffer.byteLength(JSON.stringify(data.command), "utf8") > 32768) { data.requested = null; data.command = null; data.workingDirectory = null; return finish(true); }
    if (!request.preflight) {
        const collector = checkinIdentityCollector(separators);
        await runNativeMutation(data, collector.feed);
        const observed = collector.result(data.capture?.complete === true);
        data.observedChangesets = observed.observedChangesets; data.linkedChangesets = observed.linkedChangesets;
        data.identityObservation = observed.identityObservation;
        data.createdChangeset = !observed.identityObservation.ambiguousRoot && observed.changesets.length === 1 ? observed.changesets[0] : null;
    }
    return finish();
}
