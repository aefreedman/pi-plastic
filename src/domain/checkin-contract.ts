import type { NativeHeader, NativeOutcome, NativeCommandData } from "./native-mutation";
export type CheckinRequest = { message: string; paths?: string[]; applyChanged?: boolean; includePrivate?: boolean; includeAll?: boolean; updateAfter?: boolean; preflight?: boolean; format?: "text" | "json"; workdir?: string };
export type CheckinEmission = { id: string; branch: string; repository: string; server: string; mount: string };
export type CheckinChangeset = CheckinEmission & { mount: "/" };
export type CheckinSeparators = { start: string; end: string; field: string };
export type IdentityObservation = { complete: boolean; omitted: number; malformed: boolean; ambiguousRoot: boolean };
export type CheckinData = NativeCommandData & { requested: CheckinRequest | null; createdChangeset: CheckinChangeset | null; linkedChangesets: CheckinEmission[]; observedChangesets: CheckinEmission[]; identityObservation: IdentityObservation };
export type CheckinReceipt = NativeHeader & NativeOutcome & { action: "checkin"; data: CheckinData };
export const checkinUnsafeText = /[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const checkinSafeValue = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096 && !checkinUnsafeText.test(s);
// Comments alone admit CR/LF; all other controls, bounds and surrogate rules stay unchanged.
export const checkinSafeComment = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096 && !checkinUnsafeText.test(s.replace(/[\r\n]/g, " "));
// Loss-marker rejection is a conservative admission policy, not proof of original Unicode fidelity.
const identity = (s: string) => checkinSafeValue(s) && s === s.trim() && !/[?\uFFFD]/.test(s);
export const checkinDecimal = /^(0|[1-9][0-9]{0,19})$/;
export function parseCheckinEmission(payload: string): CheckinEmission | null {
    const m = /^cs:(0|[1-9][0-9]{0,19})@br:(\/[^@]+)@([^@]+)@([^@]+(?:@(cloud|unity))?) \(mount:'([^']+)'\)$/.exec(payload);
    if (!m || !m.slice(2, 5).every(identity) || m[2].endsWith("/")) return null;
    const mount = m[6];
    if (!identity(mount) || mount !== "/" && (!mount.startsWith("/") || mount.includes("\\") || mount.split("/").slice(1).some(p => !p || p === "." || p === ".."))) return null;
    return { id: m[1], branch: m[2], repository: m[3], server: m[4], mount };
}
export function parseCheckinChangeset(payload: string): CheckinChangeset | null {
    const emission = parseCheckinEmission(payload);
    return emission?.mount === "/" ? { ...emission, mount: "/" } : null;
}

/** Observe identities independently of progress grammar and command outcome.
 * Memory is bounded by retained identity bytes and one incomplete frame, never
 * by the number of files that Plastic may check in. */
export function checkinIdentityCollector(s: CheckinSeparators) {
    const observed: CheckinEmission[] = []; let buffer = "", discarding = false, malformed = false, omitted = 0, retainedBytes = 2;
    const accept = (frame: string) => {
        const fields = frame.split(s.field);
        if (fields[0] !== "CHANGESET") return;
        if (fields.length !== 2) { malformed = true; return; }
        for (const payload of fields[1].split(/(?<='\)),(?=cs:)/)) {
            const emission = parseCheckinEmission(payload);
            if (!emission) { malformed = true; continue; }
            // Include array separators in the retained identity byte budget.
            const bytes = Buffer.byteLength(JSON.stringify(emission), "utf8") + 1;
            if (retainedBytes + bytes > (emission.mount === "/" ? 32768 : 16384)) { omitted++; continue; }
            observed.push(emission); retainedBytes += bytes;
        }
    };
    const feed = (chunk: string) => {
        // Process bounded slices even when a stream yields a very large chunk.
        for (let offset = 0; offset < chunk.length; offset += 4096) {
            buffer += chunk.slice(offset, offset + 4096);
            while (true) {
                if (discarding) {
                    const end = buffer.indexOf(s.end);
                    if (end < 0) { buffer = buffer.slice(-s.end.length); break; }
                    buffer = buffer.slice(end + s.end.length); discarding = false;
                }
                const start = buffer.indexOf(s.start);
                if (start < 0) { buffer = buffer.slice(-s.start.length); break; }
                if (start) buffer = buffer.slice(start);
                const end = buffer.indexOf(s.end, s.start.length);
                if (end >= 0) { if (end > 65536) malformed = true; else accept(buffer.slice(s.start.length, end)); buffer = buffer.slice(end + s.end.length); continue; }
                if (buffer.length > 65536) { malformed = true; discarding = true; buffer = buffer.slice(-s.end.length); }
                break;
            }
        }
    };
    const result = (transportComplete = true) => {
        const roots = observed.filter((c): c is CheckinChangeset => c.mount === "/");
        const ambiguousRoot = roots.length > 1 || new Set(observed.map(c => c.mount)).size !== observed.length;
        const incomplete = malformed || discarding || buffer.startsWith(s.start) || omitted > 0 || ambiguousRoot;
        return { observedChangesets: observed, changesets: roots, linkedChangesets: observed.filter(c => c.mount !== "/"), identityObservation: { complete: transportComplete && !incomplete && observed.length > 0, omitted, malformed: malformed || discarding || buffer.startsWith(s.start), ambiguousRoot } };
    };
    return { feed, result };
}
export function parseCheckinEvidence(text: string, separators: CheckinSeparators) {
    const collector = checkinIdentityCollector(separators); collector.feed(text);
    const result = collector.result();
    return { ...result, admitted: result.identityObservation.complete, records: text.split(/\r?\n/).filter(Boolean).length };
}
