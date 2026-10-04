import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal } from "../src/execution/context";
import { parseCopiedPending, admitCopiedStandardStatus } from "../src/domain/copied-merge";
import { parseCheckinPending } from "../src/domain/checkin-contract";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { executeCloseoutOutput, validateCloseoutOutput } from "../src/pi/closeout-output";
import { loadRegisteredTools } from "./pi-tool-harness";
const cwd="C:\\Example\\workspace",path=cwd+"\\fixture.txt",source="/main/source-café-😀",target="/main/target",repo="Example Repository",server="example@unity";
const machine=`STATUS\x1f16\x1f${repo}\x1f${server}\r\nCP\x1f${path}\x1fFalse\x1f680\x1fMerge from 27\r\n`;
const full=`${target}@${repo}@${server} (cs:16 - head)\r\n\r\nPending merge links\r\n    Merge from cs:27 at ${source}@${repo}@${server}\r\n\r\nAdded\r\n    Status                          Size        Last Modified    Path\r\n\r\n    Copied (new) (Merge from 27)    44 bytes    Just now         fixture.txt    \r\n\r\n`;
const p=parseCopiedPending(machine,cwd)!;assert(p);assert(admitCopiedStandardStatus(full,p,source,cwd));assert(admitCopiedStandardStatus(full.replace("Just now","opaque display"),p,source,cwd));assert.equal(parseCheckinPending(machine,cwd).items[0].kind,"added");assert.equal(parseCheckinPending(machine,cwd).items[0].statusCode,"CP");
for(const bad of [machine.replace("CP\x1f","NEW\x1f"),machine.replace("False","True"),machine.replace("680","0"),machine.replace("Merge from 27","NO_MERGES"),machine.replace(path,"C:\\Other\\fixture.txt"),machine+machine.split("\r\n")[1]+"\r\n",machine.replace(repo,"?Repository"),machine.replace("27","027"),machine.replace("CP\x1f","AD\x1f")])assert.equal(parseCopiedPending(bad,cwd),null);
for(const bad of [full+"Merge in progress\r\n",full.replace("Merge from cs:27","Merge from cs:28"),full.replace("at "+source,"at /main/other"),full.replace("Copied (new)","Changed"),full.replace("Merge from 27)","Merge from 28)"),full.replace("fixture.txt","other.txt"),full.replace(server,"example@cloud"),full.replace("(cs:16","(cs:17"),full+"Unknown section\r\n"])assert(!admitCopiedStandardStatus(bad,p,source,cwd));
let branch=source,pending=false,checked=false,mode="success";const calls:string[][]=[];
const deps={spawn:((_:string,args:string[])=>{calls.push([...args]);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});queueMicrotask(()=>{child.emit("spawn");let out="",err="",code=0;
 const sep=(k:string)=>args.find(a=>a.startsWith(k+"="))!.slice(k.length+1),frame=(op:string,...fields:string[])=>sep("--startlineseparator")+[op,...fields].join(sep("--fieldseparator"))+sep("--endlineseparator")+"\r\n";
 if(args[0]==="status"){
  if(args.includes("--machinereadable")){out=pending?machine:`STATUS\x1f16\x1f${repo}\x1f${server}\r\n`;if(pending&&mode==="pending-mismatch")out=out.replace(path,cwd+"\\other.txt");if(pending&&mode==="pending-fail"){code=1;err="Owned synthetic failure";}if(checked&&mode==="post-fail"){code=1;err="Owned synthetic final read failure";}}
  else{out=pending?full:`${branch}@${repo}@${server} (cs:16 - head)\r\n\r\n`;if(pending&&mode==="unresolved")out+="Merge in progress\r\n";if(pending&&mode==="warning")err="Unknown warning";}
 }else if(args[0]==="switch")branch=target;
 else if(args[0]==="update")assert.deepEqual(args,["update","--dontmerge","--noinput"]);
 else if(args[0]==="merge"){pending=true;out=frame("APPLY","ADD","/fixture.txt")+frame("DO_COPIED",path);if(mode==="frame-mismatch")out=out.replace(path,cwd+"\\other.txt");if(mode==="nonzero")code=1;}
 else if(args[0]==="checkin"){checked=true;pending=false;out=frame("CI_START")+frame("STAGE","")+frame("CO",cwd)+frame("CP",path)+frame("CHANGESET",`cs:127@br:${target}@${repo}@${server} (mount:'/')`);if(mode==="checkin-fail"){out=frame("CI_START");err="Owned synthetic checkin failure";code=1;}}
 else throw Error(JSON.stringify(args));child.stdout.end(out);child.stderr.end(err);child.emit("close",code,null);});return child;})as any};
const reset=(m="success")=>{branch=source;pending=false;checked=false;mode=m;calls.length=0;};
if(process.platform==="win32"){
 reset();const merge=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,workdir:cwd}),deps);assert(merge.structuredContent.ok);assert(validateWorkspaceMergeOutput(merge.structuredContent));assert.equal(merge.structuredContent.data.pendingReadMode,"copied-machine");assert.equal(calls.length,3);
 for(const bad of [(d:any)=>d.data.pendingReadMode="short",(d:any)=>d.data.shortStatus.capture.stdoutBytes=0,(d:any)=>d.data.fullStatus.admission="unsupported"]){const d=structuredClone(merge.structuredContent);bad(d);assert(!validateWorkspaceMergeOutput(d));}
 for(const m of ["pending-mismatch","frame-mismatch","pending-fail","unresolved","warning","nonzero"]){reset(m);const r=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source,workdir:cwd}),deps);assert(r.isError,m);assert(validateWorkspaceMergeOutput(r.structuredContent),m);assert.equal(calls.filter(a=>a[0]==="merge").length,1);assert(!calls.some(a=>a[0]==="checkin"));}
 const tools=await loadRegisteredTools();
 for(const format of ["text","json"]){reset();const r=await runWithAbortSignal(undefined,()=>tools.get("plastic_mergeToBranch")!.execute("owned-fixture",{source,target,message:"Owned fixture",workdir:cwd,format}),deps);assert(r.structuredContent.ok,JSON.stringify(r.structuredContent));assert(validateCloseoutOutput(r.structuredContent));assert.equal(r.structuredContent.data.createdChangeset?.id,"127");assert.equal(r.structuredContent.data.pendingAfter?.totalPending,0);assert.equal(calls.filter(a=>a[0]==="checkin").length,1);const c=r.structuredContent.data.stages.find((s:any)=>s.name==="checkin") as any;assert(c.result.data.itemEvents.some((e:any)=>e.operation==="CP"));assert.equal(r.structuredContent.data.sourceLink,"unverified");}
 for(const m of ["unresolved","pending-mismatch","frame-mismatch","warning","checkin-fail","post-fail"]){reset(m);const r=await runWithAbortSignal(undefined,()=>executeCloseoutOutput({source,target,message:"Owned fixture",workdir:cwd}),deps);assert(r.isError,m);assert(validateCloseoutOutput(r.structuredContent),m);assert.equal(calls.filter(a=>a[0]==="checkin").length,["checkin-fail","post-fail"].includes(m)?1:0);if(m==="post-fail")assert.equal(r.structuredContent.data.createdChangeset?.id,"127");assert(!calls.some(a=>["undo","shelve"].includes(a[0])));}
}
console.log("PASS: narrow copied pending/link/frame correlation, opaque volatile display, namespace/path/count gates, registered positive typed closeout CP and preserved failure/created-changeset barriers; no retry");
