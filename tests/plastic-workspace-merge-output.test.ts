import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal } from "../src/execution/context";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { merge, finalizeMerge } from "../src/operations/merge";
import { admitWorkspaceMergeOutput, admitCleanStandardStatus } from "../src/domain/workspace-merge-contract";
import { loadRegisteredTools } from "./pi-tool-harness";
const cwd="C:\\Example\\workspace",source="br:/main/café-é-日本-😀@Example Repository@example@unity";
let calls:string[][]=[];
function deps(mode="connected",mutate?:()=>void){return {spawn:((_:string,args:string[])=>{
 calls.push([...args]);mutate?.();const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});
 queueMicrotask(()=>{child.emit("spawn");let out:string|Buffer="",err:string|Buffer="",code=0;
  if(args[0]==="merge"){
   const sep=(k:string)=>args.find(a=>a.startsWith(k+"="))!.slice(k.length+1),frame=(o:string,f:string[])=>sep("--startlineseparator")+[o,...f].join(sep("--fieldseparator"))+sep("--endlineseparator")+"\r\n";
   out=mode==="conflict"?frame("FILE_CONFLICT",["/fixture.txt","13","15","16","533"]):mode==="add"?frame("APPLY",["ADD","/fixture.txt"]):mode==="unknown"?frame("NEW_OPERATION",["ready"]):mode==="empty"?"":frame("STATUS",["ALREADY_CONNECTED","No merges detected"]);
   if(mode==="nonzero")code=1;if(mode==="warning")err="Warning conflict text not admitted";if(mode==="invalid")out=Buffer.from([255]);if(mode==="overflow")out=Buffer.alloc(65537);
  }else if(args[0]==="status"){
   const short=args.includes("--short");out=short?mode==="add"?"AD C:\\Example\\workspace\\fixture.txt\r\n":"":"/main/target@Example Repository@example@unity (cs:16 - head)\r\n\r\n";
   if(mode==="short-fail"&&short||mode==="full-fail"&&!short){err="read unavailable";code=1;}
   if(mode==="localized"&&!short)out="statut terminé\r\n";
   if(mode==="hints"&&!short)out+="Pending merge links\r\nMerge from br:/source\r\nMerge in progress\r\n";
  }else throw Error("Unexpected command "+JSON.stringify(args));
  child.stdout.end(out);child.stderr.end(err);child.emit("close",code,null);
 });return child;
 })as any};}
for(const action of ["merge","finalize-merge"] as const){
 const strategies=action==="merge"?["auto","source","destination"] as const:["source","destination"] as const;
 for(const strategy of strategies)for(const format of ["text","json"] as const){
  calls=[];const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput(action,{source,strategy,format,preflight:true,workdir:cwd}),deps());assert(validateWorkspaceMergeOutput(r.structuredContent));assert(r.structuredContent.ok);assert.equal(calls.length,0);assert.equal(r.structuredContent.data.strategy,strategy);assert.equal(r.structuredContent.data.checkinReadiness,"unknown");assert.equal(r.structuredContent.data.commandCompleted,false);
  calls=[];const a=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput(action,{source,strategy,format,workdir:cwd}),deps());assert(validateWorkspaceMergeOutput(a.structuredContent));assert(a.structuredContent.ok);assert.equal(a.structuredContent.data.commandCompleted,true);assert.equal(a.structuredContent.data.effect,"not-proven");assert.deepEqual(calls.slice(1),[["status","--short"],["status"]]);assert.equal(calls.filter(c=>c[0]==="merge").length,1);assert(calls[0].includes(strategy==="auto"?"--mergetype=try":strategy==="source"?"--keepsource":"--keepdestination"));
  for(const patch of [(d:any)=>d.data.commandCompleted=false,(d:any)=>d.data.intendedArgv.push("--to=br:/other"),(d:any)=>d.data.observedFinalizedMetadata=true,(d:any)=>d.data.shortStatus.capture.stdoutBytes=1,(d:any)=>d.data.fullStatus.admission="unsupported"]){const forged=structuredClone(a.structuredContent);patch(forged);assert.equal(validateWorkspaceMergeOutput(forged),false);}
 }
 for(const mode of ["conflict","add","unknown","empty","nonzero","warning","invalid","overflow","short-fail","full-fail","localized","hints"]){calls=[];const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput(action,{source,workdir:cwd}),deps(mode));assert(validateWorkspaceMergeOutput(r.structuredContent),mode);assert(r.isError,mode);assert.equal(calls.filter(c=>c[0]==="merge").length,1);assert.equal(r.structuredContent.data.checkinReadiness,mode==="conflict"?"blocked":"unknown");assert.equal(r.structuredContent.data.effect,"uncertain");assert.equal(r.structuredContent.data.commandCompleted,["nonzero","invalid","overflow"].includes(mode)?false:true);if(["conflict","unknown","empty","nonzero","invalid","overflow"].includes(mode))assert.equal(calls.length,1);if(mode==="short-fail")assert.equal(calls.length,2);}
 for(const input of [{source:"-"},{source:" --to=br:/other"},{source:""},{source:"x\u0000"},{source:"\uD800"},{source:"x".repeat(4097)},{strategy:"banana"},{strategy:null},{preflight:null},{format:null},{workdir:null},{extra:true},...(action==="finalize-merge"?[{strategy:"auto"},{forced:true}]:[{cherrypicking:null},{forced:1}])]){calls=[];const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput(action,{source,workdir:cwd,...input}),deps());assert(validateWorkspaceMergeOutput(r.structuredContent));assert(r.isError);assert.equal(calls.length,0);}
 const controller=new AbortController();controller.abort();calls=[];const abort=await runWithAbortSignal(controller.signal,()=>executeWorkspaceMergeOutput(action,{source,workdir:cwd}),deps());assert(validateWorkspaceMergeOutput(abort.structuredContent));assert(abort.isError);assert.equal(calls.length,0);assert.equal(abort.structuredContent.data.effect,"not-attempted");
 const input:any={source,workdir:cwd,format:"json"};calls=[];const owned=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput(action,input),deps("connected",()=>{input.source="--to=other";input.format="text";}));assert.equal(owned.structuredContent.data.requestedSource,source);assert.equal(owned.structuredContent.data.outputFormatRequested,"json");assert.equal(calls[0][1],source);
 calls=[];const core=action==="merge"?merge:finalizeMerge;await assert.rejects(()=>runWithAbortSignal(undefined,()=>core.execute({source,workdir:cwd}),deps("short-fail")));assert.deepEqual(calls.map(a=>a[0]),["merge","status"]);
 calls=[];const preview=await runWithAbortSignal(undefined,()=>core.execute({source,preflight:true,format:"json",workdir:cwd}),deps());assert.equal(JSON.parse(preview).outcome,"preflight");assert.equal(calls.length,0);
}
const tools=await loadRegisteredTools();for(const name of ["plastic_merge","plastic_finalizeMerge"]){calls=[];const t=tools.get(name)!;assert(t.outputSchema);const input=name==="plastic_merge"?{source,cherry_picking:true,cwd,format:"markdown"}:{merge_source:source,cwd,format:"markdown"};const copy=structuredClone(input),prepared=t.prepareArguments!(input);assert.deepEqual(input,copy);const result=await runWithAbortSignal(undefined,()=>t.execute("fixture",{...prepared,preflight:true}),deps());assert(validateWorkspaceMergeOutput(result.structuredContent));assert.deepEqual(result.details,{});assert.equal(calls.length,0);assert(result.structuredContent.ok);}
const token="__WM_"+"0".repeat(24)+"__";for(const text of ["",token+"S__UNKNOWN"+token+"E__","noise"+token+"S__STATUS"+token+"F__ALREADY_CONNECTED"+token+"F__No merges detected"+token+"E__"]){assert.equal(admitWorkspaceMergeOutput(text,token).protocol,"unsupported");}assert(admitCleanStandardStatus("/main@Example Repository@example@unity (cs:16 - head)\r\n\r\n"));assert(!admitCleanStandardStatus("/main@Example Repository@example@unity (cs:16 - head)\nPending conflicts\n"));
console.log("PASS: standalone merge/finalize defaults/controls/preview/native/core/ownership/bounds/aliases/closed narrow protocol/unknown-readiness/capture/error/no replay or hidden version");
