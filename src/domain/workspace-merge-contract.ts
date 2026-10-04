import type { WorkspaceMergeAttempt, WorkspaceMergeCapture } from "../execution/workspace-merge-command";
export type { WorkspaceMergeAttempt, WorkspaceMergeCapture } from "../execution/workspace-merge-command";
export type MergeAction = "merge" | "finalize-merge";
export type MergeStrategy = "auto" | "source" | "destination";
export const safeMergeText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && v.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
export type MergeStage = { attempt: WorkspaceMergeAttempt; capture: WorkspaceMergeCapture | null; admission: "not-observed" | "unsupported" | "admitted" };
export type WorkspaceMergeData = {
 intendedArgv: readonly string[]; workingDirectory: string | null; requestedSource: string | null; strategy: MergeStrategy | null; cherrypicking: boolean | null; forced: boolean | null; previewRequested: boolean | null; outputFormatRequested: "text" | "json" | null;
 apply: MergeStage; shortStatus: MergeStage; fullStatus: MergeStage; pendingReadMode: "short" | "copied-machine";
 commandCompleted: boolean; observedWorkspaceIdentity: null; observedSourceIdentity: null; observedFinalizedMetadata: null; observedPreservation: null; observedPendingItems: null;
 fileConflictCount: number | null; protocol: "not-observed" | "already-connected" | "file-conflict" | "apply-add" | "apply-add-copied" | "unsupported";
 checkinReadiness: "unknown" | "blocked" | "supported-no-unresolved-signals"; verification: "unverified"; effect: "not-attempted" | "not-proven" | "uncertain";
};
type Header = { schemaVersion: 1; action: MergeAction; provenance: { source: "plastic"; producer: "@aefree/pi-plastic"; contentTrust: "external" }; completeness: { capture: "complete" | "incomplete" | "unknown"; projection: true }; data: WorkspaceMergeData };
export type WorkspaceMergeReceipt = Header & ({ ok: true; outcome: "preflight" | "command-completed" } | { ok: false; outcome: "failed" | "uncertain" | "blocked"; error: { code: "invalid_request" | "launch_failed" | "aborted" | "uncertain" | "unsupported_readiness" | "conflict" | "producer_failed"; message: string } });
export function buildWorkspaceMergeArgv(source: string, strategy: MergeStrategy, cherry: boolean, forced: boolean, token: string): string[] {
 const result = ["merge",source,"--merge","--nointeractiveresolution","--machinereadable",`--startlineseparator=${token}S__`,`--endlineseparator=${token}E__`,`--fieldseparator=${token}F__`];
 if(strategy === "auto") result.push("--mergetype=try"); else result.push("--mergetype=forced",strategy === "source" ? "--keepsource" : "--keepdestination",`--automaticresolution=all-${strategy === "source" ? "src" : "dst"}`);
 if(cherry)result.push("--cherrypicking");if(forced)result.push("--forced");return result;
}
/** Narrow observed CM profile. Unknown records/text are not missing-conflict proof. */
export function admitWorkspaceMergeOutput(text: string, token: string): { protocol: WorkspaceMergeData["protocol"]; fileConflictCount: number | null; copiedPaths: string[]; addedPaths: string[] } {
 const start=token+"S__",end=token+"E__",field=token+"F__";let rest=text,count=0,conflicts=0,connected=0,adds=0; const copiedPaths:string[]=[], addedPaths:string[]=[];
 while(rest.trim()!==""){
  if(++count>256)return {protocol:"unsupported",fileConflictCount:null,copiedPaths:[],addedPaths:[]};const s=rest.indexOf(start),e=rest.indexOf(end,s+start.length);
  if(s<0||e<0||rest.slice(0,s).trim()!=="")return {protocol:"unsupported",fileConflictCount:null,copiedPaths:[],addedPaths:[]};
  const payload=rest.slice(s+start.length,e);if(payload.includes(start))return {protocol:"unsupported",fileConflictCount:null,copiedPaths:[],addedPaths:[]};const f=payload.split(field);rest=rest.slice(e+end.length);
  if(f.length===3&&f[0]==="STATUS"&&f[1]==="ALREADY_CONNECTED"&&f[2]==="No merges detected")connected++;
  else if(f.length===6&&f[0]==="FILE_CONFLICT"&&safeMergeText(f[1])&&f.slice(2).every(v=>/^[0-9]+$/.test(v)))conflicts++;
  else if(f.length===3&&f[0]==="APPLY"&&f[1]==="ADD"&&safeMergeText(f[2])){adds++;addedPaths.push(f[2]);}
  else if(f.length===2&&f[0]==="DO_COPIED"&&safeMergeText(f[1]))copiedPaths.push(f[1]);
  else return {protocol:"unsupported",fileConflictCount:null,copiedPaths:[],addedPaths:[]};
 }
 if(!count||connected&&(connected!==1||count!==1)||conflicts&&(adds||copiedPaths.length)||copiedPaths.length&&copiedPaths.length!==adds)return {protocol:"unsupported",fileConflictCount:null,copiedPaths:[],addedPaths:[]};
 return {protocol:conflicts?"file-conflict":connected?"already-connected":copiedPaths.length?"apply-add-copied":"apply-add",fileConflictCount:conflicts,copiedPaths,addedPaths};
}
/** Only the directly observed header-only standard status shape is admitted initially.
 * Rich/pending/localized/merge-link status stays unknown until independently sourced. */
export function admitCleanStandardStatus(text: string): boolean {
 return /^[^\r\n\u0000-\u001f\u007f]+ \(cs:[0-9]+ - head\)\r?\n(?:\r?\n)*$/.test(text)&&text.startsWith("/")&&text.includes("@");
}
