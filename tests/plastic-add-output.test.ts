import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {Readable} from "node:stream";
import {executeAddOutput,validateAddOutput} from "../src/pi/add-output";
import {emptyAddData,validAddOperands} from "../src/operations/add-receipt";
import {add} from "../src/operations/workspace";
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
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeAddOutput({paths,workdir:cwd}),fake());
 assert(validateAddOutput(r.structuredContent));assert(r.structuredContent.ok);assert.equal(r.structuredContent.data.requestedOperandCount,paths.length);
 assert.deepEqual(calls,[["add",...paths]]);assert.deepEqual(r.structuredContent.data.intendedArgv,["add",...paths]);assert.equal(r.structuredContent.data.observedAddedItems,null);
 (r.structuredContent.data.intendedArgv as string[])[0]="foreign-change";assert.deepEqual(emptyAddData().intendedArgv,["add"]);
}
for(const paths of [[],new Array(1),[null],[1],[""],["  "],["-"],["--recursive"],[" --coparent"],["--ignorefailed"],["--filetypes=private"],["a\nb"],["\uD800"],["x".repeat(4097)],Array(257).fill("x"),Array(9).fill("x".repeat(4096)),Array(3).fill("日".repeat(4096))]){
 assert.equal(validAddOperands(paths),false);calls=[];const r=await runWithAbortSignal(undefined,()=>executeAddOutput({paths,workdir:cwd}),fake());
 assert(validateAddOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"failed");assert.equal(calls.length,0);
}
assert(validAddOperands(Array(8).fill("x".repeat(4096))));
assert(validAddOperands(Array(256).fill("x")));
for(const args of [null,[],{}, {paths:["x"],workdir:""},{paths:["x"],preflight:true},{paths:["x"],format:"json"}]){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeAddOutput(args),fake());assert(validateAddOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,"failed");assert.equal(calls.length,0);
}
for(const [out,err,code,mode,outcome] of [
 [Buffer.alloc(0),Buffer.alloc(0),0,"normal","command-completed"],
 [Buffer.from("opaque AD progress é-é-日本-😀"),Buffer.from("warning"),0,"normal","command-completed"],
 [Buffer.from("one operand added"),Buffer.from("PRIVATE partial failure"),1,"normal","uncertain"],
 [Buffer.from([255]),Buffer.alloc(0),0,"normal","uncertain"],
 [Buffer.alloc(0),Buffer.alloc(0),0,"missing-start","uncertain"],
 [Buffer.alloc(0),Buffer.alloc(0),0,"throw","failed"],
]as const){
 calls=[];const r=await runWithAbortSignal(undefined,()=>executeAddOutput({paths:["a","missing"],workdir:cwd}),fake(out,err,code,mode));
 assert(validateAddOutput(r.structuredContent));assert.equal(r.structuredContent.outcome,outcome);assert.equal(r.isError,outcome!=="command-completed");assert.deepEqual(calls,[["add","a","missing"]]);assert.deepEqual(r.details,{});assert.doesNotMatch(JSON.stringify(r),/PRIVATE|one operand added/);
 if(r.structuredContent.ok)for(const mutate of [(v:any)=>v.data.intendedArgv[1]="--recursive",(v:any)=>v.data.requestedOperandCount++,(v:any)=>v.data.intendedArgv[0]="undo",(v:any)=>v.data.attempt.exitCode=1,(v:any)=>v.data.capture.complete=false,(v:any)=>v.data.observedAddedItems=[],(v:any)=>v.data.extra=true,(v:any)=>v.extra=true]){
  const v=structuredClone(r.structuredContent);mutate(v);assert.equal(validateAddOutput(v),false);
 }
}
calls=[];await assert.rejects(runWithAbortSignal(undefined,()=>add.execute({paths:["a","missing"],workdir:cwd}),fake(Buffer.from("partial add"),Buffer.from("PRIVATE"),1)),/Add uncertain/);assert.equal(calls.length,1);
const controller=new AbortController();controller.abort();calls=[];
const aborted=await runWithAbortSignal(controller.signal,()=>executeAddOutput({paths:["x"],workdir:cwd}),fake());assert(validateAddOutput(aborted.structuredContent));assert.equal(aborted.structuredContent.data.attempt.aborted,true);assert.equal(calls.length,0);
const tools=await loadRegisteredTools();calls=[];const native=await runWithAbortSignal(undefined,()=>tools.get("plastic_add")!.execute("add-test",{paths:["x"]},undefined,undefined,{cwd}),fake());assert(validateAddOutput(native.structuredContent));assert.equal(native.structuredContent.data.workingDirectory,cwd);assert.equal(calls.length,1);
console.log("PASS: add exact operands/duplicates/wildcards, option/stdin/Unicode/scalar/aggregate/sparse bounds, opaque warning/partial/error/native/core/closed semantics and no retries");
