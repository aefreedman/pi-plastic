import { captureWorkspaceMergeCommand, emptyWorkspaceMergeAttempt } from "../execution/workspace-merge-command";
import { branchDeleteArgv, safeBranchDeleteText, validBranchDeleteOperand, type BranchDeleteData, type BranchDeleteError, type BranchDeleteReceipt } from "../domain/branch-delete-contract";
export { branchDeleteArgv, safeBranchDeleteText, validBranchDeleteOperand } from "../domain/branch-delete-contract";
export type { BranchDeleteReceipt } from "../domain/branch-delete-contract";
export { presentBranchDeleteReceipt } from "../presentation/branch-delete-results";
export function emptyBranchDeleteData(): BranchDeleteData { return { intendedArgv:["branch","delete"], requestedBranch:null, workingDirectory:null, deleteChangesetsRequested:null, previewRequested:null, outputFormatRequested:null, attempt:emptyWorkspaceMergeAttempt(), capture:null, observedDeletedBranch:null, observedDeletedChangesets:null, observedRepositoryIdentity:null, observedWorkspaceIdentity:null, verification:"unverified", rollback:"not-proven", effect:"not-attempted" }; }
function header(data:BranchDeleteData) { return { schemaVersion:1 as const, action:"branch-delete" as const, provenance:{source:"plastic" as const,producer:"@aefree/pi-plastic" as const,contentTrust:"external" as const},completeness:{capture:data.capture?data.capture.complete?"complete" as const:"incomplete" as const:"unknown" as const,projection:true as const},data }; }
export function branchDeleteFailure(data:BranchDeleteData,code:BranchDeleteError["code"],message:string):BranchDeleteReceipt { return {...header(data),ok:false,outcome:data.effect==="uncertain"?"uncertain":"failed",error:{code,message}}; }
export async function assembleBranchDeleteReceipt(args:unknown):Promise<BranchDeleteReceipt> {
 const data=emptyBranchDeleteData();let entered=false;
 try {
  if(!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(k=>!["branch","deleteChangesets","preflight","format","workdir"].includes(k)))return branchDeleteFailure(data,"invalid_request","Use only declared bounded branch-delete controls.");
  const i=Object.freeze({...args}) as Record<string,unknown>,branch=i.branch,cwd=i.workdir??(i.workdir===undefined?process.cwd():null),del=i.deleteChangesets===undefined?false:i.deleteChangesets,preview=i.preflight===undefined?false:i.preflight,format=i.format===undefined?"text":i.format;
  if(!validBranchDeleteOperand(branch)||!safeBranchDeleteText(cwd)||typeof del!=="boolean"||typeof preview!=="boolean"||!["text","json"].includes(format as string))return branchDeleteFailure(data,"invalid_request","Use one bounded exact branch operand, strict booleans and text/json. Options/stdin are not branch operands.");
  data.requestedBranch=branch;data.workingDirectory=cwd;data.deleteChangesetsRequested=del;data.previewRequested=preview;data.outputFormatRequested=format as "text"|"json";data.intendedArgv=branchDeleteArgv(branch,del);
  if(preview)return {...header(data),ok:true,outcome:"preflight"};
  entered=true;const o=await captureWorkspaceMergeCommand([...data.intendedArgv],cwd);data.attempt=o.attempt;data.capture=o.capture;
  if(o.capture.complete&&!o.failed&&o.attempt.state==="started"&&o.attempt.exitCode===0){data.effect="not-proven";return {...header(data),ok:true,outcome:"command-completed"};}
  data.effect=["started","unknown"].includes(data.attempt.state)?"uncertain":"not-attempted";
  return branchDeleteFailure(data,data.attempt.aborted?"aborted":data.effect==="uncertain"?"uncertain":"launch_failed",data.effect==="uncertain"?"Branch deletion completion is uncertain; branch/history effects may already exist.":"Branch deletion did not establish process start.");
 }catch{
  if(entered){data.attempt={...emptyWorkspaceMergeAttempt(),state:"unknown"};data.capture=null;data.effect="uncertain";}
  return branchDeleteFailure(data,"producer_failed","Branch deletion observation failed; no rollback or safe retry is proven.");
 }
}
