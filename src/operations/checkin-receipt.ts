import { randomBytes } from "node:crypto";
import { buildFallbackScopePaths } from "../domain/paths";
import { summarizePendingItems, resolveCheckinPaths, filterPendingItemsByScope, selectPrivatePathsForAutoAdd, type PendingItem } from "../domain/pending";
import { captureCheckinCommand, type CheckinCommandObservation } from "../execution/checkin-command";
import { checkinSafeValue, parseCheckinEvidence, parseCheckinPending, type CheckinData, type CheckinReceipt, type CheckinRequest, type CheckinStep, type CheckinSummary } from "../domain/checkin-contract";
const pendingArgv = ["status", "--machinereadable", "--includeRevId", "--fieldseparator=\x1f"];
const summary = (items: PendingItem[], cwd: string): CheckinSummary => { const { privatePaths: _, ...s } = summarizePendingItems(items, cwd); return s; };
const normal = (o: CheckinCommandObservation) => o.capture.complete && !o.failed && o.attempt.state === "started" && o.attempt.terminal === "observed" && o.attempt.exitCode !== null && !o.attempt.aborted && !o.attempt.timedOut;
const success = (o: CheckinCommandObservation) => normal(o) && o.attempt.exitCode === 0 && o.capture.stderrBytes === 0;
function validateRequest(input: unknown): asserts input is CheckinRequest {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid bounded checkin input.");
    const r = input as Record<string, unknown>;
    if (!checkinSafeValue(r.message) || !r.message.trim() || r.workdir !== undefined && !checkinSafeValue(r.workdir) || r.format !== undefined && !["text", "json"].includes(r.format as string)) throw Error("Invalid bounded checkin input.");
    for (const k of ["applyChanged", "includePrivate", "includeAll", "updateAfter", "preflight"]) if (r[k] !== undefined && typeof r[k] !== "boolean") throw Error("Invalid checkin option.");
    if (r.paths !== undefined && (!Array.isArray(r.paths) || r.paths.length > 100 || !r.paths.every(p => checkinSafeValue(p) && p.trim() && p !== "-" && !p.startsWith("-")))) throw Error("Invalid bounded checkin paths.");
    const values = [r.message, r.workdir ?? "", ...(r.paths as string[] ?? [])] as string[];
    if (values.reduce((n, s) => n + s.length, 0) > 16384 || Buffer.byteLength(JSON.stringify(values), "utf8") > 32768) throw Error("Checkin input exceeds aggregate bound.");
}
export async function assembleCheckinReceipt(input: unknown): Promise<CheckinReceipt> {
    const data: CheckinData = { sourceAdmission: "windows-cm11.0.16.10371-observed", requestedPaths: [], includedPaths: [], fallbackPaths: [], excludedPaths: [], privateAddPaths: [], blockedPrivatePaths: [], itemEvents: [], observedChangesets: [], command: null, steps: [], autoEnabledApplyChanged: false, usedFallbackRetry: false, usedPrivateAutoAddRecovery: false, pendingBefore: null, pendingAfter: null, wouldRun: false, omittedReferences: 0, scopeExhaustion: "unverified", branchHead: "unverified", serverAliasEquivalence: "unverified", xlinkEffects: "unverified", mergeLinkIdentity: "unverified" };
    let created: CheckinReceipt["data"]["createdChangeset"] = null;
    const finish = (outcome: CheckinReceipt["outcome"], code = "uncertain", stage: "input" | "pending" | "checkin" | "producer" = "checkin", message = "Checkin evidence is uncertain; inspect workspace/repository state before deciding whether to retry."): CheckinReceipt => {
        const effects = data.steps.filter(s => s.operation !== "status").map(s => s.effect);
        const effect = created ? "changeset-created" : effects.includes("uncertain") ? "uncertain" : effects.includes("command-completed") ? "command-completed" : "not-attempted";
        // Full evidence classification is complete before any whole-reference projection.
        let remaining = 100;
        const project = <T>(a: T[]): T[] => { const n = Math.min(a.length, remaining); remaining -= n; data.omittedReferences += a.length - n; return a.slice(0, n); };
        data.requestedPaths = project(data.requestedPaths); data.includedPaths = project(data.includedPaths); data.fallbackPaths = project(data.fallbackPaths); data.excludedPaths = project(data.excludedPaths); data.privateAddPaths = project(data.privateAddPaths); data.blockedPrivatePaths = project(data.blockedPrivatePaths); data.itemEvents = project(data.itemEvents); data.observedChangesets = project(data.observedChangesets);
        if (data.command) { if (data.command.length > remaining) { data.omittedReferences += data.command.length; data.command = null; } else remaining -= data.command.length; }
        const ok = outcome === "preflight" || outcome === "completed";
        const dto = { schemaVersion: 1, action: "checkin", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, ok, outcome, completeness: { capture: data.steps.length ? data.steps.every(s => s.capture.complete) ? "complete" : "incomplete" : "unknown", projection: data.omittedReferences === 0 }, data: { ...data, effect, createdChangeset: created }, ...(!ok ? { error: { code, stage, message } } : {}) } as CheckinReceipt;
        if (Buffer.byteLength(JSON.stringify(dto), "utf8") > 131072) {
            const d = dto.data;
            for (const key of ["requestedPaths", "includedPaths", "fallbackPaths", "excludedPaths", "privateAddPaths", "blockedPrivatePaths", "itemEvents", "observedChangesets"] as const) { d.omittedReferences += d[key].length; d[key] = [] as any; }
            if (d.command) { d.omittedReferences += d.command.length; d.command = null; } dto.completeness.projection = false;
        }
        return dto;
    };
    let stage: "input" | "pending" | "checkin" | "producer" = "input";
    let dispatchEntered = false;
    try {
        validateRequest(input);
        if (input.updateAfter) return finish("failed", "UNATTENDED_UPDATE_AFTER_BLOCKED", "input", "updateAfter is disabled for unattended safety. Run plastic_update() then plastic_merge(...) with an explicit conflict policy.");
        const cwd = input.workdir ?? process.cwd();
        if (!checkinSafeValue(cwd)) return finish("failed", "invalid_request", "input", "Invalid bounded workdir.");
        if (process.platform !== "win32") return finish("unsupported", "source_platform_unadmitted", "pending", "Checkin sources are admitted only on the observed Windows client.");
        data.requestedPaths = input.paths ?? [];
        const record = async (name: CheckinStep["name"], argv: string[]) => {
            if (data.steps.length >= 8) throw Error("Step bound exceeded.");
            dispatchEntered = true;
            const mutation = argv[0] !== "status";
            const s: CheckinStep = { name, operation: argv[0] as CheckinStep["operation"], attempt: { state: "unknown", terminal: "not-observed", exitCode: null, aborted: false, timedOut: false }, capture: { stdoutBytes: 0, stderrBytes: 0, stdoutRetainedBytes: 0, stderrRetainedBytes: 0, truncated: false, complete: false, validUtf8: false }, effect: mutation ? "uncertain" : "not-attempted", evidence: "unadmitted", records: 0, summary: null, changeset: null };
            data.steps.push(s);
            const o = await captureCheckinCommand(argv, cwd);
            s.attempt = o.attempt; s.capture = o.capture;
            if (mutation && ["not-started", "not-attempted"].includes(o.attempt.state)) s.effect = "not-attempted";
            return { o, s };
        };
        const read = async (name: "pending-before" | "pending-recovery" | "pending-after") => {
            const { o, s } = await record(name, pendingArgv), p = parseCheckinPending(o.stdout ?? "", cwd);
            s.records = p.records;
            if (success(o) && p.admitted) { s.evidence = "admitted"; s.effect = "read-observed"; s.summary = summary(p.items, cwd); return p; }
            return null;
        };
        stage = "pending";
        const before = await read("pending-before");
        if (!before) return finish("unsupported", "pending_source_unadmitted", "pending", "Pending selection could not be admitted; no mutation was dispatched.");
        data.pendingBefore = summary(before.items, cwd);
        let includedAbsolute: string[] = [], scoped = before.items, apply = input.applyChanged ?? false;
        if (input.paths?.length) {
            const r = resolveCheckinPaths(input.paths, before.items, cwd);
            data.includedPaths = r.includedPaths; data.fallbackPaths = r.fallbackPaths; data.excludedPaths = r.excludedPaths; includedAbsolute = r.includedAbsolutePaths;
            data.autoEnabledApplyChanged = r.shouldApplyChanged && !apply; apply ||= r.shouldApplyChanged;
            scoped = filterPendingItemsByScope(before.items, includedAbsolute);
            if (!data.includedPaths.length) return finish("failed", "NO_PENDING_PATHS", "pending", "None of the provided checkin paths have admitted pending changes.");
        }
        const nonce = randomBytes(16).toString("hex"), seps = { start: `__PI_CI_START_${nonce}__`, end: `__PI_CI_END_${nonce}__`, field: `__PI_CI_FIELD_${nonce}__` };
        const command = (paths: string[], force: boolean) => ["checkin", `-c=${input.message}`, ...(input.includeAll ? ["--all"] : []), ...(force ? ["--applychanged"] : []), ...(input.includePrivate ? ["--private"] : []), ...paths, "--machinereadable", `--startlineseparator=${seps.start}`, `--endlineseparator=${seps.end}`, `--fieldseparator=${seps.field}`];
        const initial = command(data.includedPaths, apply); data.command = ["cm", ...initial]; data.wouldRun = true;
        if (input.preflight) return finish("preflight");
        const attempt = async (name: "initial-checkin" | "private-retry" | "fallback-checkin", argv: string[]) => {
            const { o, s } = await record(name, argv), p = parseCheckinEvidence(o.stdout ?? "", seps); s.records = p.records;
            const admitted = p.admitted && p.changesets.every(c => c.repository === before.repository);
            if (admitted && normal(o)) {
                s.evidence = "admitted";
                data.itemEvents.push(...p.events); data.observedChangesets.push(...p.changesets);
            }
            if (success(o) && admitted && p.changesets.length === 1) { created = p.changesets[0]; s.changeset = created; s.effect = "changeset-created"; }
            // Only genuine complete native failure without a created record may drive the existing recovery policy.
            const retryEligible = normal(o) && admitted && o.attempt.exitCode !== 0 && p.changesets.length === 0;
            return { completed: !!s.changeset, retryEligible, message: retryEligible ? o.stderr ?? "" : "" };
        };
        stage = "checkin";
        let result = await attempt("initial-checkin", initial);
        if (!result.completed && !result.retryEligible) return finish("uncertain");
        if (!result.completed && /checkin operation cannot be started because there is a merge in progress|finish it before checkin|in progress merge/i.test(result.message)) {
            await record("merge-diagnostic", ["status"]);
            return finish("uncertain", "merge_in_progress", "checkin", "Checkin blocked by a merge in progress. Resolve files and use plastic_finalizeMerge(source=<original source>, strategy=destination) only when that conflict policy is intentional, then inspect before retrying.");
        }
        const scopedSummary = summary(scoped, cwd), noChanges = (m: string) => /no changes in the workspace/i.test(m);
        if (!result.completed && noChanges(result.message) && !input.includePrivate && scopedSummary.private > 0 && scopedSummary.tracked === 0 && (input.includeAll || data.requestedPaths.length)) {
            const selection = selectPrivatePathsForAutoAdd(scoped, includedAbsolute, cwd); data.blockedPrivatePaths = selection.blockedPaths;
            if (selection.candidatePaths.length) {
                const { o, s } = await record("private-add", ["add", ...selection.candidatePaths]);
                data.privateAddPaths = selection.candidatePaths;
                if (!normal(o) || o.attempt.exitCode !== 0) return finish("uncertain", "private_add_uncertain");
                s.effect = "command-completed"; data.usedPrivateAutoAddRecovery = true;
                result = await attempt("private-retry", initial);
                if (!result.completed && !result.retryEligible) return finish("uncertain");
            } else if (selection.blockedPaths.length) return finish("uncertain", "sensitive_private_paths", "checkin", "Only private items matched sensitive filters. Use plastic_add(paths=[...]) with explicit safe paths or includePrivate=true only when intentional.");
        }
        if (!result.completed && noChanges(result.message) && !input.includePrivate && scopedSummary.private > 0 && scopedSummary.tracked === 0 && !input.includeAll && !data.requestedPaths.length) return finish("uncertain", "private_items_ineligible", "checkin", "Only private items were pending without includeAll/includePrivate. Add expected files explicitly or use includePrivate=true only when intentional.");
        if (!result.completed && noChanges(result.message) && scopedSummary.tracked > 0) {
            const recovery = await read("pending-recovery");
            if (recovery) data.pendingAfter = summary(recovery.items, cwd);
            // Observation failure cannot mean clean; even genuinely empty pending cannot prove this checkin completed.
            return finish("uncertain", recovery ? "no_changes_unverified" : "pending_recovery_failed");
        }
        if (!result.completed && input.paths?.length && /is not changed in current workspace|none of the provided checkin paths/i.test(result.message)) {
            const fallback = data.fallbackPaths.length ? data.fallbackPaths : buildFallbackScopePaths(includedAbsolute, cwd), argv = command(fallback, true);
            if (fallback.length && argv.join("\0") !== initial.join("\0")) {
                data.usedFallbackRetry = true; data.fallbackPaths = fallback;
                result = await attempt("fallback-checkin", argv);
            }
        }
        if (!result.completed) return finish("uncertain");
        const after = await read("pending-after");
        if (after) data.pendingAfter = summary(after.items, cwd);
        // Created identity proof is independent of a later pending-read failure.
        return finish("completed");
    } catch {
        if (stage === "input") return finish("failed", "invalid_request", "input", "Invalid bounded checkin request.");
        if (dispatchEntered && stage === "checkin") return finish("uncertain", "producer_failed", "producer");
        return finish("failed", "pending_read_failed", "pending", "Pending read could not be completed; no mutation was dispatched.");
    }
}

export { presentCheckinReceipt } from "../presentation/checkin-results";
export { checkinSafeValue, parseCheckinChangeset } from "../domain/checkin-contract";
export type { CheckinReceipt } from "../domain/checkin-contract";
