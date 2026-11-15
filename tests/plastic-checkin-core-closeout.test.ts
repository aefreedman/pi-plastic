import assert from "node:assert/strict";
import { checkin, mergeToBranch } from "../src/plastic-core";
import { loadRegisteredTools } from "./pi-tool-harness";
import { nativeFixture } from "./native-adapter-fixture";
for(const command of ["checkin","closeout"]){const f=nativeFixture({checkinCode:1});await assert.rejects(()=>f.run(()=>command==="checkin"?checkin.execute({message:"refusal"}):mergeToBranch.execute({source:"/main/source",target:"/main/target"})));assert.equal(f.calls.filter(c=>c[0]==="checkin").length,1);}
const f=nativeFixture({unknownOutput:true});const tools=await loadRegisteredTools();const r=await f.run(()=>tools.get("plastic_checkin")!.execute("native-contract",{message:"no identity output"}));assert(r.structuredContent.ok);assert.equal(r.structuredContent.schemaVersion,2);assert.equal(r.structuredContent.data.createdChangeset,null);assert.equal(f.calls.length,1);
console.log("PASS: core rejection on native failure and registered v2 unknown identity success without retry");
