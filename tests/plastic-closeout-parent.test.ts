import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {runWithAbortSignal} from "../src/execution/context";
import {assembleCloseoutReceipt} from "../src/operations/closeout-receipt";
import {validateCloseoutOutput} from "../src/pi/closeout-output";
import {loadRegisteredTools} from "./pi-tool-harness";
const cwd="C:\\Example\\workspace",source="/main/parent/owned-source",parent="/main/parent",repo="Example Repository",server="example@unity";
let mode="valid";const calls:string[][]=[];
const deps={spawn:((_:string,args:string[])=>{calls.push([...args]);const p=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});queueMicrotask(()=>{p.emit("spawn");let out:string|Buffer="",err="",exit=0;if(args[0]==="status")out=args.includes("--machinereadable")?`STATUS\x1f16\x1f${repo}\x1f${server}\r\n`:`${source}@${repo}@${server} (cs:16 - head)\r\n\r\n`;else if(args[0]==="find"){
 // Installed CM: filter name is leaf; format name is full hierarchy. Old full-path filter returns no rows.
 if(args[2].startsWith("where name = 'owned-source'"))out=source+"|"+parent+"\r\n";
 if(mode==="empty")out="";if(mode==="ambiguous")out=source+"|"+parent+"\r\n/main/other/owned-source|/main/other\r\n";if(mode==="wrong-source")out="/main/other/owned-source|/main/other\r\n";if(mode==="wrong-parent")out=source+"|/main/elsewhere\r\n";if(mode==="qualified-parent")out=source+"|"+parent+"@"+repo+"@"+server+"\r\n";if(mode==="root")out=source+"|\r\n";if(mode==="malformed")out=source+"|"+parent+"|extra\r\n";if(mode==="warning")err="Unknown warning";if(mode==="error"){exit=1;err="Owned synthetic unavailable query";}if(mode==="invalid")out=Buffer.from([255]);if(mode==="overflow")out=Buffer.alloc(65537);
 }else throw Error("No mutation permitted: "+JSON.stringify(args));p.stdout.end(out);p.stderr.end(err);p.emit("close",exit,null);});return p;})as any};
if(process.platform==="win32"){
 for(const requested of [undefined,source,"br:"+source,source+"@"+repo+"@"+server]){
 mode="valid";calls.length=0;const d=await runWithAbortSignal(undefined,()=>assembleCloseoutReceipt({source:requested,preflight:true,workdir:cwd}),deps);assert(d.ok,"Leaf-filter/full-name source observation must resolve parent");assert(validateCloseoutOutput(d));assert.equal(d.data.targetBranch,requested?.includes("@")?parent+"@"+repo+"@"+server:parent);assert.equal(d.data.targetSource,"parent-read");assert.equal(calls.filter(a=>a[0]==="find").length,1);const q=calls.find(a=>a[0]==="find")!;assert.equal(q[2],"where name = 'owned-source' order by branchname asc limit 2"+(requested?.includes("@")?` on repository '${repo}@${server}'`:""));assert.deepEqual(q.slice(3),["--format={name}|{parent}","--nototal"]);assert(calls.every(a=>["status","find"].includes(a[0])));
 for(const mutate of [(x:any)=>x.data.stages[1].result.argv[2]="where name = '/main/parent/owned-source'",(x:any)=>x.data.stages[1].result.parentPath="/main/unrelated",(x:any)=>{x.data.stages[1].result.capture.stdoutBytes=0;x.data.stages[1].result.capture.stdoutRetainedBytes=0;},(x:any)=>x.data.stages.splice(1,0,structuredClone(x.data.stages[1]))]){const f=structuredClone(d);mutate(f);assert(!validateCloseoutOutput(f));}
 }
 for(const m of ["empty","ambiguous","wrong-source","wrong-parent","qualified-parent","root","malformed","warning","error","invalid","overflow"]){mode=m;calls.length=0;const d=await runWithAbortSignal(undefined,()=>assembleCloseoutReceipt({source,preflight:true,workdir:cwd}),deps);assert(!d.ok,m);assert(validateCloseoutOutput(d),m);assert.equal(d.data.targetBranch,null);assert.equal(d.data.effect,"not-attempted");assert.equal(calls.filter(a=>a[0]==="find").length,1);assert.equal(calls.length,2);}
 mode="valid";calls.length=0;const tools=await loadRegisteredTools(),r=await runWithAbortSignal(undefined,()=>tools.get("plastic_mergeToBranch")!.execute("owned-parent-fixture",{source,preflight:true,workdir:cwd}),deps);assert(r.structuredContent.ok);assert(validateCloseoutOutput(r.structuredContent));assert.equal(calls.filter(a=>a[0]==="find").length,1);
}
console.log("PASS: installed leaf-filter/full-name protocol, one bounded query, default/br/qualified parent discovery, ambiguity/identity/capture barriers, exact argv anti-forgery and zero mutation");
