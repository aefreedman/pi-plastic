import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {Readable} from "node:stream";
import {executeRemovalOutput,validateRemovalOutput} from "../src/pi/removal-output";
import {emptyRemovalData,validRemovalOperands} from "../src/operations/removal-receipt";
import {resolveDeleteChangeConflict} from "../src/operations/workspace";
import {runWithAbortSignal} from "../src/execution/context";
import {loadRegisteredTools} from "./pi-tool-harness";
const cwd="C:\\Example\\workspace";
let calls:string[][]=[];
const fake=(out=Buffer.alloc(0),err=Buffer.alloc(0),code=0,mode="normal")=>({spawn:((_cmd:string,args:string[],options:any)=>{
 calls.push([...args]);assert.equal(options.cwd,cwd);assert.equal(options.shell,false);
 if(mode==="throw")throw Error("private launch diagnostic");
 const child=Object.assign(new EventEmitter(),{stdout:Readable.from([out]),stderr:Readable.from([err]),kill:()=>true});
 process.nextTick(()=>{if(mode!=="missing-start")child.emit("spawn");child.emit("close",code,null);});return child;
})as any});
for(const paths of [["plain.txt"],["space café-é-日本-😀.txt","space café-é-日本-😀.txt"],["*.png","a?.cs",".","../other/path","C:\\Other Workspace\\file.txt","./-literal","./ --space"]]){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeRemovalOutput({paths,workdir:cwd}),fake());
 assert(validateRemovalOutput(r.structuredContent));assert(r.structuredContent.ok);assert.equal(r.structuredContent.data.requestedOperandCount,paths.length);
 assert.deepEqual(calls,[["remove","--nodisk",...paths]]);assert.deepEqual(r.structuredContent.data.intendedArgv,["remove","--nodisk",...paths]);assert.equal(r.structuredContent.data.observedResolvedItems,null);
 (r.structuredContent.data.intendedArgv as string[])[0]="foreign-change";assert.deepEqual(emptyRemovalData().intendedArgv,["remove"]);
}
for(const paths of [[],new Array(1),[null],[1],[""],["  "],["-"],["--recursive"],[" --coparent"],["--ignorefailed"],["--filetypes=private"],["--added"],["--checkedout"],["-r"],["--symlink"],["private"],[" PRIVATE "],["controlled"],["a\nb"],["\uD800"],["x".repeat(4097)],Array(257).fill("x"),Array(9).fill("x".repeat(4096)),Array(3).fill("日".repeat(4096))]){
 assert.equal(validRemovalOperands(paths),false);calls=[];const r=await runWithAbortSignal(undefined,()=>executeRemovalOutput({paths,workdir:cwd}),fake());
 assert(validateRemovalOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"failed");assert.equal(calls.length,0);
}
assert(validRemovalOperands(Array(8).fill("x".repeat(4096))));
assert(validRemovalOperands(Array(256).fill("x")));
for(const args of [null,[],{}, {paths:["x"],workdir:""},{paths:["x"],preflight:"yes"},{paths:["x"],format:"yaml"}]){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeRemovalOutput(args),fake());assert(validateRemovalOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"failed");assert.equal(calls.length,0);
}
for(const [out,err,code,mode,outcome] of [
 [Buffer.alloc(0),Buffer.alloc(0),0,"normal","command-completed"],
 [Buffer.from("opaque AD progress é-é-日本-😀"),Buffer.from("warning"),0,"normal","command-completed"],
 [Buffer.from("one operand undone"),Buffer.from("PRIVATE partial failure"),1,"normal","uncertain"],
 [Buffer.from([255]),Buffer.alloc(0),0,"normal","uncertain"],
 [Buffer.alloc(0),Buffer.alloc(0),0,"missing-start","uncertain"],
 [Buffer.alloc(0),Buffer.alloc(0),0,"throw","failed"],
]as const){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeRemovalOutput({paths:["a","missing"],workdir:cwd}),fake(out,err,code,mode));
 assert(validateRemovalOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,outcome);assert.equal(r.isError,outcome!=="command-completed");assert.deepEqual(calls,[["remove","--nodisk","a","missing"]]);assert.deepEqual(r.details,{});assert.doesNotMatch(JSON.stringify(r),/PRIVATE|one operand undone/);
 if(r.structuredContent.ok)for(const mutate of [(v:any)=>v.data.intendedArgv[1]="--recursive",(v:any)=>v.data.requestedOperandCount++,(v:any)=>v.data.intendedArgv[0]="add",(v:any)=>v.data.attempt.exitCode=1,(v:any)=>v.data.capture.complete=false,(v:any)=>v.data.observedResolvedItems=[],(v:any)=>v.data.extra=true,(v:any)=>v.extra=true]){
  const v=structuredClone(r.structuredContent);mutate(v);assert.equal(validateRemovalOutput(v),false);
 }
}
calls=[];await assert.rejects(runWithAbortSignal(undefined,()=>resolveDeleteChangeConflict.execute({paths:["a","missing"],workdir:cwd}),fake(Buffer.from("partial undo"),Buffer.from("PRIVATE"),1)),/Removal uncertain/);assert.equal(calls.length,1);
const controller=new AbortController();controller.abort();calls=[];
const aborted=await runWithAbortSignal(controller.signal,()=>executeRemovalOutput({paths:["x"],workdir:cwd}),fake());assert(validateRemovalOutput(aborted.structuredContent));assert.equal(aborted.structuredContent.data.attempt.aborted,true);assert.equal(calls.length,0);
const tools=await loadRegisteredTools();calls=[];const native=await runWithAbortSignal(undefined,()=>tools.get("plastic_resolveDeleteChangeConflict")!.execute("undo-test",{paths:["x"]},undefined,undefined,{cwd}),fake());assert(validateRemovalOutput(native.structuredContent));assert.equal(native.structuredContent.data.workingDirectory,cwd);assert.equal(calls.length,1);
for(const [input,paths] of [[{file:"one.txt",cwd},["one.txt"]],[{items:["two.txt"],workingDirectory:cwd},["two.txt"]],[{paths:["canonical"],path:"shadow",workdir:cwd,cwd:"shadow"},["canonical"]]] as const){
 const original=structuredClone(input),prepared=tools.get("plastic_resolveDeleteChangeConflict")!.prepareArguments!(input);
 assert.deepEqual(input,original);calls=[];const r=await runWithAbortSignal(undefined,()=>tools.get("plastic_resolveDeleteChangeConflict")!.execute("alias",prepared),fake());
 assert(validateRemovalOutput(r.structuredContent));assert(r.structuredContent.ok);assert.deepEqual(calls,[["remove","--nodisk",...paths]]);
}
const mutablePaths=["original.txt"];calls=[];
const pending=runWithAbortSignal(undefined,()=>executeRemovalOutput({paths:mutablePaths,workdir:cwd}),fake());mutablePaths[0]="--recursive";
const owned=await pending;assert(owned.structuredContent.ok);assert.deepEqual(calls,[["remove","--nodisk","original.txt"]]);assert.deepEqual(owned.structuredContent.data.intendedArgv,["remove","--nodisk","original.txt"]);
for(const [out,err] of [[Buffer.alloc(65537),Buffer.alloc(0)],[Buffer.alloc(0),Buffer.alloc(16385)]]){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeRemovalOutput({paths:["x"],workdir:cwd}),fake(out,err));assert(validateRemovalOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"uncertain");assert.equal(r.structuredContent.data.capture?.truncated,true);assert.equal(calls.length,1);
}


for(const keepOnDisk of [true,false])for(const format of ["text","json"] as const){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeRemovalOutput({paths:["./private","./controlled","./-literal"],keepOnDisk,preflight:true,format,workdir:cwd}),fake());
 assert(validateRemovalOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"preflight");assert.equal(calls.length,0);assert.deepEqual(r.structuredContent.data.intendedArgv,["remove",...(keepOnDisk?["--nodisk"]:[]),"./private","./controlled","./-literal"]);
 const forged=structuredClone(r.structuredContent);forged.data.attempt.state="started";assert.equal(validateRemovalOutput(forged),false);
 calls=[];const actual=await runWithAbortSignal(undefined,()=>executeRemovalOutput({paths:["x"],keepOnDisk,format,workdir:cwd}),fake());assert(actual.structuredContent.ok);assert.deepEqual(calls,[["remove",...(keepOnDisk?["--nodisk"]:[]),"x"]]);assert.equal(actual.structuredContent.data.observedResolution,null);assert.equal(actual.structuredContent.data.observedPreservation,null);assert.equal(actual.structuredContent.data.observedPendingState,null);
 if(format==="json")assert.match(actual.content[0].text,/schemaVersion/);
 calls=[];const core=await runWithAbortSignal(undefined,()=>resolveDeleteChangeConflict.execute({paths:["x"],keepOnDisk,preflight:true,format,workdir:cwd}),fake());assert.equal(calls.length,0);assert.match(core,format==="json"?/"outcome": "preflight"/:/command-only preview/);
 for(const mutate of [(d:any)=>d.data.keepOnDiskRequested=!keepOnDisk,(d:any)=>d.data.previewRequested=true,(d:any)=>d.data.observedResolution="resolved",(d:any)=>d.data.observedPreservation=true]){const bad=structuredClone(actual.structuredContent);mutate(bad);assert.equal(validateRemovalOutput(bad),false);}
}
for(const input of [{keepOnDisk:null},{keepOnDisk:"true"},{preflight:null},{format:null},{extra:true}]){calls=[];const r=await runWithAbortSignal(undefined,()=>executeRemovalOutput({paths:["x"],...input}),fake());assert(validateRemovalOutput(r.structuredContent));assert(r.isError);assert.equal(calls.length,0);}
console.log("PASS: removal exact operands/mode rejection/bounds/aliases/ownership/core/native/errors and preview/keepOnDisk/format/anti-forgery matrix; no hidden reads or retry");
