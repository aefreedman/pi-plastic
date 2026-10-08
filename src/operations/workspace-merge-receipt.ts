import { randomBytes } from "node:crypto";
import { win32 } from "node:path";
import { parseCopiedPending, admitCopiedStandardStatus, copiedPendingArgv, copiedPathKey } from "../domain/copied-merge";
import { captureWorkspaceMergeCommand, emptyWorkspaceMergeAttempt } from "../execution/workspace-merge-command";
import { admitCleanStandardStatus, admitWorkspaceMergeOutput, buildWorkspaceMergeArgv, safeMergeText, type MergeAction, type MergeStage, type WorkspaceMergeData, type WorkspaceMergeReceipt, type MergeStrategy } from "../domain/workspace-merge-contract";
export type { WorkspaceMergeReceipt, MergeAction } from "../domain/workspace-merge-contract";
export { safeMergeText, buildWorkspaceMergeArgv } from "../domain/workspace-merge-contract";
export { presentWorkspaceMergeReceipt } from "../presentation/workspace-merge-results";
export const emptyMergeStage = (): MergeStage => ({attempt:emptyWorkspaceMergeAttempt(),capture:null,admission:"not-observed"});
export function emptyWorkspaceMergeData(): WorkspaceMergeData { return {intendedArgv:["merge"],workingDirectory:null,requestedSource:null,strategy:null,cherrypicking:null,forced:null,previewRequested:null,outputFormatRequested:null,apply:emptyMergeStage(),shortStatus:emptyMergeStage(),fullStatus:emptyMergeStage(),pendingReadMode:"short",commandCompleted:false,observedWorkspaceIdentity:null,observedSourceIdentity:null,observedFinalizedMetadata:null,observedPreservation:null,observedPendingItems:null,fileConflictCount:null,protocol:"not-observed",checkinReadiness:"unknown",verification:"unverified",effect:"not-attempted"}; }
function header(action:MergeAction,data:WorkspaceMergeData) {const stages=[data.apply,data.shortStatus,data.fullStatus],observed=stages.filter(s=>s.capture);return {schemaVersion:1 as const,action,provenance:{source:"plastic" as const,producer:"@aefree/pi-plastic" as const,contentTrust:"external" as const},completeness:{capture:!observed.length?"unknown" as const:observed.every(s=>s.capture!.complete)?"complete" as const:"incomplete" as const,projection:true as const},data};}
export function workspaceMergeFailure(action:MergeAction,data:WorkspaceMergeData,code:WorkspaceMergeReceipt extends infer T ? T extends {error:{code:infer C}} ? C : never : never,message:string):WorkspaceMergeReceipt {return {...header(action,data),ok:false,outcome:data.effect==="not-attempted"?"failed":data.checkinReadiness==="blocked"?"blocked":"uncertain",error:{code,message}};}
export async function assembleWorkspaceMergeReceipt(action:MergeAction,args:unknown):Promise<WorkspaceMergeReceipt>{
 const data=emptyWorkspaceMergeData();let active: "apply"|"shortStatus"|"fullStatus"|null=null;
 try{
  const keys=action==="merge"?["source","strategy","cherrypicking","forced","preflight","format","workdir"]:["source","strategy","preflight","format","workdir"];
  if(!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(k=>!keys.includes(k)))return workspaceMergeFailure(action,data,"invalid_request","Use only declared workspace merge controls.");
  const i=args as Record<string,unknown>,source=i.source,cwd=i.workdir===undefined?process.cwd():i.workdir,strategy=i.strategy===undefined?(action==="merge"?"auto":"destination"):i.strategy,cherry=i.cherrypicking===undefined?false:i.cherrypicking,forced=i.forced===undefined?false:i.forced,preview=i.preflight===undefined?false:i.preflight,format=i.format===undefined?"text":i.format;
  if(!safeMergeText(source)||source.trimStart().startsWith("-")||!safeMergeText(cwd)||!(action==="merge"?["auto","source","destination"]:["source","destination"]).includes(strategy as string)||[cherry,forced,preview].some(v=>typeof v!=="boolean")||!["text","json"].includes(format as string))return workspaceMergeFailure(action,data,"invalid_request","Use a bounded source operand, strict controls and text/json; source options/stdin are rejected.");
  const token="__WM_"+randomBytes(12).toString("hex")+"__";data.intendedArgv=buildWorkspaceMergeArgv(source,strategy as MergeStrategy,cherry as boolean,forced as boolean,token);data.workingDirectory=cwd;data.requestedSource=source;data.strategy=strategy as MergeStrategy;data.cherrypicking=cherry as boolean;data.forced=forced as boolean;data.previewRequested=preview as boolean;data.outputFormatRequested=format as "text"|"json";
  if(preview)return {...header(action,data),ok:true,outcome:"preflight"};
  active="apply";const apply=await captureWorkspaceMergeCommand([...data.intendedArgv],cwd);data.apply={attempt:apply.attempt,capture:apply.capture,admission:"unsupported"};active=null;data.effect=["started","unknown"].includes(apply.attempt.state)?"uncertain":"not-attempted";
  if(!apply.capture.complete||apply.failed||apply.attempt.state!=="started")return workspaceMergeFailure(action,data,apply.attempt.aborted?"aborted":data.effect==="not-attempted"?"launch_failed":"uncertain","Merge capture/start/completion is not established; do not retry automatically.");
  data.commandCompleted=apply.attempt.exitCode===0;
  const parsed=admitWorkspaceMergeOutput(apply.stdout!,token);data.protocol=parsed.protocol;data.pendingReadMode=parsed.protocol==="apply-add-copied"?"copied-machine":"short";data.fileConflictCount=parsed.fileConflictCount;data.apply.admission=parsed.protocol==="unsupported"?"unsupported":"admitted";
  if(parsed.protocol==="file-conflict"){data.checkinReadiness="blocked";return workspaceMergeFailure(action,data,"conflict","Observed file-conflict records; checkin blocked. Earlier effects are not disproven.");}
  if(!data.commandCompleted)return workspaceMergeFailure(action,data,"uncertain","Merge exited nonzero; workspace effects may already exist.");
  if(parsed.protocol==="unsupported")return workspaceMergeFailure(action,data,"unsupported_readiness","Merge completed; applying profile unadmitted. Inspect apply.admission/protocol; verify loaded package revision and retain sanitized producer evidence. Readiness unknown; do not reapply automatically or infer rollback.");
  const copied=parsed.protocol==="apply-add-copied";data.pendingReadMode=copied?"copied-machine":"short";
  if(copied&&process.platform!=="win32")return workspaceMergeFailure(action,data,"unsupported_readiness","Copied readiness is sourced only on the observed Windows client.");
  active="shortStatus";const short=await captureWorkspaceMergeCommand(copied?[...copiedPendingArgv]:["status","--short"],cwd);data.shortStatus={attempt:short.attempt,capture:short.capture,admission:"unsupported"};active=null;
  if(!short.capture.complete||short.failed||short.attempt.exitCode!==0)return workspaceMergeFailure(action,data,"unsupported_readiness","Merge command completed; pending read failed/incomplete. Checkin readiness unknown.");
  const pending=copied?parseCopiedPending(short.stdout!,cwd):null;
  const copiedKeys=pending?.paths.map(copiedPathKey)??[];
  const coherent=!!pending&&parsed.copiedPaths.length===copiedKeys.length&&new Set(parsed.copiedPaths.map(copiedPathKey)).size===copiedKeys.length&&parsed.copiedPaths.every(p=>copiedKeys.includes(copiedPathKey(p)))&&new Set(parsed.addedPaths.map(p=>copiedPathKey(win32.join(cwd,p)))).size===copiedKeys.length&&parsed.addedPaths.every(p=>p.startsWith("/")&&!p.includes("\\")&&p.slice(1).split("/").every(v=>v!==""&&v!=="."&&v!==".."&&!/[?\uFFFD]/u.test(v))&&copiedKeys.includes(copiedPathKey(win32.join(cwd,p))));
  data.shortStatus.admission=(copied?coherent:short.stdout==="")&&short.stderr===""?"admitted":"unsupported";
  active="fullStatus";const full=await captureWorkspaceMergeCommand(["status"],cwd);data.fullStatus={attempt:full.attempt,capture:full.capture,admission:"unsupported"};active=null;
  if(!full.capture.complete||full.failed||full.attempt.exitCode!==0)return workspaceMergeFailure(action,data,"unsupported_readiness","Merge command completed; merge-state read failed/incomplete. Checkin readiness unknown.");
  data.fullStatus.admission=(copied?!!pending&&admitCopiedStandardStatus(full.stdout!,pending,source,cwd):admitCleanStandardStatus(full.stdout!))&&full.stderr===""?"admitted":"unsupported";
  // No warning/unknown stderr can authorize compound checkin.
  if(apply.stderr!=="")return workspaceMergeFailure(action,data,"unsupported_readiness","Merge command completed; applying stderr is outside the admitted warning profile. Checkin paused; prior effects remain possible. Do not reapply automatically.");
  if(data.shortStatus.admission!=="admitted")return workspaceMergeFailure(action,data,"unsupported_readiness",copied?"Merge command completed; copied pending/ADD/path cardinality correlation is unadmitted (shortStatus). Checkin paused; inspect separately authorized pending evidence without reapplying merge.":"Merge command completed; shortStatus pending/warning evidence is unadmitted. Checkin paused; inspect separately authorized pending evidence without reapplying merge.");
  if(data.fullStatus.admission!=="admitted")return workspaceMergeFailure(action,data,"unsupported_readiness","Merge command completed; fullStatus namespace/link/copied or clean-status evidence is unadmitted. Checkin paused; prior effects remain possible. Inspect separately authorized status evidence without reapplying merge.");
  data.effect="not-proven";data.checkinReadiness="supported-no-unresolved-signals";return {...header(action,data),ok:true,outcome:"command-completed"};
 }catch{
  if(active){data[active]={attempt:{...emptyWorkspaceMergeAttempt(),state:"unknown"},capture:null,admission:"unsupported"};}
  if(active==="apply"||["started","unknown"].includes(data.apply.attempt.state))data.effect="uncertain";
  return workspaceMergeFailure(action,data,"producer_failed","Merge evidence collection failed; prior effects remain possible and checkin readiness unknown.");
 }
}
