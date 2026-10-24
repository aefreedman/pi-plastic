import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal } from "../src/execution/context";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { merge } from "../src/operations/merge";
import { admitWorkspaceMergeOutput, admitCleanStandardStatus } from "../src/domain/workspace-merge-contract";
import { loadRegisteredTools } from "./pi-tool-harness";
const cwd="C:\\Example\\workspace",source="br:/main/café-é-日本-😀@Example Repository@example@unity";
let calls:string[][]=[];
const nativeReadinessSupported = true; // Readiness depends on captured output, not host OS.
function deps(mode="connected",mutate?:()=>void){return {spawn:((_:string,args:string[])=>{
 calls.push([...args]);mutate?.();const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});
 queueMicrotask(()=>{child.emit("spawn");let out:string|Buffer="",err="",code=0;
  if(args.includes("--list-conflict-markers")) { if(mode==="markers"){out="CONFLICT_MARKERS file.txt\n";code=1;} }
  else if(args[0]==="merge"){
   const sep=(k:string)=>args.find(a=>a.startsWith(k+"="))!.slice(k.length+1),frame=(o:string,f:string[])=>sep("--startlineseparator")+[o,...f].join(sep("--fieldseparator"))+sep("--endlineseparator")+"\r\n";
   out=mode==="conflict"?frame("FILE_CONFLICT",["/fixture.txt","13","15","16","533"]):mode==="unknown"?frame("NEW_OPERATION",["ready"]):mode==="empty"?"":frame("STATUS",["ALREADY_CONNECTED","No merges detected"]);
   if(mode==="nonzero"){out="UNRESOLVED fixture.bin (binary)\n";code=1;}
   if(mode==="warning")err="Warning conflict text not admitted";if(mode==="invalid")out=Buffer.from([255]);if(mode==="overflow")out=Buffer.alloc(65537);
  }else if(args[0]==="status"){
   const machine=args.includes("--machinereadable"),short=args.includes("--short");out=machine?"STATUS\x1f16\x1fExample Repository\x1fexample@unity\r\n":short?"":"/main/target@Example Repository@example@unity (cs:16 - head)\r\n\r\n";
   if(mode==="pending-fail"&&(machine||short)||mode==="full-fail"&&!machine&&!short){err="read unavailable";code=1;}
   if(mode==="localized"&&!machine&&!short)out="statut terminé\r\n";
   if(mode==="hints"&&!machine&&!short)out+="Pending merge links\r\nMerge from br:/source\r\nMerge in progress\r\n";
  }else throw Error("Unexpected command "+JSON.stringify(args));
  child.stdout.end(out);child.stderr.end(err);child.emit("close",code,null);
 });return child;
 })as any};}
for(const strategy of ["auto","source","destination"] as const)for(const format of ["text","json"] as const){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,strategy,format,preflight:true,workdir:cwd}),deps());assert(validateWorkspaceMergeOutput(r.structuredContent));assert(r.structuredContent.ok);assert.equal(calls.length,0);assert.equal(r.structuredContent.data.checkinReadiness,"unknown");assert.equal(r.structuredContent.data.markers,null);
 calls=[];const a=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,strategy,format,workdir:cwd}),deps());assert(validateWorkspaceMergeOutput(a.structuredContent));

 assert(a.structuredContent.ok);assert.equal(a.structuredContent.data.commandCompleted,true);assert.equal(a.structuredContent.data.markers?.state,"clear");assert.deepEqual(calls.slice(1),[["merge","--list-conflict-markers"],strategy==="auto"?["status","--machinereadable","--includeRevId","--fieldseparator=\x1f"]:["status","--short"],["status"]]);assert.equal(calls.filter(c=>c.includes("--merge")).length,1);assert.equal(calls[0].includes("--conflict-markers"),strategy==="auto");assert(calls[0].includes(strategy==="auto"?"--mergetype=try":strategy==="source"?"--keepsource":"--keepdestination"));
 for(const patch of [(d:any)=>d.data.commandCompleted=false,(d:any)=>d.data.intendedArgv.push("--to=br:/other"),(d:any)=>d.data.observedFinalizedMetadata=true,(d:any)=>d.data.markers=null,(d:any)=>d.data.markers.state="unknown",(d:any)=>d.data.fullStatus.admission="unsupported",(d:any)=>d.data.commandOutput=null]){const forged=structuredClone(a.structuredContent);patch(forged);assert.equal(validateWorkspaceMergeOutput(forged),false);}
}
for(const mode of ["nonzero","warning","invalid","overflow","pending-fail","full-fail","localized","hints","markers"]){calls=[];const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,workdir:cwd}),deps(mode));assert(validateWorkspaceMergeOutput(r.structuredContent),mode);assert(r.isError,mode);assert.equal(calls.filter(c=>c.includes("--merge")).length,1);assert.equal(r.structuredContent.data.checkinReadiness,"unknown");assert.equal(r.structuredContent.data.effect,"uncertain");assert.equal(r.structuredContent.data.commandCompleted,!["nonzero","invalid","overflow"].includes(mode));if(["nonzero","invalid","overflow"].includes(mode))assert.equal(calls.length,1);if(mode==="markers" || !nativeReadinessSupported && !["nonzero","invalid","overflow"].includes(mode))assert.equal(calls.length,2);if(!nativeReadinessSupported)assert.equal(calls.filter(c=>c[0]==="status").length,0);}
// Native exit0 does not depend on legacy applying declaration/action cardinality.
for(const mode of ["unknown","empty","conflict"]){calls=[];const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,workdir:cwd}),deps(mode));assert(validateWorkspaceMergeOutput(r.structuredContent));assert.equal(r.structuredContent.ok,nativeReadinessSupported);assert.equal(r.structuredContent.data.checkinReadiness,nativeReadinessSupported?"supported-no-unresolved-signals":"unknown");assert.equal(calls.length,nativeReadinessSupported?4:2);}
for(const input of [{source:"-"},{source:" --to=br:/other"},{source:""},{source:"x\u0000"},{source:"\uD800"},{source:"x".repeat(4097)},{strategy:"banana"},{strategy:"markers"},{strategy:null},{preflight:null},{format:null},{workdir:null},{extra:true},{cherrypicking:null},{forced:1}]){calls=[];const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,workdir:cwd,...input}),deps());assert(validateWorkspaceMergeOutput(r.structuredContent));assert(r.isError);assert.equal(calls.length,0);}
const controller=new AbortController();controller.abort();calls=[];const abort=await runWithAbortSignal(controller.signal,()=>executeWorkspaceMergeOutput("merge",{source,workdir:cwd}),deps());assert(validateWorkspaceMergeOutput(abort.structuredContent));assert(abort.isError);assert.equal(calls.length,0);assert.equal(abort.structuredContent.data.effect,"not-attempted");
const input:any={source,workdir:cwd,format:"json"};calls=[];const owned=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",input),deps("connected",()=>{input.source="--to=other";input.format="text";}));assert.equal(owned.structuredContent.data.requestedSource,source);assert.equal(owned.structuredContent.data.outputFormatRequested,"json");assert.equal(calls[0][1],source);
calls=[];await assert.rejects(()=>runWithAbortSignal(undefined,()=>merge.execute({source,workdir:cwd}),deps("pending-fail")));assert.deepEqual(calls.map(a=>a[0]),nativeReadinessSupported?["merge","merge","status"]:["merge","merge"]);
const tools=await loadRegisteredTools();assert(!tools.has("plastic_finalizeMerge"));const t=tools.get("plastic_merge")!;const alias={source,cherry_picking:true,cwd,format:"markdown"};const copy=structuredClone(alias),prepared=t.prepareArguments!(alias);assert.deepEqual(alias,copy);calls=[];const result=await runWithAbortSignal(undefined,()=>t.execute("fixture",{...prepared,preflight:true}),deps());assert(validateWorkspaceMergeOutput(result.structuredContent));assert.equal(calls.length,0);
const token="__WM_"+"0".repeat(24)+"__";for(const text of ["",token+"S__UNKNOWN"+token+"E__","noise"+token+"S__STATUS"+token+"F__ALREADY_CONNECTED"+token+"F__No merges detected"+token+"E__"]){assert.equal(admitWorkspaceMergeOutput(text,token).protocol,"unsupported");}assert(admitCleanStandardStatus("/main@Example Repository@example@unity (cs:16 - head)\r\n\r\n"));assert(!admitCleanStandardStatus("/main@Example Repository@example@unity (cs:16 - head)\nPending conflicts\n"));
console.log("PASS: native auto/default, intentional policies, independent gates, partial effects, closed receipts, ownership/bounds/aliases, removed API, no replay");
