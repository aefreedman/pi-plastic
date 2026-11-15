import assert from "node:assert/strict";
import { executeWorkspaceMergeOutput, validateWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { merge } from "../src/operations/merge";
import { nativeFixture, cwd } from "./native-adapter-fixture";
for (const source of ["/main/source","cs:5018","cs:5018@rep:Example@repserver:example@unity","lb:release","sh:23"]) for (const strategy of ["auto","source","destination"] as const) {
    const fixture=nativeFixture({prefix:"x".repeat(70000)+"😀\n"});const result=await fixture.run(()=>executeWorkspaceMergeOutput("merge",{source,strategy,workdir:cwd}));
    assert(validateWorkspaceMergeOutput(result.structuredContent));assert(result.structuredContent.ok);assert.equal(result.structuredContent.schemaVersion,2);assert.equal(result.structuredContent.data.commandCompleted,true);assert(result.structuredContent.data.capture?.complete);assert(result.structuredContent.data.capture?.truncated);assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0][1],source);assert.equal(fixture.kills.length,0);
    assert.equal(fixture.calls[0].includes("--conflict-markers"),strategy==="auto");
}
for(const source of ["--merge","-"," ","bad\u0000"]){const f=nativeFixture();const r=await f.run(()=>executeWorkspaceMergeOutput("merge",{source}));assert(!r.structuredContent.ok);assert.equal(f.calls.length,0);}
const preview=nativeFixture();const r=await preview.run(()=>executeWorkspaceMergeOutput("merge",{source:"lb:release",preflight:true}));assert(r.structuredContent.ok);assert.equal(preview.calls.length,0);
const failed=nativeFixture({mergeCode:1});const negative=await failed.run(()=>executeWorkspaceMergeOutput("merge",{source:"cs:42"}));assert(!negative.structuredContent.ok);assert.equal(failed.calls.length,1);assert.equal(negative.structuredContent.data.attempt.exitCode,1);
const forged=structuredClone(negative.structuredContent);forged.data.commandCompleted=true;assert(!validateWorkspaceMergeOutput(forged));
await assert.rejects(()=>failed.run(()=>merge.execute({source:"cs:42"})));
console.log("PASS: v2 native selector/strategy forwarding, one merge, no semantic ownership gates, bounded draining diagnostics and native failure propagation");
