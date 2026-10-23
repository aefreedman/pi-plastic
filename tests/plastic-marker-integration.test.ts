import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithAbortSignal } from "../src/execution/context";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { executeCheckinOutput, validateCheckinOutput } from "../src/pi/checkin-output";
import { executeCloseoutOutput, validateCloseoutOutput } from "../src/pi/closeout-output";
import { loadRegisteredTools } from "./pi-tool-harness";
import { searchPlasticTools } from "../src/plastic-tool-loading";
const cwd="C:\\Example\\workspace",repo="Example Repository",server="example@unity";
const machine=`STATUS\x1f16\x1f${repo}\x1f${server}\r\n`;
type Mode="clear"|"pending"|"error"|"overflow"|"invalid"|"timeout"|"stderr"|"unresolved";
// All protocol and process observations here are synthetic, not real SCM evidence.
async function invoke(route:"merge"|"checkin"|"closeout",mode:Mode, failListing=1, partial?:string){
 const calls:string[][]=[];let listings=0,branch="/main/source",applied=false;
 const deps={spawn:((_:string,argv:string[])=>{
  calls.push([...argv]);const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(signal:string){queueMicrotask(()=>{c.stdout.end();c.stderr.end();c.emit("close",null,signal);});return true;}});
  queueMicrotask(()=>{c.emit("spawn");let out:string|Buffer="",err="",code=0;
   if(argv.includes("--list-conflict-markers")){
    listings++;if(listings===failListing){
     if(mode==="pending"){out="CONFLICT_MARKERS fixture.txt\r\n";code=1;}if(mode==="error"){err="Unknown client failure";code=1;}if(mode==="overflow")out=Buffer.alloc(65537);if(mode==="invalid")out=Buffer.from([255]);if(mode==="stderr")err="warning";
     if(mode==="timeout"){(c as any).__tick?.();return;}
    }
   }else if(argv[0]==="status"){
    out=argv.includes("--machinereadable")?machine:`${branch}@${repo}@${server} (cs:16 - head)\r\n\r\n`;
    if(mode==="unresolved"&&(applied||route==="checkin"))out=argv.includes("--machinereadable")?machine+`CO\x1f${cwd}\\fixture.txt\x1fFalse\x1f-1\x1fNO_MERGES\r\n`:out+"Merge in progress\r\n";
   }else if(argv[0]==="switch")branch="/main/target";
   else if(argv[0]==="merge") {applied=true;out=partial?`UNRESOLVED fixture (${partial})\r\n`:"Native complete; deliberately no FILE_SRC/DO_MERGE declarations\r\n";if(partial)code=1;}
   else if(argv[0]==="checkin")throw Error("Forbidden checkin in stop-path fixture");
   else throw Error("Unexpected "+JSON.stringify(argv));
   c.stdout.end(out);c.stderr.end(err);c.emit("close",code,null);
  });return c;
 })as any,
 setTimeout:((callback:()=>void)=>{ // only trigger timeout in the selected listing process
  if(mode==="timeout"&&calls.at(-1)?.includes("--list-conflict-markers")&&listings===failListing-1)queueMicrotask(callback);
  return {};
 })as any,clearTimeout:(()=>{})as any};
 const r=await runWithAbortSignal(undefined,()=>route==="merge"?executeWorkspaceMergeOutput("merge",{source:"/main/source",workdir:cwd}):route==="checkin"?executeCheckinOutput({message:"Fixture",workdir:cwd}):executeCloseoutOutput({source:"/main/source",target:"/main/target",updateTarget:false,message:"Fixture",workdir:cwd}),deps);
 return {r,calls,listings};
}
if(process.platform==="win32"){
 for(const route of ["merge","checkin","closeout"] as const)for(const mode of ["pending","error","overflow","invalid","stderr","timeout","unresolved"] as const){
  const {r,calls,listings}=await invoke(route,mode);assert(r.isError,route+" "+mode);assert(!calls.some(a=>a[0]==="checkin"));assert.equal(listings,1,"No failed-list retry");assert.equal(calls.filter(a=>a.includes("--merge")).length,route==="checkin"?0:1);
  assert(route==="merge"?validateWorkspaceMergeOutput(r.structuredContent):route==="checkin"?validateCheckinOutput(r.structuredContent):validateCloseoutOutput(r.structuredContent));
  if(mode==="overflow"||mode==="invalid"||mode==="timeout")assert.equal(r.structuredContent.completeness.capture,"incomplete");
 }
 for(const failAt of [2,3]){const {r,calls,listings}=await invoke("closeout","pending",failAt);assert(r.isError);assert(validateCloseoutOutput(r.structuredContent));assert.equal(listings,failAt);assert.equal(calls.filter(a=>a.includes("--merge")).length,1);assert(!calls.some(a=>a[0]==="checkin"));const d:any=r.structuredContent;assert.equal(d.data.stages.at(-1).name,failAt===2?"checkin-preflight":"checkin");}
 for(const kind of ["binary","symlink","recursive","directory","delete-change"]){const {r,calls,listings}=await invoke("merge","clear",1,kind);assert(r.isError);assert.equal(calls.length,1);assert.equal(listings,0);assert.equal(r.structuredContent.data.commandCompleted,false);assert.match(r.structuredContent.data.commandOutput!.stdout,new RegExp(kind));assert(!calls[0].some(a=>/keep(source|destination)|automaticresolution|external/.test(a)));assert(calls[0].includes("--conflict-markers"));}
}
// Synthetic end-to-end all-copy profiles must retain the same pending contract
// through native merge, independent closeout reads and checkin selection.
if(process.platform==="win32")for(const profile of ["directory","private"] as const){
 const calls:string[][]=[];let pending=false,checked=false;
 const rows=profile==="directory"?[{path:"newdir",dir:true},{path:"newdir\\child.txt",dir:false}]:[{path:"copied.txt",dir:false}];
 const privateRow=profile==="private"?`PR\x1f${cwd}\\unrelated.txt\x1fFalse\x1f-1\x1fNO_MERGES\r\n`:"";
 const pendingMachine=machine+rows.map((r,i)=>`CP\x1f${cwd}\\${r.path}\x1f${r.dir?"True":"False"}\x1f${680+i}\x1fMerge from 27\r\n`).join("")+privateRow;
 const full=`/main/target@${repo}@${server} (cs:16 - head)\r\n\r\nPending merge links\r\n    Merge from cs:27 at /main/source@${repo}@${server}\r\n\r\nAdded\r\n    Status    Size    Last Modified    Path\r\n\r\n`+rows.map(r=>`    Copied (new) (Merge from 27)    ${r.dir?"":"44 bytes    "}Opaque time    ${r.path}\r\n`).join("")+(privateRow?"    Private    44 bytes    Opaque time    unrelated.txt\r\n":"");
 const deps={spawn:((_:string,argv:string[])=>{
  calls.push([...argv]);const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});
  queueMicrotask(()=>{c.emit("spawn");let out="";
   if(argv.includes("--list-conflict-markers"))out="";
   else if(argv[0]==="status")out=argv.includes("--machinereadable")?(pending?pendingMachine:(checked?machine.replace("16","18")+privateRow:machine)):(pending?full:`/main/target@${repo}@${server} (cs:${checked?18:16} - head)\r\n\r\n`);
   else if(argv[0]==="merge"){pending=true;out="Native marker merge completed\r\n";}
   else if(argv[0]==="switch")out="";
   else if(argv[0]==="checkin"){
    const sep=(k:string)=>argv.find(a=>a.startsWith(k+"="))!.slice(k.length+1),frame=(op:string,...f:string[])=>sep("--startlineseparator")+[op,...f].join(sep("--fieldseparator"))+sep("--endlineseparator")+"\r\n";
    out=frame("CI_START")+frame("STAGE","")+rows.map(r=>frame("CP",cwd+"\\"+r.path)).join("")+frame("CHANGESET",`cs:18@br:/main/target@${repo}@${server} (mount:'/')`);pending=false;checked=true;
   }else throw Error("Unexpected all-copy command "+JSON.stringify(argv));
   c.stdout.end(out);c.stderr.end();c.emit("close",0,null);
  });return c;
 })as any};
 const r=await runWithAbortSignal(undefined,()=>executeCloseoutOutput({source:"/main/source",target:"/main/target",updateTarget:false,message:"Synthetic all-copy closeout",workdir:cwd}),deps);
 assert(validateCloseoutOutput(r.structuredContent));assert(r.structuredContent.ok,profile+": "+JSON.stringify(r.structuredContent));
 assert.equal(calls.filter(a=>a.includes("--merge")).length,1);assert.equal(calls.filter(a=>a[0]==="checkin").length,1);assert(!calls.some(a=>a[0]==="add"));
 assert.equal(r.structuredContent.data.createdChangeset?.id,"18");assert.equal(r.structuredContent.data.pendingAfter?.private,profile==="private"?1:0);
 if(profile==="private"){const ci=calls.find(a=>a[0]==="checkin")!;assert(ci.includes("copied.txt"));assert(!ci.some(a=>a.includes("unrelated.txt")));}
}
const tools=await loadRegisteredTools();assert(!tools.has("plastic_finalizeMerge"));assert(!searchPlasticTools("finalize merge").some((r:any)=>r.name==="plastic_finalizeMerge"));
const dir=await mkdtemp(join(tmpdir(),"pi-marker-integration-"));try{
 await writeFile(join(dir,"intentional.txt"),"<<<<<<< intentional documentation example\n");let commands:string[][]=[];
 const mark=tools.get("plastic_mergeMarkResolved")!;assert(mark.outputSchema);assert(tools.get("plastic_mergeListConflictMarkers")!.outputSchema);
 for(const args of [{paths:["intentional.txt"],preflight:true},{paths:["../escape.txt"],acknowledgeIntentionalMarkers:true,preflight:true}]){const r=await mark.execute("fixture",{...args,workdir:dir});assert(r.isError);}
 const result=await runWithAbortSignal(undefined,()=>mark.execute("fixture",{paths:["intentional.txt"],acknowledgeIntentionalMarkers:true,preflight:true,workdir:dir}),{spawn:((_:string,a:string[])=>{commands.push(a);throw Error("No SCM command permitted");})as any});assert(!result.isError);assert.equal(result.structuredContent.outcome,"preflight");assert.equal(commands.length,0);assert.equal(result.structuredContent.data.checkinReadiness,"unknown");
}finally{await rm(dir,{recursive:true,force:true});}
console.log("PASS: synthetic marker failures/partial non-text effects stop merge/checkin/closeout without retries; compact completeness; intentional bypass registration and removed API");
