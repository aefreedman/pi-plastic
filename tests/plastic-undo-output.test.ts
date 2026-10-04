import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {Readable} from "node:stream";
import {executeUndoOutput,validateUndoOutput} from "../src/pi/undo-output";
import {emptyUndoData,validUndoOperands} from "../src/operations/undo-receipt";
import {undo} from "../src/operations/workspace";
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
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeUndoOutput({paths,workdir:cwd}),fake());
 assert(validateUndoOutput(r.structuredContent));assert(r.structuredContent.ok);assert.equal(r.structuredContent.data.requestedOperandCount,paths.length);
 assert.deepEqual(calls,[["undo",...paths]]);assert.deepEqual(r.structuredContent.data.intendedArgv,["undo",...paths]);assert.equal(r.structuredContent.data.observedUndoneItems,null);
 (r.structuredContent.data.intendedArgv as string[])[0]="foreign-change";assert.deepEqual(emptyUndoData().intendedArgv,["undo"]);
}
for(const paths of [[],new Array(1),[null],[1],[""],["  "],["-"],["--recursive"],[" --coparent"],["--ignorefailed"],["--filetypes=private"],["--added"],["--checkedout"],["-r"],["--symlink"],["a\nb"],["\uD800"],["x".repeat(4097)],Array(257).fill("x"),Array(9).fill("x".repeat(4096)),Array(3).fill("日".repeat(4096))]){
 assert.equal(validUndoOperands(paths),false);calls=[];const r=await runWithAbortSignal(undefined,()=>executeUndoOutput({paths,workdir:cwd}),fake());
 assert(validateUndoOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"failed");assert.equal(calls.length,0);
}
assert(validUndoOperands(Array(8).fill("x".repeat(4096))));
assert(validUndoOperands(Array(256).fill("x")));
for(const args of [null,[],{}, {paths:["x"],workdir:""},{paths:["x"],preflight:true},{paths:["x"],format:"json"}]){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeUndoOutput(args),fake());assert(validateUndoOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"failed");assert.equal(calls.length,0);
}
for(const [out,err,code,mode,outcome] of [
 [Buffer.alloc(0),Buffer.alloc(0),0,"normal","command-completed"],
 [Buffer.from("opaque AD progress é-é-日本-😀"),Buffer.from("warning"),0,"normal","command-completed"],
 [Buffer.from("one operand undone"),Buffer.from("PRIVATE partial failure"),1,"normal","uncertain"],
 [Buffer.from([255]),Buffer.alloc(0),0,"normal","uncertain"],
 [Buffer.alloc(0),Buffer.alloc(0),0,"missing-start","uncertain"],
 [Buffer.alloc(0),Buffer.alloc(0),0,"throw","failed"],
]as const){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeUndoOutput({paths:["a","missing"],workdir:cwd}),fake(out,err,code,mode));
 assert(validateUndoOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,outcome);assert.equal(r.isError,outcome!=="command-completed");assert.deepEqual(calls,[["undo","a","missing"]]);assert.deepEqual(r.details,{});assert.doesNotMatch(JSON.stringify(r),/PRIVATE|one operand undone/);
 if(r.structuredContent.ok)for(const mutate of [(v:any)=>v.data.intendedArgv[1]="--recursive",(v:any)=>v.data.requestedOperandCount++,(v:any)=>v.data.intendedArgv[0]="add",(v:any)=>v.data.attempt.exitCode=1,(v:any)=>v.data.capture.complete=false,(v:any)=>v.data.observedUndoneItems=[],(v:any)=>v.data.extra=true,(v:any)=>v.extra=true]){
  const v=structuredClone(r.structuredContent);mutate(v);assert.equal(validateUndoOutput(v),false);
 }
}
calls=[];await assert.rejects(runWithAbortSignal(undefined,()=>undo.execute({paths:["a","missing"],workdir:cwd}),fake(Buffer.from("partial undo"),Buffer.from("PRIVATE"),1)),/Undo uncertain/);assert.equal(calls.length,1);
const controller=new AbortController();controller.abort();calls=[];
const aborted=await runWithAbortSignal(controller.signal,()=>executeUndoOutput({paths:["x"],workdir:cwd}),fake());assert(validateUndoOutput(aborted.structuredContent));assert.equal(aborted.structuredContent.data.attempt.aborted,true);assert.equal(calls.length,0);
const tools=await loadRegisteredTools();calls=[];const native=await runWithAbortSignal(undefined,()=>tools.get("plastic_undo")!.execute("undo-test",{paths:["x"]},undefined,undefined,{cwd}),fake());assert(validateUndoOutput(native.structuredContent));assert.equal(native.structuredContent.data.workingDirectory,cwd);assert.equal(calls.length,1);
for(const [input,paths] of [[{file:"one.txt",cwd},["one.txt"]],[{items:["two.txt"],workingDirectory:cwd},["two.txt"]],[{paths:["canonical"],path:"shadow",workdir:cwd,cwd:"shadow"},["canonical"]]] as const){
 const original=structuredClone(input),prepared=tools.get("plastic_undo")!.prepareArguments!(input);
 assert.deepEqual(input,original);calls=[];const r=await runWithAbortSignal(undefined,()=>tools.get("plastic_undo")!.execute("alias",prepared),fake());
 assert(validateUndoOutput(r.structuredContent));assert(r.structuredContent.ok);assert.deepEqual(calls,[["undo",...paths]]);
}
const mutablePaths=["original.txt"];calls=[];
const pending=runWithAbortSignal(undefined,()=>executeUndoOutput({paths:mutablePaths,workdir:cwd}),fake());mutablePaths[0]="--recursive";
const owned=await pending;assert(owned.structuredContent.ok);assert.deepEqual(calls,[["undo","original.txt"]]);assert.deepEqual(owned.structuredContent.data.intendedArgv,["undo","original.txt"]);
for(const [out,err] of [[Buffer.alloc(65537),Buffer.alloc(0)],[Buffer.alloc(0),Buffer.alloc(16385)]]){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeUndoOutput({paths:["x"],workdir:cwd}),fake(out,err));assert(validateUndoOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"uncertain");assert.equal(r.structuredContent.data.capture?.truncated,true);assert.equal(calls.length,1);
}
console.log("PASS: undo exact operands/duplicates/wildcards, option/filter/sentinel/Unicode/scalar/aggregate/sparse bounds and canonical-precedence aliases, opaque warning/partial/error/native/core/closed semantics and no retries");
