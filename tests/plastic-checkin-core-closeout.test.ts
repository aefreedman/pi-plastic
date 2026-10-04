import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { checkin, mergeToBranch, switchBranch, merge, runWithAbortSignal } from "../src/plastic-core";
import { loadRegisteredTools } from "./pi-tool-harness";
const cwd="C:\\Example\\workspace",us="\x1f";
const header=["STATUS","123","Example Repository","example@unity"].join(us)+"\r\n";
const row=["CH",cwd+"\\fixture.txt","False","125","NO_MERGES"].join(us)+"\r\n";
let branch="/main/source",pending=true,mode="permission",reads=0;
const calls:string[][]=[];
const deps={spawn:((_:string,argv:string[])=>{
  calls.push(argv);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});
  queueMicrotask(()=>{child.emit("spawn");let out="",err="",code=0;
    if(argv[0]==="status") {
      if(argv.includes("--machinereadable")) {reads++;out=mode==="unsupported"?"UNKNOWN":header+(pending?row:"");if(mode==="completed-post-failed"&&reads>1){err="Synthetic post-read failure";code=1;}}
      else out=argv.includes("--short")?"":`${branch}@Example Repository@example@unity (cs:123 - head)\r\n`;
    } else if(argv[0]==="checkin") {
      const sep=(k:string)=>argv.find(a=>a.startsWith(k+"="))!.slice(k.length+1);
      const frame=(op:string,values:string[]=[])=>sep("--startlineseparator")+[op,...values].join(sep("--fieldseparator"))+sep("--endlineseparator")+"\r\n";
      out=frame("CI_START")+frame("STAGE",[""]);
      if(mode==="completed-post-failed") out+=frame("CHANGESET",["cs:127@br:/main/target@Example Repository@example@unity (mount:'/')"]);
      else if(mode==="empty")out="";
      else {err="Synthetic permission denied";code=1;}
    } else if(argv[0]==="version")out="11.0.16.10371";
    else throw Error("Unexpected synthetic command "+JSON.stringify(argv));
    child.stdout.end(out);child.stderr.end(err);child.emit("close",code,null);
  });return child;
}) as any};
const request={message:"Fixture",includeAll:true,format:"json" as const,workdir:cwd};
if(process.platform==="win32") {
  for(const outcome of ["permission","empty","unsupported"]) {
    mode=outcome;reads=0;calls.length=0;
    await assert.rejects(()=>runWithAbortSignal(undefined,()=>checkin.execute(request),deps),"Every failed/uncertain/unsupported non-preflight core checkin must reject");
    assert.deepEqual(calls.map(a=>a[0]),outcome==="unsupported"?["status"]:["status","checkin"]);
  }
  await assert.rejects(()=>checkin.execute({...request,message:""}),/Invalid bounded/);
  for(const outcome of ["permission","unsupported"]) {
    mode=outcome;reads=0;calls.length=0;
    const preview=await runWithAbortSignal(undefined,()=>checkin.execute({...request,preflight:true}),deps);
    assert.equal(typeof preview,"string");assert.deepEqual(calls.map(a=>a[0]),["status"]);
  }
  mode="completed-post-failed";reads=0;calls.length=0;
  const completed=JSON.parse(await runWithAbortSignal(undefined,()=>checkin.execute(request),deps));
  assert(completed.ok);assert.equal(completed.data.createdChangeset.id,"127");assert.equal(completed.data.pendingAfter,null);
  const tools=await loadRegisteredTools();mode="permission";reads=0;calls.length=0;
  const native=await runWithAbortSignal(undefined,()=>tools.get("plastic_checkin")!.execute("fixture",request),deps);
  assert(native.isError);assert.equal(native.structuredContent.ok,false);assert.equal(native.structuredContent.outcome,"uncertain");

  // Actual closeout orchestrates actual core checkin. Only earlier mutation phases are synthetic stubs.
  const originals={switch:switchBranch.execute,merge:merge.execute};
  try {
    switchBranch.execute=async()=>{branch="/main/target";return "Synthetic switch";};
    merge.execute=async()=>{pending=true;return "Synthetic merge";};
    for(const outcome of ["permission","empty","unsupported"]) {
      mode=outcome;branch="/main/source";pending=false;reads=0;calls.length=0;
      await assert.rejects(()=>runWithAbortSignal(undefined,()=>mergeToBranch.execute({source:"/main/source",target:"/main/target",message:"Fixture",updateTarget:false,format:"json",workdir:cwd}),deps),"Closeout cannot claim checkedIn:true after failed child checkin");
      assert.equal(calls.filter(a=>a[0]==="checkin").length,outcome==="unsupported"?0:1,"Actual child dispatched at most once; no falsely successful later phases");
    }
  } finally {switchBranch.execute=originals.switch;merge.execute=originals.merge;}
} else await assert.rejects(()=>checkin.execute(request));
console.log("PASS: actual core failed/uncertain/unsupported rejection, non-mutating preflight strings, completed identity with failed post-read, native DTO preservation and actual closeout failure propagation with only earlier phases stubbed");
