import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {runWithAbortSignal} from "../src/execution/context";
import {parseCopiedPending,admitCopiedStandardStatus} from "../src/domain/copied-merge";
import {admitWorkspaceMergeOutput} from "../src/domain/workspace-merge-contract";
import {executeWorkspaceMergeOutput} from "../src/pi/workspace-merge-output";
const cwd="C:\\w",source="/main/source",repo="Example Repository",server="example@unity";
const names=(n:number)=>Array.from({length:n},(_,i)=>`f${i}.txt`);
const machine=(n:number)=>`STATUS\x1f16\x1f${repo}\x1f${server}\r\n`+names(n).map(x=>`CP\x1f${cwd}\\${x}\x1fFalse\x1f680\x1fMerge from 27\r\n`).join("");
const standard=(n:number)=>`/main/target@${repo}@${server} (cs:16 - head)\r\n\r\nPending merge links\r\n    Merge from cs:27 at ${source}@${repo}@${server}\r\n\r\nAdded\r\n    Status     Size     Last Modified     Path\r\n\r\n`+names(n).map(x=>`    Copied (new) (Merge from 27)    44 bytes    Just now    ${x}\r\n`).join("");
if(process.env.PI_PLASTIC_COPIED_BOUNDARY_ONLY!=="true"&&process.platform==="win32"){
 const calls:string[][]=[];
 const deps={spawn:((_:string,args:string[])=>{calls.push([...args]);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});queueMicrotask(()=>{child.emit("spawn");let text="";if(args[0]==="merge"){const sep=(k:string)=>args.find(a=>a.startsWith(k+"="))!.slice(k.length+1),frame=(op:string,...f:string[])=>sep("--startlineseparator")+[op,...f].join(sep("--fieldseparator"))+sep("--endlineseparator")+"\r\n";text=frame("APPLY","ADD","/f0.txt")+frame("APPLY","ADD","/F0.txt")+frame("DO_COPIED",cwd+"\\f0.txt")+frame("DO_COPIED",cwd+"\\f1.txt");}else text=args.includes("--machinereadable")?machine(2):standard(2);child.stdout.end(text);child.stderr.end();child.emit("close",0,null);});return child;})as any};
 const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,workdir:cwd}),deps);assert(r.isError,"Logical duplicate ADD leaves one copied path unmatched: readiness must stop");assert.equal(r.structuredContent.data.checkinReadiness,"unknown");assert.equal(calls.filter(a=>a[0]==="merge").length,1);assert(!calls.some(a=>a[0]==="checkin"));
}
const token="__WM_"+"0".repeat(24)+"__",frame=(op:string,...f:string[])=>token+"S__"+[op,...f].join(token+"F__")+token+"E__\r\n";
for(const n of [128,129,256,257]){
 const output=names(n).map(x=>frame("APPLY","ADD","/"+x)+frame("DO_COPIED",cwd+"\\"+x)).join("");
 const parsed=parseCopiedPending(machine(n),cwd);assert.equal(!!parsed,n<=128,"Copied pending shares conservative 128-pair frame budget");
 assert.equal(admitWorkspaceMergeOutput(output,token).protocol,n<=128?"apply-add-copied":"unsupported");if(parsed)assert(admitCopiedStandardStatus(standard(n),parsed,source,cwd));
}
console.log("PASS: normalized ADD duplicate rejects readiness; 128 admitted,129/256/257 fail closed under existing frame/byte limits");
