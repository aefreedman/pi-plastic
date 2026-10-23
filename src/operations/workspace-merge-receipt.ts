import { parseSwitchLoadedBranch } from "../domain/switch-contract";
import { inspectConflictMarkers } from "./marker-lifecycle";
import { compactMarkerGate } from "../domain/marker-gate";
import { parseCheckinPending } from "../domain/checkin-contract";
import { parseMergedPending, correlateMergedApply, admitMergedStandardStatus } from "../domain/merged-workspace";
import { randomBytes } from "node:crypto";
import { win32 } from "node:path";
import { parseCopiedPending, admitCopiedStandardStatus, copiedPendingArgv, copiedPathKey } from "../domain/copied-merge";
import { captureWorkspaceMergeCommand, emptyWorkspaceMergeAttempt } from "../execution/workspace-merge-command";
import { admitCleanStandardStatus, admitWorkspaceMergeOutput, buildWorkspaceMergeArgv, safeMergeText, type MergeAction, type MergeStage, type WorkspaceMergeData, type WorkspaceMergeReceipt, type MergeStrategy } from "../domain/workspace-merge-contract";
export type { WorkspaceMergeReceipt, MergeAction } from "../domain/workspace-merge-contract";
export { safeMergeText, buildWorkspaceMergeArgv } from "../domain/workspace-merge-contract";
export { presentWorkspaceMergeReceipt } from "../presentation/workspace-merge-results";
export const emptyMergeStage = (): MergeStage => ({attempt:emptyWorkspaceMergeAttempt(),capture:null,admission:"not-observed"});
export function emptyWorkspaceMergeData(): WorkspaceMergeData { return {markers:null,intendedArgv:["merge"],workingDirectory:null,requestedSource:null,strategy:null,cherrypicking:null,forced:null,previewRequested:null,outputFormatRequested:null,apply:emptyMergeStage(),shortStatus:emptyMergeStage(),fullStatus:emptyMergeStage(),pendingReadMode:"short",commandOutput:null,commandCompleted:false,observedWorkspaceIdentity:null,observedSourceIdentity:null,observedPendingItems:null,fileConflictCount:null,protocol:"not-observed",checkinReadiness:"unknown",verification:"unverified",effect:"not-attempted"}; }
function header(action:MergeAction,data:WorkspaceMergeData) {const stages=[data.apply,data.shortStatus,data.fullStatus],observed=[...stages,...(data.markers?[data.markers]:[])].filter(s=>s.capture);return {schemaVersion:1 as const,action,provenance:{source:"plastic" as const,producer:"@aefree/pi-plastic" as const,contentTrust:"external" as const},completeness:{capture:!observed.length?"unknown" as const:observed.every(s=>s.capture!.complete)?"complete" as const:"incomplete" as const,projection:true as const},data};}
export function workspaceMergeFailure(action:MergeAction,data:WorkspaceMergeData,code:WorkspaceMergeReceipt extends infer T ? T extends {error:{code:infer C}} ? C : never : never,message:string):WorkspaceMergeReceipt {return {...header(action,data),ok:false,outcome:data.effect==="not-attempted"?"failed":data.checkinReadiness==="blocked"?"blocked":"uncertain",error:{code,message}};}
export async function assembleWorkspaceMergeReceipt(action:MergeAction,args:unknown):Promise<WorkspaceMergeReceipt>{
 const data=emptyWorkspaceMergeData();let active: "apply"|"shortStatus"|"fullStatus"|null=null;
 try{
  const keys=["source","strategy","cherrypicking","forced","preflight","format","workdir"];
  if(action!=="merge")return workspaceMergeFailure(action,data,"invalid_request","Only merge is supported.");
  if(!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(k=>!keys.includes(k)))return workspaceMergeFailure(action,data,"invalid_request","Use only declared workspace merge controls.");
  const i=args as Record<string,unknown>,source=i.source,cwd=i.workdir===undefined?process.cwd():i.workdir,strategy=i.strategy===undefined?"auto":i.strategy,cherry=i.cherrypicking===undefined?false:i.cherrypicking,forced=i.forced===undefined?false:i.forced,preview=i.preflight===undefined?false:i.preflight,format=i.format===undefined?"text":i.format;
  if(!safeMergeText(source)||source.trimStart().startsWith("-")||!safeMergeText(cwd)||!["auto","source","destination"].includes(strategy as string)||[cherry,forced,preview].some(v=>typeof v!=="boolean")||!["text","json"].includes(format as string))return workspaceMergeFailure(action,data,"invalid_request","Use a bounded source operand, strict controls and text/json; source options/stdin are rejected.");
  const token="__WM_"+randomBytes(12).toString("hex")+"__";data.intendedArgv=buildWorkspaceMergeArgv(source,strategy as MergeStrategy,cherry as boolean,forced as boolean,token);data.workingDirectory=cwd;data.requestedSource=source;data.strategy=strategy as MergeStrategy;data.cherrypicking=cherry as boolean;data.forced=forced as boolean;data.previewRequested=preview as boolean;data.outputFormatRequested=format as "text"|"json";
  if(preview)return {...header(action,data),ok:true,outcome:"preflight"};
  active="apply";const apply=await captureWorkspaceMergeCommand([...data.intendedArgv],cwd);data.apply={attempt:apply.attempt,capture:apply.capture,admission:"unsupported"};active=null;data.effect=["started","unknown"].includes(apply.attempt.state)?"uncertain":"not-attempted";
  if(!apply.capture.complete||apply.failed||apply.attempt.state!=="started")return workspaceMergeFailure(action,data,apply.attempt.aborted?"aborted":data.effect==="not-attempted"?"launch_failed":"uncertain","Merge capture/start/completion is not established; do not retry automatically.");
  data.commandOutput={stdout:apply.stdout!,stderr:apply.stderr!};
  data.commandCompleted=apply.attempt.exitCode===0;
  // A partial/uncertain native application is never reapplied or checked in.
  if(!data.commandCompleted)return workspaceMergeFailure(action,data,"uncertain","Merge exited nonzero; marker or non-text conflicts and partial effects may remain. Inspect, edit and validate; never reapply automatically.");
  data.markers=compactMarkerGate(await inspectConflictMarkers(cwd));
  if(data.markers.state!=="clear")return workspaceMergeFailure(action,data,"unsupported_readiness","Marker listing is unknown or pending; inspect/edit/validate and re-inspect. No checkin or automatic retry.");
  const native=strategy==="auto";
  const parsed:ReturnType<typeof admitWorkspaceMergeOutput>=native?{protocol:"native-completed",fileConflictCount:0,copiedPaths:[],addedPaths:[]}:admitWorkspaceMergeOutput(apply.stdout!,token);
  data.protocol=parsed.protocol;data.pendingReadMode=parsed.protocol==="merged-candidate"?"merged-machine":parsed.protocol==="apply-add-copied"?"copied-machine":"short";data.fileConflictCount=parsed.fileConflictCount;data.apply.admission=parsed.protocol==="unsupported"?"unsupported":"admitted";
  if(!native&&parsed.protocol==="file-conflict"){data.checkinReadiness="blocked";return workspaceMergeFailure(action,data,"conflict","Observed file conflicts; explicit contributor policy did not establish readiness.");}
  if(!native&&parsed.protocol==="unsupported")return workspaceMergeFailure(action,data,"unsupported_readiness","Explicit contributor-policy apply output unadmitted; inspect without reapplying.");
  if(native){data.pendingReadMode="native-machine";data.protocol="native-completed";data.fileConflictCount=0;data.apply.admission="admitted";}
  let merged=!native&&parsed.protocol==="merged-candidate",copied=!native&&parsed.protocol==="apply-add-copied";
  if((native||copied||merged)&&process.platform!=="win32")return workspaceMergeFailure(action,data,"unsupported_readiness","Pending readiness is admitted only on the observed Windows client.");
  if(merged&&(strategy!=="auto"||cherry||forced))return workspaceMergeFailure(action,data,"unsupported_readiness","Merged readiness requires normal auto mode; inspect without reapplying.");
  active="shortStatus";const short=await captureWorkspaceMergeCommand((native||copied||merged)?[...copiedPendingArgv]:["status","--short"],cwd);data.shortStatus={attempt:short.attempt,capture:short.capture,admission:"unsupported"};active=null;
  if(!short.capture.complete||short.failed||short.attempt.exitCode!==0)return workspaceMergeFailure(action,data,"unsupported_readiness","Merge completed; pending read failed/incomplete. No checkin.");
  const mergedPending=(native||merged)?parseMergedPending(short.stdout!,cwd):null;
  const pending=(native||copied)?parseCopiedPending(short.stdout!,cwd):null;
  if(native){copied=!!pending;merged=!copied&&!!mergedPending;data.protocol=merged?"merged-candidate":copied?"apply-add-copied":"native-completed";data.fileConflictCount=merged?mergedPending!.rows.filter(r=>r.status==="CO").length:0;}
  if(merged&&(cherry||forced))return workspaceMergeFailure(action,data,"unsupported_readiness","Merged readiness requires non-forced, non-cherrypicked apply.");
  data.pendingReadMode=merged?"merged-machine":copied?"copied-machine":native?"native-machine":"short";
  const copiedKeys=pending?.paths.map(copiedPathKey)??[];
  const coherent=!!pending&&parsed.copiedPaths.length===copiedKeys.length&&new Set(parsed.copiedPaths.map(copiedPathKey)).size===copiedKeys.length&&parsed.copiedPaths.every(p=>copiedKeys.includes(copiedPathKey(p)))&&new Set(parsed.addedPaths.map(p=>copiedPathKey(win32.join(cwd,p)))).size===copiedKeys.length&&parsed.addedPaths.every(p=>p.startsWith("/")&&!p.includes("\\")&&p.slice(1).split("/").every(v=>v!==""&&v!=="."&&v!==".."&&!/[?�]/u.test(v))&&copiedKeys.includes(copiedPathKey(win32.join(cwd,p))));
  const clean=native?parseCheckinPending(short.stdout!,cwd):null;
  data.shortStatus.admission=(merged?!!mergedPending&&(native||correlateMergedApply(parsed.declarations!,mergedPending,cwd)):copied?native||coherent:native?!!clean?.admitted&&clean.items.length===0:short.stdout==="")&&short.stderr===""?"admitted":"unsupported";
  active="fullStatus";const full=await captureWorkspaceMergeCommand(["status"],cwd);data.fullStatus={attempt:full.attempt,capture:full.capture,admission:"unsupported"};active=null;
  if(!full.capture.complete||full.failed||full.attempt.exitCode!==0)return workspaceMergeFailure(action,data,"unsupported_readiness","Merge command completed; merge-state read failed/incomplete. Checkin readiness unknown.");
  const cleanBranch=native&&!merged&&!copied?parseSwitchLoadedBranch(full.stdout!):null;
  data.fullStatus.admission=(merged?!!mergedPending&&admitMergedStandardStatus(full.stdout!,mergedPending,source,cwd):copied?!!pending&&admitCopiedStandardStatus(full.stdout!,pending,source,cwd):admitCleanStandardStatus(full.stdout!)&&(!native||!!cleanBranch&&!!clean?.admitted&&cleanBranch.repository===clean.repository&&cleanBranch.server===clean.server))&&full.stderr===""?"admitted":"unsupported";
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
