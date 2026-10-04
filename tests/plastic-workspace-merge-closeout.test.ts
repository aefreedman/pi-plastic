import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mergeToBranch } from "../src/operations/closeout";
import { runWithAbortSignal } from "../src/execution/context";
let branch="/main/source",applied=false,postReads=0,mode="short-fail";const calls:string[][]=[];
const deps={spawn:((_:string,args:string[])=>{calls.push([...args]);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});queueMicrotask(()=>{child.emit("spawn");let out="",err="",code=0;if(args[0]==="status"){
 if(args.includes("--machinereadable"))out="STATUS\x1f16\x1fExample Repository\x1fexample@unity\r\n";
 else {if(applied)postReads++;out=args.includes("--short")?"":branch+"@Example Repository@example@unity (cs:16 - head)\r\n\r\n";if(applied&&(mode==="short-fail"&&postReads===1||mode==="full-fail"&&postReads===2||mode==="later-read-fail"&&postReads===3)){code=1;err="Synthetic unavailable state read";}if(applied&&mode==="unknown-status")out+="Unknown merge metadata\r\n";if(applied&&mode==="later-warning"&&postReads===3)err="Unknown warning on otherwise admitted stdout";}
 }else if(args[0]==="switch"){branch="/main/target";}
 else if(args[0]==="merge"){applied=true;const sep=(k:string)=>args.find(a=>a.startsWith(k+"="))!.slice(k.length+1);out=sep("--startlineseparator")+(["STATUS","ALREADY_CONNECTED","No merges detected"].join(sep("--fieldseparator")))+sep("--endlineseparator")+"\r\n";if(mode==="unknown-merge")out="Unrecognized command completion";if(mode==="partial-merge"){code=1;err="Synthetic partial apply";}}
 else throw Error("Unexpected downstream command, including forbidden checkin "+JSON.stringify(args));child.stdout.end(out);child.stderr.end(err);child.emit("close",code,null);});return child;})as any};
for(const m of ["short-fail","full-fail","later-read-fail","unknown-status","unknown-merge","partial-merge","later-warning"]){mode=m;branch="/main/source";applied=false;postReads=0;calls.length=0;await assert.rejects(()=>runWithAbortSignal(undefined,()=>mergeToBranch.execute({source:"/main/source",target:"/main/target",updateTarget:false,message:"Fixture",workdir:"C:\\Example\\workspace"}),deps));assert.equal(calls.filter(a=>a[0]==="merge").length,1);assert.equal(calls.filter(a=>a[0]==="checkin").length,0);assert.equal(applied,true);assert.equal(calls.filter(a=>a[0]==="status"&&a.includes("--machinereadable")).length,2,"Only root and actual switch pending reads; no checkin preflight after unknown evidence");}
console.log("PASS: actual typed closeout and core merge stop before checkin on uncertain apply, failed/unknown merge reads and independent later-read failure; actual switch, no replay or compensation");
