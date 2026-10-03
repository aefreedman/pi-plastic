import { resolve } from "node:path";
import { captureSwitchCommand, emptySwitchAttempt, type SwitchCommandObservation } from "../execution/switch-command";
import { compareSwitchTarget, parseSwitchTarget, parseSwitchLoadedBranch, parseSwitchPending, switchPendingArgv, safeSwitchValue, admittedSwitchNoChanges, type SwitchReceipt, type SwitchRequest, type SwitchData, type SwitchStep, type SwitchStepName } from "../domain/switch-contract";
import { buildSwitchPendingProfile, canSwitchDirectWithPrivateOnlyPending, isSwitchBringBlockedForUnattended } from "../domain/switch-policy";
export { presentSwitchReceipt } from "../presentation/switch-results";
export { safeSwitchValue, compareSwitchTarget, parseSwitchTarget } from "../domain/switch-contract";
export type { SwitchReceipt, SwitchStep, SwitchData, SwitchAttempt, SwitchCapture, SwitchSummary, SwitchBranchObservation } from "../domain/switch-contract";
export function validateSwitchRequest(input: unknown): asserts input is SwitchRequest {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Switch request must be an object.");
    const r = input as Record<string, unknown>;
    if (Object.keys(r).some(k => !["branch", "pendingChanges", "preflight", "format", "workdir"].includes(k)) || !safeSwitchValue(r.branch) || !parseSwitchTarget(r.branch)) throw Error("Provide a bounded hierarchical branch selector with preserved complete qualification.");
    if (r.workdir !== undefined && !safeSwitchValue(r.workdir) || r.pendingChanges !== undefined && !["shelve", "bring", "cancel"].includes(r.pendingChanges as string) || r.format !== undefined && !["text", "json"].includes(r.format as string) || r.preflight !== undefined && typeof r.preflight !== "boolean") throw Error("Switch options are unsupported or invalid.");
}
export async function assembleSwitchReceipt(input: unknown): Promise<SwitchReceipt> {
    const data: SwitchData = { requestedTarget: null, workdir: null, pendingPolicy: "cancel", defaultedPolicy: true, preflight: false, strategy: "unresolved", wouldRun: false, plannedMutations: [], unattemptedMutations: [], steps: [], branchBefore: null, branchAfter: null, pendingBefore: null, pendingRecovery: null, observedShelveset: null, usedNoChangesShelveRecovery: false, targetVerification: "unverified", serverAliasEquivalence: "unverified", filePreservation: "unverified", xlinkEffects: "unverified", effect: "not-attempted" };
    let stage: "input" | SwitchStepName | "policy" | "producer" = "input";
    const finish = (outcome: SwitchReceipt["outcome"], code: Extract<SwitchReceipt, {ok:false}>["error"]["code"] = "observation_failed", message = "Switch evidence is unavailable; do not retry automatically."): SwitchReceipt => {
        const mutations = data.steps.filter(s => s.name === "shelve" || s.name === "switch");
        data.effect = mutations.some(s => s.effect === "uncertain") ? "uncertain" : mutations.some(s => s.effect === "command-completed") ? "command-completed" : "not-attempted";
        data.unattemptedMutations = data.plannedMutations.filter(name => !mutations.some(s => s.name === name && s.attempt.state !== "not-attempted"));
        const reads = data.steps.filter(s => s.name !== "shelve" && s.name !== "switch");
        return { schemaVersion: 1, action: "switch-branch", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" }, sourceAdmission: "windows-cm11.0.16.10371-observed", completeness: { read: reads.length ? reads.every(s => s.evidence === "admitted") ? "complete" : "incomplete" : "unknown", capture: data.steps.length ? data.steps.every(s => s.capture.complete) ? "complete" : "incomplete" : "unknown", projection: true }, data, ok: ["preflight", "already-loaded", "switched"].includes(outcome), outcome, ...(["preflight", "already-loaded", "switched"].includes(outcome) ? {} : {error:{code,stage,message}}) } as SwitchReceipt;
    };
    const normal = (o: SwitchCommandObservation) => !o.failed && o.capture.complete && o.attempt.state === "started" && o.attempt.terminal === "observed" && !o.attempt.aborted && !o.attempt.timedOut;
    const observe = async (name: SwitchStepName, argv: string[]) => {
        stage = name;
        const mutation = name === "shelve" || name === "switch";
        const s: SwitchStep = { name, argv: [...argv], attempt: { ...emptySwitchAttempt(), state:"unknown" }, capture: { stdoutBytes:0,stderrBytes:0,stdoutRetainedBytes:0,stderrRetainedBytes:0,truncated:false,complete:false,validUtf8:false }, evidence:"unadmitted", effect:mutation?"uncertain":"not-attempted", branch:null,summary:null,records:0 };
        data.steps.push(s);
        const o = await captureSwitchCommand(argv, data.workdir!);
        s.attempt = o.attempt; s.capture = o.capture;
        if (mutation) {
            s.effect = ["not-attempted","not-started"].includes(o.attempt.state) ? "not-attempted" : "uncertain";
            if (normal(o) && o.attempt.exitCode === 0 && !o.capture.stderrBytes) { s.effect="command-completed";s.evidence="terminal-only"; }
        } else if (normal(o) && o.attempt.exitCode === 0 && !o.capture.stderrBytes) {
            if (name === "branch-before" || name === "branch-after") { s.branch=parseSwitchLoadedBranch(o.stdout!);s.records=s.branch?1:0; }
            else { const p=parseSwitchPending(o.stdout!,data.workdir!);s.summary=p.summary;s.records=p.records; }
            if(s.branch || s.summary) { s.evidence="admitted";s.effect="read-observed"; }
        }
        return { o,s };
    };
    try {
        validateSwitchRequest(input);
        const r=input;
        const cwd=resolve(r.workdir??process.cwd());if(!safeSwitchValue(cwd))return finish("failed","invalid_request","Resolved workdir exceeds the bound.");
        Object.assign(data,{requestedTarget:r.branch,workdir:cwd,pendingPolicy:r.pendingChanges??"cancel",defaultedPolicy:r.pendingChanges===undefined,preflight:r.preflight??false});
        if(process.platform!=="win32")return finish("failed","unsupported_source","Switch source is admitted only on observed Windows/client configuration.");
        const before=await observe("branch-before",["status"]);data.branchBefore=before.s.branch;
        if(!data.branchBefore)return finish("failed");
        const pending=await observe("pending-before",switchPendingArgv);data.pendingBefore=pending.s.summary;
        if(!data.pendingBefore)return finish("failed");
        stage="policy";
        const verification=compareSwitchTarget(data.branchBefore,r.branch);
        if(verification!=="unverified") { data.strategy="already-on-target-branch";data.targetVerification=verification;return finish(data.preflight?"preflight":"already-loaded"); }
        const profile=buildSwitchPendingProfile({...data.pendingBefore,privatePaths:[]});
        if(!profile.hasPendingChanges)data.strategy="silent-noinput";
        else if(canSwitchDirectWithPrivateOnlyPending(data.pendingPolicy,data.defaultedPolicy,profile))data.strategy="direct-switch-private-only";
        else if(isSwitchBringBlockedForUnattended(data.pendingPolicy,profile)) { data.strategy="blocked-bring-tracked-pending";return finish(data.preflight?"preflight":"blocked","policy_blocked","Tracked pending bring requires interactive prompts and is blocked."); }
        else if(data.pendingPolicy==="cancel") { data.strategy="cancel-with-pending";return finish(data.preflight?"preflight":"canceled","policy_canceled","Switch canceled by pending-change policy; no mutation was attempted."); }
        else data.strategy="shelve-then-switch-noinput";
        data.plannedMutations=data.strategy==="shelve-then-switch-noinput"?["shelve","switch"]:["switch"];data.wouldRun=true;
        if(data.preflight)return finish("preflight");
        if(data.strategy==="shelve-then-switch-noinput") {
            const shelf=await observe("shelve",["shelveset","create","--all",`-c=Auto-shelve before switch to ${r.branch}`]);
            if(shelf.s.effect!=="command-completed") {
                if(!normal(shelf.o) || shelf.o.attempt.exitCode!==1 || !admittedSwitchNoChanges(shelf.o.stdout!,shelf.o.stderr!,cwd))return finish(data.effect==="not-attempted"&&["not-attempted","not-started"].includes(shelf.s.attempt.state)?"failed":"uncertain","mutation_failed");
                shelf.s.evidence="eligible-no-changes";
                const recovery=await observe("pending-recovery",switchPendingArgv);data.pendingRecovery=recovery.s.summary;
                if(!data.pendingRecovery || data.pendingRecovery.tracked!==0)return finish("uncertain","observation_failed","Shelve failed; recovery did not prove absence of tracked pending. No switch was attempted.");
                data.usedNoChangesShelveRecovery=true;
            }
        }
        const switched=await observe("switch",["switch","--silent","--noinput",r.branch]);
        if(switched.s.effect!=="command-completed")return finish(["not-attempted","not-started"].includes(switched.s.attempt.state)?"failed":"uncertain","mutation_failed");
        const after=await observe("branch-after",["status"]);data.branchAfter=after.s.branch;
        if(!data.branchAfter)return finish("command-completed-unverified","target_unverified","Switch command completed but loaded target could not be observed. Earlier effects remain; do not retry automatically.");
        data.targetVerification=compareSwitchTarget(data.branchAfter,r.branch);
        if(data.targetVerification==="unverified")return finish("command-completed-unverified","target_unverified","Switch command completed; requested target identity or full qualifier spelling remains unverified. Alias equivalence is not inferred.");
        // Eligible failed shelving remains uncertain preservation, even after a verified switch.
        if(data.usedNoChangesShelveRecovery) { stage="shelve";return finish("uncertain","mutation_failed","Loaded target observed after eligible recovery, but failed shelving did not prove preservation or absence of earlier effects."); }
        return finish("switched");
    } catch {
        return finish(data.steps.some(s=>(s.name==="shelve"||s.name==="switch")&&!["not-attempted","not-started"].includes(s.attempt.state))?"uncertain":"failed",stage==="input"?"invalid_request":"producer_failed",stage==="input"?"Switch request could not be admitted.":"Switch producer failed; inspect recorded earlier effects before another attempt.");
    }
}
