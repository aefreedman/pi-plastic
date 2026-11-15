import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal } from "../src/execution/context";
import { assembleCloseoutReceipt } from "../src/operations/closeout-receipt";
import { validateCloseoutOutput } from "../src/pi/closeout-output";
const source="/main/parent/owned-source",parent="/main/parent",repo="Example Repository",server="example@unity";
for(const mode of ["valid","empty","ambiguous","wrong-source","wrong-parent","qualified-parent","root","malformed","error","invalid","overflow"]){
 const calls:string[][]=[];const result=await runWithAbortSignal(undefined,()=>assembleCloseoutReceipt({source:source+"@"+repo+"@"+server}),{spawn:((_:string,args:string[])=>{calls.push(args);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){throw Error("No overflow kill");}});queueMicrotask(()=>{child.emit("spawn");let out:string|Buffer="",code=0;
 if(args[0]==="status")out=args.includes("--machinereadable")?`STATUS\x1f16\x1f${repo}\x1f${server}\r\nUNKNOWN existing work\r\n`:`${source}@${repo}@${server} (cs:16 - head)\r\n`;
 else if(args[0]==="find"){out=source+"|"+parent+"\r\n";if(mode==="empty")out="";if(mode==="ambiguous")out+=out;if(mode==="wrong-source")out="/wrong|/main\r\n";if(mode==="wrong-parent")out=source+"|/other\r\n";if(mode==="qualified-parent")out=source+"|"+parent+"@repo@server\r\n";if(mode==="root")out=source+"|\r\n";if(mode==="malformed")out+="extra\r\n";if(mode==="error")code=1;if(mode==="invalid")out=Buffer.from([255]);if(mode==="overflow")out="x".repeat(70000);}
 else throw Error("Mutation forbidden");child.stdout.end(out);child.stderr.end();child.emit("close",code,null);});return child;})as typeof import("node:child_process").spawn});
 assert(validateCloseoutOutput(result),mode);assert(!result.ok);assert(calls.every(c=>["status","find"].includes(c[0])));assert.equal(calls.filter(c=>c[0]==="find").length,1);
 const query=calls.find(c=>c[0]==="find")!;assert.equal(query[2],"where name = 'owned-source' order by branchname asc limit 2 on repository 'Example Repository@example@unity'");
 assert.equal(result.data.targetBranch,mode==="valid"?parent+"@"+repo+"@"+server:null);
}
console.log("PASS: execution-only parent discovery retains exact qualified leaf query; missing/ambiguous/unavailable defaults stop, preview remains pure");
