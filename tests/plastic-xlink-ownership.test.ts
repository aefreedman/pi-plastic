import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { observeWorkspacePending, observeWorkspaceStandard, assessWorkspaceState } from "../src/domain/workspace-observation";
import { validateXlinkOwnership, correlateOwnedCheckin, parseFileOwnership, parseMountTree } from "../src/domain/xlink-ownership";
import { observeXlinkOwnership } from "../src/operations/xlink-ownership";
import { runWithAbortSignal } from "../src/execution/context";
import { assembleCheckinReceipt } from "../src/operations/checkin-receipt";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { executeCloseoutOutput, validateCloseoutOutput } from "../src/pi/closeout-output";
import { executeCheckinOutput, validateCheckinOutput } from "../src/pi/checkin-output";
import { syntheticClearMarkerRead } from "./synthetic-marker-read";
const f=JSON.parse(readFileSync(new URL("./fixtures/plastic-xlink-merge-source.json",import.meta.url),"utf8"));
const originalPending=observeWorkspacePending(f.machine,f.cwd),originalStandard=observeWorkspaceStandard(f.standard,originalPending);
assert(validateXlinkOwnership(f.proof));assert(assessWorkspaceState(originalPending,originalStandard,{source:"cs:157",ownership:f.proof}).ready);
assert.equal(parseFileOwnership(f.files).length,2);assert.equal(parseMountTree(f.sourceTree,f.proof.mount.path).changeset,"8");
for(const mutate of [
 (o:any)=>o.root.server="foreign",(o:any)=>o.mount.repository=o.root.repository,(o:any)=>o.mount.sourceChangeset="9",(o:any)=>o.mount.sourceBranch="/main/foreign",(o:any)=>o.mount.path="/wrong",(o:any)=>o.reads.pop(),(o:any)=>o.reads[0].capture.complete=false,(o:any)=>o.reads[0].attempt.aborted=true,(o:any)=>o.rows[0].repository="foreign",(o:any)=>o.rows[0].mount="/wrong",(o:any)=>o.rows.push(o.rows[0]),(o:any)=>o.rows[0].path=f.cwd+"/../escape"
]){const o=structuredClone(f.proof);mutate(o);assert(!assessWorkspaceState(originalPending,originalStandard,{source:"cs:157",ownership:o}).ready);}
for(const source of ["cs:158","cs:157@Foreign@example@unity","/main/other"])assert(!assessWorkspaceState(originalPending,originalStandard,{source,ownership:f.proof}).ready);
for(const extra of [originalStandard.links[0],{...originalStandard.links[0],repository:"Foreign"}])assert(!assessWorkspaceState(originalPending,{...originalStandard,links:[...originalStandard.links,extra]},{ownership:f.proof}).ready);
// Identical numeric changeset IDs never substitute for repository identity.
const collision=structuredClone(f.proof),collisionPending=structuredClone(originalPending),collisionStandard=structuredClone(originalStandard);
collision.mount.sourceChangeset=collision.root.sourceChangeset;collision.rows.find((r:any)=>r.mount!=="/").changeset=collision.root.sourceChangeset;collisionPending.rows.find((r:any)=>r.mergeChangeset==="8")!.mergeChangeset="157";collisionStandard.links.find((r:any)=>r.changeset==="8")!.changeset="157";
assert(assessWorkspaceState(collisionPending,collisionStandard,{ownership:collision}).ready);collision.rows[0].repository="Foreign";assert(!assessWorkspaceState(collisionPending,collisionStandard,{ownership:collision}).ready);
const root=await realpath(await mkdtemp(join(tmpdir(),"pi-xlink-owned-"))),mount=join(root,"fixtures","synthetic-xlink","mount"),rootFile=join(root,"fixtures","synthetic-xlink","root.txt"),linkedFile=join(mount,"linked.txt");
await mkdir(mount,{recursive:true});await writeFile(rootFile,"root source\n");await writeFile(linkedFile,"linked source\n");
const replace=(s:string)=>s.replaceAll(f.cwd,root);
const machine=replace(f.machine),full=root.startsWith("/")?replace(f.standard).replaceAll("\\","/"):replace(f.standard),files=replace(f.files),mountXml=replace(f.mount),header=machine.split(/\r?\n/)[0]+"\r\n";
const pending=observeWorkspacePending(machine,root),standard=observeWorkspaceStandard(full,pending);
assert.equal(pending.issues.length,0);assert.equal(standard.issues.length,0);
let mode="positive",after=false,compound=false,applied=false;let controller:AbortController|undefined;const calls:string[][]=[];
const deps={spawn:((_:string,args:string[])=>{const marker=syntheticClearMarkerRead(args);if(marker)return marker;calls.push(args);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});queueMicrotask(()=>{child.emit("spawn");let out="",code=0;
 if(args[0]==="status") {
 out=args.includes("--machinereadable")?(after||compound&&!applied?header:machine):(after||compound&&!applied?full.split("\r\n")[0]+"\r\n":full);
 if(!after&&args.includes("--machinereadable")) {
  if(mode==="deleted")out=out.replace("RP\x1f","DE\x1f");
  if(mode==="directory")out=out.replace("\x1fFalse\x1f","\x1fTrue\x1f");
  if(mode==="private"||mode==="unrelated")out += [mode==="private"?"PR":"CH",join(root,"extra.txt"),"False",mode==="private"?"-1":"1","NO_MERGES"].join("\x1f")+"\r\n";
 }
}
 else if(args[0]==="fileinfo") {out=args.filter(a=>a===rootFile||a===linkedFile).length===2?files:mountXml;if(mode==="foreign")out=out.replaceAll("Linked Repository","Foreign");if(mode==="readonly")out=out.replace("<UnderXlinkWritable>true", "<UnderXlinkWritable>false");if(mode==="nested")out=out.replace("<IsXlink>false", "<IsXlink>true");if(mode==="missing")out="";if(mode==="partial")code=1;if(mode==="quota")out="x".repeat(65537);if(mode==="aggregate")out=out.replace("<FileInfos>","<FileInfos><!--"+"x".repeat(50000)+"-->");if(mode==="cancel")controller!.abort();}
 else if(args[0]==="ls") {out=args.some(a=>a.includes("cs:156@"))?f.targetTree:f.sourceTree;if(mode==="source")out=out.replaceAll("<Changeset>8</Changeset>","<Changeset>9</Changeset>");if(mode==="aggregate")out=out.replace("<LsResults>","<LsResults><!--"+"x".repeat(50000)+"-->");}
 else if(args[0]==="merge"){applied=true;out="Native merge completed";}
 else if(args[0]==="checkin") {after=true;const sep=(key:string)=>args.find(a=>a.startsWith(key+"="))!.slice(key.length+1);const frame=(op:string,...values:string[])=>sep("--startlineseparator")+[op,...values].join(sep("--fieldseparator"))+sep("--endlineseparator")+"\r\n";out=frame("CI_START")+frame("RP",rootFile)+frame("CO",mount)+frame("CHANGESET",`cs:99@br:/main/linked-target@Linked Repository@example@unity (mount:'/fixtures/synthetic-xlink/mount'),cs:999@br:/main/target@Example Repository@example@unity (mount:'/')`);}
 else throw Error("Unexpected command");child.stdout.end(out);child.stderr.end();child.emit("close",code,null);});return child;}) as any};
try{
 const observed=await runWithAbortSignal(undefined,()=>observeXlinkOwnership(pending,standard),deps);assert(validateXlinkOwnership(observed));assert.equal(calls.length,4);
 const changedPin=structuredClone(observed);changedPin.root!.sourceChangeset="158";for(const row of changedPin.rows.filter(r=>r.mount==="/"))row.changeset="158";
 calls.length=0;const pinned=await runWithAbortSignal(undefined,()=>assembleCheckinReceipt({workdir:root,message:"pin drift",includeAll:true},changedPin),deps);assert(!pinned.ok);assert.equal(!pinned.ok&&pinned.error.code,"ownership_pin_changed");assert(!calls.some(c=>c[0]==="checkin"));
 assert(correlateOwnedCheckin([{operation:"RP",path:rootFile},{operation:"CO",path:mount}],observed,root,[{mount:observed.mount!.path,branch:observed.mount!.branch,repository:observed.mount!.repository,server:observed.mount!.server}]));
 for(mode of ["foreign","readonly","nested","missing","partial","quota","source","aggregate","cancel","deleted","directory","private","unrelated"]){
calls.length=0;after=false;controller=new AbortController();const r=await runWithAbortSignal(controller.signal,()=>executeCheckinOutput({workdir:root,message:"blocked",includeAll:true}),deps);assert(validateCheckinOutput(r.structuredContent));assert(!r.structuredContent.ok,mode);assert(!calls.some(c=>c[0]==="checkin"||c.includes("--merge")),mode);}
 const over=structuredClone(pending);over.rows=Array.from({length:33},(_,i)=>({...pending.rows[0],path:join(root,`quota-${i}.txt`)}));calls.length=0;const limited=await runWithAbortSignal(undefined,()=>observeXlinkOwnership(over,standard),deps);assert(!limited.complete);assert.equal(calls.length,0);
 mode="positive";calls.length=0;after=false;
 const partial=await runWithAbortSignal(undefined,()=>executeCheckinOutput({workdir:root,message:"partial must stop",paths:[rootFile]}),deps);assert(!partial.structuredContent.ok);assert(!calls.some(c=>c[0]==="checkin"));
 calls.length=0;after=false;const result=await runWithAbortSignal(undefined,()=>executeCheckinOutput({workdir:root,message:"exact owned merge",includeAll:true}),deps);assert(result.structuredContent.ok,JSON.stringify(result.structuredContent));assert.equal(calls.filter(c=>c[0]==="checkin").length,1);
 for(const mutate of [(o:any)=>o.complete=false,(o:any)=>o.rows[0].status="DE",(o:any)=>o.rows[0].isDirectory=true,(o:any)=>o.reads[0].capture.stdoutBytes=999999]){const forged=structuredClone(result.structuredContent);mutate(forged.data.assessment!.ownership);assert(!validateCheckinOutput(forged));}
 calls.length=0;after=false;const merge=await runWithAbortSignal(undefined,()=>executeWorkspaceMergeOutput("merge",{source:"cs:157",workdir:root}),deps);assert(merge.structuredContent.ok);
 for(const mutate of [(o:any)=>o.rows[0].status="DE",(o:any)=>o.rows[0].isDirectory=true]){const forged=structuredClone(merge.structuredContent);mutate(forged.data.assessment!.ownership);assert(!validateWorkspaceMergeOutput(forged));}
 compound=true;applied=false;after=false;calls.length=0;
 const closeout=await runWithAbortSignal(undefined,()=>executeCloseoutOutput({source:"/main/target/source",target:"/main/target",message:"owned compound",workdir:root,updateTarget:false}),deps);
 assert(closeout.structuredContent.ok,JSON.stringify(closeout.structuredContent));assert.equal(calls.filter(c=>c[0]==="checkin").length,1);
 for(const mutate of [(o:any)=>o.rows[0].status="DE",(o:any)=>o.rows[0].isDirectory=true]){const forged=structuredClone(closeout.structuredContent);const stage=forged.data.stages.find((s:any)=>s.kind==="merge")!;if(stage.kind==="merge")mutate(stage.result.data.assessment!.ownership);assert(!validateCloseoutOutput(forged));}
for(const stageName of ["loaded-before-checkin","checkin"])for(const mutate of [(o:any)=>o.rows[0].status="DE",(o:any)=>o.rows[0].isDirectory=true]){const forged:any=structuredClone(closeout.structuredContent);const stage=forged.data.stages.find((s:any)=>s.name===stageName);mutate(stageName==="checkin"?stage.result.data.assessment.ownership:stage.result.assessment.ownership);assert(!validateCloseoutOutput(forged));}
}finally{await rm(root,{recursive:true,force:true});}
console.log("PASS: exact sanitized Xlink ownership, repository collision isolation, bounded read failures, scope barriers, typed checkin, no checkin/replay on negatives and forged-proof rejection");
