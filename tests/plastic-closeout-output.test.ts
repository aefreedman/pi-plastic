import assert from "node:assert/strict";
import { executeCloseoutOutput, validateCloseoutOutput } from "../src/pi/closeout-output";
import { nativeFixture, cwd } from "./native-adapter-fixture";
for(const options of [{},{initialTarget:true},{prefix:"x".repeat(80000)+"😀\n"},{mergeCode:1},{checkinCode:1},{updateCode:1},{dirty:true,initialTarget:true},{links:true,initialTarget:true}]){
 const f=nativeFixture(options);const r=await f.run(()=>executeCloseoutOutput({source:"/main/source",target:"/main/target",workdir:cwd,message:"native closeout"}));
 assert(validateCloseoutOutput(r.structuredContent),JSON.stringify(r.structuredContent));const d=r.structuredContent;
 assert.equal(d.ok,!options.mergeCode&&!options.checkinCode&&!options.updateCode&&!options.dirty&&!options.links);
 assert.equal(f.calls.filter(c=>c[0]==="merge").length,options.dirty||options.links||options.updateCode?0:1);
 assert.equal(f.calls.filter(c=>c[0]==="checkin").length,options.dirty||options.links||options.updateCode||options.mergeCode?0:1);
 assert.equal(f.calls.some(c=>c[0]==="fileinfo"||c[0]==="ls"||c[0]==="add"),false);
 if(options.initialTarget)assert(!f.calls.some(c=>c[0]==="switch"));
 if(options.dirty||options.links)assert(f.calls.every(c=>["status","find"].includes(c[0])));
 const forged=structuredClone(d);forged.data.effect="uncertain";if(d.data.effect!=="uncertain")assert(!validateCloseoutOutput(forged));
}
for(const args of [{preflight:true},{source:"/main/source",target:"/main/target",preflight:true}]){const f=nativeFixture();const r=await f.run(()=>executeCloseoutOutput(args));assert(r.structuredContent.ok);assert.equal(f.calls.length,0);assert.equal(r.structuredContent.data.targetBranch,args.target??null);}
const f=nativeFixture();const r=await f.run(()=>executeCloseoutOutput({target:"/main/target",updateTarget:false}));assert(r.structuredContent.ok);assert.equal(r.structuredContent.data.sourceBranch,"/main/source");
console.log("PASS: v2 compound clean-start even already target, one-shot child ledger, no continuation after failures, no ownership reads, pure unresolved previews");
