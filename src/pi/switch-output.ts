import { Type, type TProperties } from "typebox";
import { Check } from "typebox/value";
import { assembleSwitchReceipt, presentSwitchReceipt, safeSwitchValue, parseSwitchTarget, compareSwitchTarget, type SwitchReceipt, type SwitchStep, type SwitchSummary, type SwitchBranchObservation } from "../operations/switch-receipt";
const object = <P extends TProperties>(p:P) => Type.Object(p,{additionalProperties:false});
const enumeration = <const V extends readonly string[]>(v:V) => Type.Unsafe<V[number]>({anyOf:v.map(value=>({type:"string",const:value}))});
const str = (max=4096) => Type.String({maxLength:max,minLength:1});
const uint = (max=Number.MAX_SAFE_INTEGER) => Type.Integer({minimum:0,maximum:max});
const nullable = (s:ReturnType<typeof Type.Object>|ReturnType<typeof Type.String>) => Type.Union([s,Type.Null()]);
const attempt = object({state:enumeration(["not-attempted","not-started","started","unknown"]),terminal:enumeration(["not-observed","observed"]),exitCode:Type.Union([uint(2147483647),Type.Null()]),aborted:Type.Boolean(),timedOut:Type.Boolean()});
const capture = object({stdoutBytes:uint(),stderrBytes:uint(),stdoutRetainedBytes:uint(1048576),stderrRetainedBytes:uint(65536),truncated:Type.Boolean(),complete:Type.Boolean(),validUtf8:Type.Boolean()});
const branch = object({branch:str(),repository:str(),server:str(),basis:Type.Literal("standard-status"),scope:Type.Literal("loaded-workspace")});
const summary = object({totalPending:uint(19999),tracked:uint(19999),private:uint(19999),added:uint(19999),changed:uint(19999),moved:uint(19999),deleted:uint(19999),other:uint(19999)});
const names=["branch-before","pending-before","shelve","pending-recovery","switch","branch-after"] as const;
const step=object({name:enumeration(names),argv:Type.Array(str(8192),{minItems:1,maxItems:4}),attempt,capture,evidence:enumeration(["unadmitted","admitted","terminal-only","eligible-no-changes"]),effect:enumeration(["read-observed","not-attempted","command-completed","uncertain"]),branch:nullable(branch),summary:nullable(summary),records:uint(20001)});
const mutations=Type.Array(enumeration(["shelve","switch"]),{maxItems:2});
const data=object({requestedTarget:nullable(str()),workdir:nullable(str()),pendingPolicy:enumeration(["shelve","bring","cancel"]),defaultedPolicy:Type.Boolean(),preflight:Type.Boolean(),strategy:enumeration(["unresolved","already-on-target-branch","silent-noinput","direct-switch-private-only","blocked-bring-tracked-pending","cancel-with-pending","shelve-then-switch-noinput"]),wouldRun:Type.Boolean(),plannedMutations:mutations,unattemptedMutations:mutations,steps:Type.Array(step,{maxItems:6}),branchBefore:nullable(branch),branchAfter:nullable(branch),pendingBefore:nullable(summary),pendingRecovery:nullable(summary),observedShelveset:Type.Null(),usedNoChangesShelveRecovery:Type.Boolean(),targetVerification:enumeration(["unverified","name-only","exact-qualifier-spelling"]),serverAliasEquivalence:Type.Literal("unverified"),filePreservation:Type.Literal("unverified"),xlinkEffects:Type.Literal("unverified"),effect:enumeration(["not-attempted","command-completed","uncertain"])});
const base={schemaVersion:Type.Literal(1),action:Type.Literal("switch-branch"),provenance:object({source:Type.Literal("plastic"),producer:Type.Literal("@aefree/pi-plastic"),contentTrust:Type.Literal("external")}),sourceAdmission:Type.Literal("windows-cm11.0.16.10371-observed"),completeness:object({read:enumeration(["complete","incomplete","unknown"]),capture:enumeration(["complete","incomplete","unknown"]),projection:Type.Literal(true)}),data};
const error=object({code:enumeration(["invalid_request","unsupported_source","observation_failed","policy_canceled","policy_blocked","mutation_failed","target_unverified","producer_failed"]),stage:enumeration(["input",...names,"policy","producer"]),message:str(256)});
export const switchOutputSchema=Type.Unsafe<SwitchReceipt>(Type.Union([object({...base,ok:Type.Literal(true),outcome:enumeration(["preflight","already-loaded","switched"])}),object({...base,ok:Type.Literal(false),outcome:enumeration(["canceled","blocked","failed","uncertain","command-completed-unverified"]),error})]));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const validSummary=(s:SwitchSummary)=>s.totalPending===s.tracked+s.private&&s.totalPending===s.added+s.changed+s.moved+s.deleted+s.other+s.private;
const validBranch=(b:SwitchBranchObservation)=>safeSwitchValue(`${b.branch}@${b.repository}@${b.server}`)&&!!parseSwitchTarget(`${b.branch}@${b.repository}@${b.server}`);
const normal=(s:SwitchStep)=>s.capture.complete&&s.attempt.state==="started"&&s.attempt.terminal==="observed"&&!s.attempt.aborted&&!s.attempt.timedOut;
export function validateSwitchOutput(value:unknown):value is SwitchReceipt {
    if(!Check(switchOutputSchema,value)||Buffer.byteLength(JSON.stringify(value),"utf8")>131072)return false;
    const dto=value as SwitchReceipt,d=dto.data;
    if(!dto.ok&&!safeSwitchValue(dto.error.message))return false;
    if(d.requestedTarget!==null&&!parseSwitchTarget(d.requestedTarget)||d.workdir!==null&&!safeSwitchValue(d.workdir))return false;
    if(d.steps.length&&(!d.requestedTarget||!d.workdir)||d.defaultedPolicy&&d.pendingPolicy!=="cancel")return false;
    let prior=-1;
    for(const s of d.steps){
        const i=names.indexOf(s.name);if(i<=prior)return false;prior=i;
        const mut=s.name==="shelve"||s.name==="switch",pending=s.name==="pending-before"||s.name==="pending-recovery",a=s.attempt,c=s.capture;
        const expected=s.name==="shelve"?["shelveset","create","--all",`-c=Auto-shelve before switch to ${d.requestedTarget}`]:s.name==="switch"?["switch","--silent","--noinput",d.requestedTarget]:pending?["status","--machinereadable","--includeRevId","--fieldseparator=\x1f"]:["status"];
        if(!same(s.argv,expected)||c.stdoutRetainedBytes>(pending?1048576:65536)||c.stderrRetainedBytes>(pending?65536:16384)||c.stdoutRetainedBytes>c.stdoutBytes||c.stderrRetainedBytes>c.stderrBytes)return false;
        if(a.exitCode!==null&&(a.terminal!=="observed"||a.state!=="started"&&a.state!=="unknown")||a.state==="not-attempted"&&(a.terminal!=="not-observed"||a.timedOut)||a.state==="not-started"&&a.exitCode!==null)return false;
        if(c.complete&&(!c.validUtf8||c.truncated||c.stdoutRetainedBytes!==c.stdoutBytes||c.stderrRetainedBytes!==c.stderrBytes||a.state!=="started"||a.terminal!=="observed"||a.exitCode===null||a.aborted||a.timedOut))return false;
        if(s.branch&&!validBranch(s.branch)||s.summary&&!validSummary(s.summary))return false;
        if(s.evidence==="admitted") { if(mut||!normal(s)||a.exitCode!==0||c.stderrBytes||s.effect!=="read-observed"||(pending?!s.summary||!!s.branch||s.records!==s.summary.totalPending+1:!s.branch||!!s.summary||s.records!==1))return false; }
        else if(s.branch||s.summary||s.effect==="read-observed")return false;
        if(mut){
            if(s.records||!d.plannedMutations.includes(s.name as "shelve"|"switch"))return false;
            const completed=normal(s)&&a.exitCode===0&&!c.stderrBytes;
            if(s.effect!== (completed?"command-completed":["not-attempted","not-started"].includes(a.state)?"not-attempted":"uncertain"))return false;
            if(s.evidence==="terminal-only"&&!completed||completed&&s.evidence!=="terminal-only")return false;
            if(s.evidence==="eligible-no-changes"&&(s.name!=="shelve"||!normal(s)||a.exitCode!==1||c.stdoutBytes!==0||c.stderrBytes===0))return false;
        }else if(!["admitted","unadmitted"].includes(s.evidence)||s.evidence==="unadmitted"&&s.effect!=="not-attempted")return false;
    }
    if(d.steps.length&&d.steps[0].name!=="branch-before"||d.steps.length>1&&(d.steps[0].evidence!=="admitted"||d.steps[1].name!=="pending-before"))return false;
    const find=(name:SwitchStep["name"])=>d.steps.find(s=>s.name===name);
    if(!same(d.branchBefore,find("branch-before")?.branch??null)||!same(d.branchAfter,find("branch-after")?.branch??null)||!same(d.pendingBefore,find("pending-before")?.summary??null)||!same(d.pendingRecovery,find("pending-recovery")?.summary??null))return false;
    if(find("branch-after")&&!find("switch")||find("branch-after")&&find("switch")?.effect!=="command-completed")return false;
    if(find("shelve")&&d.strategy!=="shelve-then-switch-noinput"||find("pending-recovery")&&find("shelve")?.evidence!=="eligible-no-changes")return false;
    if(find("switch")&&find("shelve")&&find("shelve")?.effect!=="command-completed"&&(!d.usedNoChangesShelveRecovery||!d.pendingRecovery||d.pendingRecovery.tracked!==0))return false;
    if(d.usedNoChangesShelveRecovery!==!!(find("pending-recovery")?.evidence==="admitted"&&d.pendingRecovery?.tracked===0))return false;
    const ms=d.steps.filter(s=>s.name==="shelve"||s.name==="switch");
    const effect=ms.some(s=>s.effect==="uncertain")?"uncertain":ms.some(s=>s.effect==="command-completed")?"command-completed":"not-attempted";
    if(d.effect!==effect||!same(d.unattemptedMutations,d.plannedMutations.filter(n=>!ms.some(s=>s.name===n&&s.attempt.state!=="not-attempted"))))return false;
    if(d.wouldRun!==!!d.plannedMutations.length||!same(d.plannedMutations,d.strategy==="shelve-then-switch-noinput"?["shelve","switch"]:["silent-noinput","direct-switch-private-only"].includes(d.strategy)?["switch"]:[]))return false;
    if(d.pendingBefore){
        const p=d.pendingBefore,match=!!d.branchBefore&&compareSwitchTarget(d.branchBefore,d.requestedTarget!)!=="unverified";
        const expected=match?"already-on-target-branch":!p.totalPending?"silent-noinput":p.private>0&&p.tracked===0&&(d.pendingPolicy!=="cancel"||d.defaultedPolicy)?"direct-switch-private-only":d.pendingPolicy==="bring"&&p.tracked>0?"blocked-bring-tracked-pending":d.pendingPolicy==="cancel"?"cancel-with-pending":"shelve-then-switch-noinput";
        if(d.strategy!==expected)return false;
    }else if(d.strategy!=="unresolved")return false;
    const observation=d.strategy==="already-on-target-branch"?d.branchBefore:d.branchAfter;
    if(d.targetVerification!==(observation&&d.requestedTarget?compareSwitchTarget(observation,d.requestedTarget):"unverified"))return false;
    if(dto.outcome==="preflight"&&(!d.preflight||!d.pendingBefore||ms.length)||dto.outcome==="already-loaded"&&(d.preflight||d.strategy!=="already-on-target-branch"||ms.length||d.targetVerification==="unverified"))return false;
    if(dto.outcome==="switched"&&(d.preflight||!d.branchAfter||find("switch")?.effect!=="command-completed"||d.targetVerification==="unverified"||d.usedNoChangesShelveRecovery||d.effect!=="command-completed"))return false;
    if(dto.outcome==="canceled"&&(d.preflight||d.strategy!=="cancel-with-pending"||ms.length)||dto.outcome==="blocked"&&(d.preflight||d.strategy!=="blocked-bring-tracked-pending"||ms.length))return false;
    if(dto.outcome==="command-completed-unverified"&&(find("switch")?.effect!=="command-completed"||d.targetVerification!=="unverified"))return false;
    if(dto.ok&&dto.outcome!=="preflight"&&d.preflight)return false;
    const reads=d.steps.filter(s=>s.name!=="shelve"&&s.name!=="switch");
    if(dto.completeness.capture!==(d.steps.length?d.steps.every(s=>s.capture.complete)?"complete":"incomplete":"unknown")||dto.completeness.read!==(reads.length?reads.every(s=>s.evidence==="admitted")?"complete":"incomplete":"unknown"))return false;
    return true;
}
export async function executeSwitchOutput(args:unknown){
    const dto=await assembleSwitchReceipt(args);
    if(!validateSwitchOutput(dto))throw Error("Bounded switch receipt could not be validated. Earlier effects may exist; do not retry automatically.");
    return {content:[{type:"text" as const,text:presentSwitchReceipt(dto,(args as SwitchReceipt["data"] & {format?:string})?.format==="json"?"json":"text")}],details:{},structuredContent:dto,isError:!dto.ok};
}
