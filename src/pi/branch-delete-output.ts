import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleBranchDeleteReceipt, branchDeleteArgv, branchDeleteFailure, emptyBranchDeleteData, presentBranchDeleteReceipt, safeBranchDeleteText, validBranchDeleteOperand, type BranchDeleteReceipt } from "../operations/branch-delete-receipt";
const obj=(p:Record<string,any>)=>Type.Object(p,{additionalProperties:false}),enm=(v:string[])=>Type.Union(v.map(x=>Type.Literal(x))),nil=(s:any)=>Type.Union([s,Type.Null()]),uint=(max=Number.MAX_SAFE_INTEGER)=>Type.Integer({minimum:0,maximum:max}),text=Type.String({minLength:1,maxLength:4096});
const attempt=obj({state:enm(["not-attempted","not-started","started","unknown"]),terminal:enm(["not-observed","observed"]),exitCode:nil(uint(2147483647)),aborted:Type.Boolean(),timedOut:Type.Boolean()});
const capture=obj({stdoutBytes:uint(),stderrBytes:uint(),stdoutRetainedBytes:uint(65536),stderrRetainedBytes:uint(16384),truncated:Type.Boolean(),complete:Type.Boolean(),validUtf8:Type.Boolean()});
const data={intendedArgv:Type.Array(text,{minItems:2,maxItems:4}),requestedBranch:nil(text),workingDirectory:nil(text),deleteChangesetsRequested:nil(Type.Boolean()),previewRequested:nil(Type.Boolean()),outputFormatRequested:nil(enm(["text","json"])),attempt,capture:nil(capture),observedDeletedBranch:Type.Null(),observedDeletedChangesets:Type.Null(),observedRepositoryIdentity:Type.Null(),observedWorkspaceIdentity:Type.Null(),verification:Type.Literal("unverified"),rollback:Type.Literal("not-proven")};
const header={schemaVersion:Type.Literal(1),action:Type.Literal("branch-delete"),provenance:obj({source:Type.Literal("plastic"),producer:Type.Literal("@aefree/pi-plastic"),contentTrust:Type.Literal("external")}),completeness:obj({capture:enm(["complete","incomplete","unknown"]),projection:Type.Literal(true)})};
const error=obj({code:enm(["invalid_request","launch_failed","aborted","uncertain","producer_failed"]),message:Type.String({minLength:1,maxLength:256})});
export const branchDeleteOutputSchema=Type.Unsafe<BranchDeleteReceipt>(Type.Union([
 obj({...header,ok:Type.Literal(true),outcome:Type.Literal("preflight"),data:obj({...data,effect:Type.Literal("not-attempted")})}),
 obj({...header,ok:Type.Literal(true),outcome:Type.Literal("command-completed"),data:obj({...data,effect:Type.Literal("not-proven")})}),
 obj({...header,ok:Type.Literal(false),outcome:Type.Literal("failed"),data:obj({...data,effect:Type.Literal("not-attempted")}),error}),
 obj({...header,ok:Type.Literal(false),outcome:Type.Literal("uncertain"),data:obj({...data,effect:Type.Literal("uncertain")}),error})
]));
export function validateBranchDeleteOutput(v:unknown):v is BranchDeleteReceipt {
 if(!Check(branchDeleteOutputSchema,v)||Buffer.byteLength(JSON.stringify(v),"utf8")>131072)return false;
 const dto=v as BranchDeleteReceipt,d=dto.data,a=d.attempt,c=d.capture;
 if(d.requestedBranch===null){
  if(JSON.stringify(d.intendedArgv)!==JSON.stringify(["branch","delete"])||[d.workingDirectory,d.deleteChangesetsRequested,d.previewRequested,d.outputFormatRequested].some(x=>x!==null)||c||a.terminal!=="not-observed"||a.exitCode!==null||a.aborted||a.timedOut||!["not-attempted","unknown"].includes(a.state))return false;
 }else{
  if(!validBranchDeleteOperand(d.requestedBranch)||!safeBranchDeleteText(d.workingDirectory)||typeof d.deleteChangesetsRequested!=="boolean"||typeof d.previewRequested!=="boolean"||d.outputFormatRequested===null||JSON.stringify(d.intendedArgv)!==JSON.stringify(branchDeleteArgv(d.requestedBranch,d.deleteChangesetsRequested)))return false;
 }
 if(a.exitCode!==null&&a.terminal!=="observed"||["not-attempted","not-started"].includes(a.state)&&(a.terminal!=="not-observed"||a.exitCode!==null)||a.state==="not-attempted"&&a.timedOut)return false;
 if(c){
  if(d.requestedBranch===null||c.stdoutRetainedBytes>c.stdoutBytes||c.stderrRetainedBytes>c.stderrBytes)return false;
  if(c.complete&&(!c.validUtf8||c.truncated||c.stdoutBytes!==c.stdoutRetainedBytes||c.stderrBytes!==c.stderrRetainedBytes||a.state!=="started"||a.terminal!=="observed"||a.exitCode===null||a.aborted||a.timedOut))return false;
  if(a.state==="not-attempted"&&(!a.aborted||c.stdoutBytes||c.stderrBytes||c.validUtf8||c.complete))return false;
 }
 if(dto.completeness.capture!==(c?c.complete?"complete":"incomplete":"unknown"))return false;
 if(d.previewRequested===true&&(!dto.ok||dto.outcome!=="preflight"||d.requestedBranch===null||c||a.state!=="not-attempted"||a.terminal!=="not-observed"||a.exitCode!==null||a.aborted||a.timedOut))return false;
 if(dto.ok&&dto.outcome==="preflight"&&(d.previewRequested!==true||d.requestedBranch===null))return false;
 if(dto.ok&&dto.outcome==="command-completed"&&(d.previewRequested!==false||d.requestedBranch===null||!c?.complete||a.state!=="started"||a.exitCode!==0))return false;
 if(!dto.ok){
  if(!safeBranchDeleteText(dto.error.message))return false;
  if(dto.outcome==="uncertain"&&!["started","unknown"].includes(a.state)||dto.outcome==="failed"&&!["not-attempted","not-started"].includes(a.state))return false;
  if(dto.error.code==="invalid_request"&&(d.requestedBranch!==null||c||a.state!=="not-attempted"||a.aborted))return false;
  if(dto.error.code==="aborted"&&!a.aborted||dto.error.code==="launch_failed"&&!["not-attempted","not-started"].includes(a.state))return false;
 }
 return true;
}
export async function executeBranchDeleteOutput(args:unknown) {
 let dto=await assembleBranchDeleteReceipt(args);const valid:boolean=validateBranchDeleteOutput(dto);
 if(!valid){const possible=["started","unknown"].includes(dto.data.attempt.state),d=emptyBranchDeleteData();if(possible){d.attempt.state="unknown";d.effect="uncertain";}dto=branchDeleteFailure(d,"producer_failed","Branch-delete receipt validation failed; effects remain possible, no automatic retry.");if(!validateBranchDeleteOutput(dto))throw Error("Safe branch-delete receipt unavailable.");}
 return {content:[{type:"text" as const,text:presentBranchDeleteReceipt(dto)}],details:{},structuredContent:dto,isError:!dto.ok};
}
