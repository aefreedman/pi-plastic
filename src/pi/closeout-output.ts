import { Type } from "typebox";
import { Check } from "typebox/value";
import { resolve } from "node:path";
import { switchOutputSchema, validateSwitchOutput } from "./switch-output";
import { updateOutputSchema, validateUpdateOutput } from "./update-output";
import { workspaceMergeOutputSchema, validateWorkspaceMergeOutput } from "./workspace-merge-output";
import { checkinOutputSchema, validateCheckinOutput } from "./checkin-output";
import { buildCloseoutParentArgv, assembleCloseoutReceipt, presentCloseoutReceipt, CLOSEOUT_STAGE_NAMES, CLOSEOUT_DTO_BYTES, closeoutCaptures, closeoutChildEffect, compareSwitchTarget, parseSwitchTarget, safeSwitchValue, switchPendingArgv, checkinSafeValue, cmWhereEquals, type CloseoutReceipt, type CloseoutStage, type CloseoutRead } from "../operations/closeout-receipt";
const obj=(p:Record<string,any>)=>Type.Object(p,{additionalProperties:false}),enm=(v:readonly string[])=>Type.Union(v.map(x=>Type.Literal(x))),nil=(t:any)=>Type.Union([t,Type.Null()]),str=(max=4096)=>Type.String({maxLength:max}),uint=(max=Number.MAX_SAFE_INTEGER)=>Type.Integer({minimum:0,maximum:max});
const attempt=obj({state:enm(["not-attempted","not-started","started","unknown"]),terminal:enm(["not-observed","observed"]),exitCode:nil(uint(2147483647)),aborted:Type.Boolean(),timedOut:Type.Boolean()});
const capture=obj({stdoutBytes:uint(),stderrBytes:uint(),stdoutRetainedBytes:uint(65536),stderrRetainedBytes:uint(16384),truncated:Type.Boolean(),complete:Type.Boolean(),validUtf8:Type.Boolean()});
const branch=obj({branch:str(),repository:str(),server:str(),basis:Type.Literal("standard-status"),scope:Type.Literal("loaded-workspace")});
const summary=obj(Object.fromEntries(["totalPending","tracked","private","added","changed","moved","deleted","other"].map(k=>[k,uint(20000)])));
const changeset=obj({id:Type.String({pattern:"^(0|[1-9][0-9]{0,19})$"}),branch:str(),repository:str(),server:str(),mount:Type.Literal("/")});
const read=obj({argv:Type.Array(str(16384),{minItems:1,maxItems:5}),attempt,capture:nil(capture),admission:enm(["unsupported","admitted"]),branch:nil(branch),parentPath:nil(str()),emptyParentResult:Type.Boolean(),summary:nil(summary)});
const stage=Type.Union([obj({name:enm(CLOSEOUT_STAGE_NAMES),kind:Type.Literal("read"),result:read}),...[["switch",switchOutputSchema],["update",updateOutputSchema],["merge",workspaceMergeOutputSchema],["checkin",checkinOutputSchema]].map(([k,s])=>obj({name:enm(CLOSEOUT_STAGE_NAMES),kind:Type.Literal(k as string),result:s}))]);
const requested=obj({source:nil(str()),target:nil(str()),message:nil(str()),cardRef:nil(str()),strategy:enm(["auto","source","destination"]),updateTarget:Type.Boolean(),includePrivate:Type.Boolean(),preflight:Type.Boolean(),outputFormat:enm(["text","json"]),workdir:str()});
const data=obj({requested:nil(requested),sourceBranch:nil(str()),targetBranch:nil(str()),targetSource:enm(["unresolved","explicit","parent-read"]),checkinMessage:nil(str(16384)),stages:Type.Array(stage,{maxItems:16}),unattemptedStages:Type.Array(enm(CLOSEOUT_STAGE_NAMES),{maxItems:14,uniqueItems:true}),unobservedChild:nil(enm(["switch","update","merge","checkin-preflight","checkin"])),createdChangeset:nil(changeset),pendingAfter:nil(summary),targetVerification:enm(["unverified","name-only","exact-qualifier-spelling"]),serverAliasEquivalence:Type.Literal("unverified"),sourceLink:Type.Literal("unverified"),branchHead:Type.Literal("unverified"),exclusiveScope:Type.Literal("unverified"),rollback:Type.Literal("not-proven"),effect:enm(["not-attempted","command-completed","uncertain","changeset-created"])});
const header={schemaVersion:Type.Literal(1),action:Type.Literal("merge-to-branch"),provenance:obj({source:Type.Literal("plastic"),producer:Type.Literal("@aefree/pi-plastic"),contentTrust:Type.Literal("external")}),completeness:obj({capture:enm(["complete","incomplete","unknown"]),projection:Type.Boolean()}),data};
export const closeoutOutputSchema=Type.Unsafe<CloseoutReceipt>(Type.Union([obj({...header,ok:Type.Literal(true),outcome:enm(["preflight","completed"])}),obj({...header,ok:Type.Literal(false),outcome:enm(["blocked","failed","uncertain"]),error:obj({code:enm(["invalid_request","unsupported_source","observation_failed","target_unverified","policy_blocked","child_failed","producer_failed"]),stage:enm(["input",...CLOSEOUT_STAGE_NAMES,"producer"]),message:str(256)})})]));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const normal=(s:CloseoutRead)=>s.capture?.complete&&s.attempt.state==="started"&&s.attempt.terminal==="observed"&&s.attempt.exitCode===0&&!s.attempt.aborted&&!s.attempt.timedOut&&s.capture.stderrBytes===0;
function validateRead(s:CloseoutStage&{kind:"read"}):boolean {
 const r=s.result,c=r.capture,a=r.attempt;
 if(a.exitCode!==null&&a.terminal!=="observed")return false;
 if(c&&(c.stdoutRetainedBytes>c.stdoutBytes||c.stderrRetainedBytes>c.stderrBytes||c.complete&&(!c.validUtf8||c.truncated||c.stdoutRetainedBytes!==c.stdoutBytes||c.stderrRetainedBytes!==c.stderrBytes||a.state!=="started"||a.terminal!=="observed"||a.exitCode===null||a.aborted||a.timedOut)))return false;
 if(r.admission==="admitted"&&!normal(r))return false;
 if(r.admission==="unsupported"&&(r.branch||r.parentPath||r.summary||r.emptyParentResult))return false;
 if(s.name.startsWith("loaded-")) {if(!same(r.argv,["status"])||r.parentPath||r.summary||r.emptyParentResult||r.admission==="admitted"&&!r.branch)return false;if(r.branch&&(!parseSwitchTarget(`${r.branch.branch}@${r.branch.repository}@${r.branch.server}`)||!safeSwitchValue(r.branch.branch)))return false;}
 else if(s.name==="parent"){if(r.branch||r.summary||r.admission==="admitted"&&!(r.emptyParentResult?!r.parentPath:!!r.parentPath&&!!parseSwitchTarget(r.parentPath)))return false;}
 else if(s.name==="pending-before"||s.name==="pending-final"){if(!same(r.argv,[...switchPendingArgv])||r.branch||r.parentPath||r.emptyParentResult||r.admission==="admitted"&&!r.summary)return false;if(r.summary){const p=r.summary;if(p.tracked!==p.added+p.changed+p.moved+p.deleted||p.totalPending!==p.tracked+p.private+p.other)return false;}}
 else if(s.name==="readiness"){if(!(same(r.argv,["status"])||same(r.argv,[...switchPendingArgv]))||r.branch||r.parentPath||r.summary||r.emptyParentResult||r.admission==="admitted"&&!r.capture?.stdoutBytes)return false;}
 else return false;
 return true;
}
export function validateCloseoutOutput(value:unknown):value is CloseoutReceipt {
 if(!Check(closeoutOutputSchema,value)||Buffer.byteLength(JSON.stringify(value),"utf8")>CLOSEOUT_DTO_BYTES)return false;
 const dto=value as CloseoutReceipt,d=dto.data,r=d.requested,stages=d.stages;
 if(!same(d.unattemptedStages,CLOSEOUT_STAGE_NAMES.filter(n=>!stages.some(s=>s.name===n)&&d.unobservedChild!==n)))return false;
 const caps=closeoutCaptures(stages),expectedCapture=!caps.length?"unknown":!d.unobservedChild&&stages.every(s=>s.kind!=="read"||s.result.capture!==null)&&caps.every(c=>c.complete)?"complete":"incomplete";
 if(dto.completeness.capture!==expectedCapture||dto.completeness.projection!==stages.every(s=>s.kind==="read"||s.result.completeness.projection))return false;
 const effects=stages.map(closeoutChildEffect),effect=d.createdChangeset?"changeset-created":d.unobservedChild||effects.includes("uncertain")?"uncertain":effects.includes("command-completed")?"command-completed":"not-attempted";
 if(d.effect!==effect)return false;
 if(!r)return !dto.ok&&dto.outcome==="failed"&&dto.error.code==="invalid_request"&&dto.error.stage==="input"&&!stages.length&&!d.unobservedChild&&!d.sourceBranch&&!d.targetBranch&&d.targetSource==="unresolved"&&!d.checkinMessage&&!d.createdChangeset&&!d.pendingAfter&&d.targetVerification==="unverified";
 if(!safeSwitchValue(r.workdir)||r.source!==null&&!parseSwitchTarget(r.source)||r.target!==null&&!parseSwitchTarget(r.target)||r.message!==null&&!checkinSafeValue(r.message)||r.cardRef!==null&&!checkinSafeValue(r.cardRef)||Buffer.byteLength(JSON.stringify(r),"utf8")>32768+256)return false;
 const parentCount=stages.filter(s=>s.name==="parent").length;if(parentCount>1||r.target!==null&&parentCount)return false;
 const plan=["loaded-before",...(r.target===null?Array(Math.max(1,parentCount)).fill("parent"):[]),"pending-before","switch","loaded-after-switch",...(r.updateTarget?["update"]:[]),"loaded-before-merge","merge","readiness","loaded-before-checkin","checkin-preflight","checkin","loaded-final","pending-final"];
 if(stages.some((s,i)=>s.name!==plan[i])||d.unobservedChild&&d.unobservedChild!==plan[stages.length])return false;
 if(d.unobservedChild&&(dto.ok||dto.error.code!=="producer_failed"||dto.error.stage!==d.unobservedChild))return false;
 const initial=stages[0]?.kind==="read"?stages[0].result.branch:null;
 if(d.sourceBranch!==null&&(!initial||d.sourceBranch!==(r.source??initial.branch)))return false;
 if(d.targetSource==="explicit"&&(d.targetBranch!==r.target||r.target===null)||d.targetSource==="unresolved"&&d.targetBranch!==null)return false;
 const parent=stages.filter(s=>s.name==="parent"&&s.kind==="read").at(-1) as (CloseoutStage&{kind:"read"})|undefined;
 if(d.targetSource==="parent-read"){if(!parent?.result.parentPath||r.target!==null||!d.sourceBranch)return false;const src=parseSwitchTarget(d.sourceBranch)!;if(d.targetBranch!==(src.repository===null?parent.result.parentPath:`${parent.result.parentPath}@${src.repository}@${src.server}`))return false;}
 if(d.targetBranch!==null&&!parseSwitchTarget(d.targetBranch))return false;
 if(d.checkinMessage!==null&&(!d.sourceBranch||!d.targetBranch||d.checkinMessage!==(r.message?.trim()||`Merge ${d.sourceBranch} into ${d.targetBranch}${r.cardRef?.trim()?`\n\n${r.cardRef.trim()}`:""}`)))return false;
 let lastVerification="unverified";
 for(const [index,s] of stages.entries()) {
  if(s.kind==="read") {
   if(!validateRead(s))return false;
   if(s.name==="readiness"){const merge=stages.slice(0,index).find(x=>x.kind==="merge");if(!merge||merge.kind!=="merge"||!same(s.result.argv,merge.result.data.protocol==="apply-add-copied"?[...switchPendingArgv]:["status"]))return false;}
   if(s.name==="parent"){if(!d.sourceBranch||!same(s.result.argv,buildCloseoutParentArgv(d.sourceBranch)))return false;const src=parseSwitchTarget(d.sourceBranch)!;if(s.result.parentPath&&(s.result.parentPath!==src.branch.slice(0,src.branch.lastIndexOf("/"))||!s.result.capture?.stdoutBytes))return false;if(s.result.emptyParentResult&&s.result.capture?.stdoutBytes!==0)return false;if(index<stages.length-1&&(s.result.emptyParentResult||!s.result.parentPath||stages[index+1].name!=="pending-before"))return false;}
   if(index<stages.length-1&&s.result.admission!=="admitted")return false;
   if(s.name.startsWith("loaded-")&&s.name!=="loaded-before"&&s.result.branch){if(!d.targetBranch)return false;lastVerification=compareSwitchTarget(s.result.branch,d.targetBranch);if(index<stages.length-1&&lastVerification==="unverified")return false;}
  }else{
   if(!d.sourceBranch||!d.targetBranch||!d.checkinMessage||!checkinSafeValue(d.checkinMessage))return false;
   if(s.kind==="switch"){if(s.name!=="switch"||!validateSwitchOutput(s.result)||s.result.data.requestedTarget!==d.targetBranch||s.result.data.pendingPolicy!=="cancel"||s.result.data.preflight||s.result.data.workdir!==resolve(r.workdir))return false;}
   else if(s.kind==="update"){if(s.name!=="update"||!validateUpdateOutput(s.result)||s.result.data.workingDirectory!==r.workdir)return false;}
   else if(s.kind==="merge"){if(s.name!=="merge"||!validateWorkspaceMergeOutput(s.result)||s.result.action!=="merge"||s.result.data.requestedSource!==d.sourceBranch||s.result.data.strategy!==r.strategy||s.result.data.workingDirectory!==r.workdir||s.result.data.previewRequested!==false||s.result.data.cherrypicking||s.result.data.forced)return false;}
   else{if(!["checkin-preflight","checkin"].includes(s.name)||!validateCheckinOutput(s.result)||s.name==="checkin-preflight"&&s.result.ok&&s.result.outcome!=="preflight"||s.name==="checkin"&&s.result.ok&&s.result.outcome!=="completed")return false;const cmd=s.result.data.command,expected=["cm","checkin",`-c=${d.checkinMessage}`,"--all",...(r.includePrivate?["--private"]:[])];if(cmd&&(!same(cmd.slice(0,expected.length),expected)||cmd[expected.length]!=="--machinereadable"))return false;}
   if(index<stages.length-1&&!s.result.ok)return false;
  }
 }
 const pending=stages.find(s=>s.name==="pending-before");if(pending&&pending.kind==="read"&&pending.result.summary&&d.targetBranch&&initial){const v=compareSwitchTarget(initial,d.targetBranch);if(!stages.some(s=>s.name.startsWith("loaded-")&&s.name!=="loaded-before"&&s.kind==="read"&&s.result.branch))lastVerification=v;if(v==="unverified"&&pending.result.summary.totalPending>0&&stages.some(s=>s.kind!=="read"))return false;}
 if(d.targetVerification!==lastVerification)return false;
 if(dto.ok||stages.some(s=>s.kind!=="read")){if(!initial||!d.targetBranch||!d.sourceBranch||parseSwitchTarget(d.sourceBranch)!.branch===parseSwitchTarget(d.targetBranch)!.branch)return false;for(const spec of [d.sourceBranch,d.targetBranch]){const p=parseSwitchTarget(spec)!;if(p.repository!==null&&(p.repository!==initial.repository||p.server!==initial.server))return false;}}
 const checked=stages.find(s=>s.name==="checkin"&&s.kind==="checkin") as (CloseoutStage&{kind:"checkin"})|undefined;
 if(!same(d.createdChangeset,checked?.result.data.createdChangeset??null))return false;
 const final=stages.find(s=>s.name==="pending-final"&&s.kind==="read") as (CloseoutStage&{kind:"read"})|undefined;
 if(!same(d.pendingAfter,final?.result.summary??null))return false;
 if(r.preflight&&(stages.some(s=>s.kind!=="read"||!["loaded-before","parent","pending-before"].includes(s.name))||d.unobservedChild))return false;
 if(dto.ok){if(dto.outcome==="preflight")return r.preflight&&!!d.sourceBranch&&!!d.targetBranch&&!!d.checkinMessage&&checkinSafeValue(d.checkinMessage)&&stages.at(-1)?.name==="pending-before"&&pending?.kind==="read"&&pending.result.admission==="admitted"&&d.effect==="not-attempted";const loaded=stages.find(s=>s.name==="loaded-final"&&s.kind==="read") as (CloseoutStage&{kind:"read"})|undefined,b=loaded?.result.branch,c=d.createdChangeset;return !r.preflight&&stages.length===plan.length&&!!c&&!!b&&c.branch===b.branch&&c.repository===b.repository&&c.server===b.server&&!!d.pendingAfter&&d.targetVerification!=="unverified"&&final?.result.admission==="admitted";}
 if(!safeSwitchValue(dto.error.message))return false;
 if(dto.outcome==="uncertain"?d.effect==="not-attempted":d.effect!=="not-attempted")return false;
 return dto.error.stage==="input"&&!stages.length||dto.error.stage===stages.at(-1)?.name||dto.error.stage===d.unobservedChild;
}
export async function executeCloseoutOutput(args:unknown){const dto=await assembleCloseoutReceipt(args);if(!validateCloseoutOutput(dto))throw Error("Closeout receipt could not be validated; prior effects remain possible. No automatic retry.");return {content:[{type:"text" as const,text:presentCloseoutReceipt(dto)}],details:{},structuredContent:dto,isError:!dto.ok};}
