import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { executeCheckinOutput, validateCheckinOutput } from "../src/pi/checkin-output";
import { checkin } from "../src/operations/checkin";
import { checkinIdentityCollector, parseCheckinEvidence } from "../src/domain/checkin-contract";
import { nativeFixture, cwd } from "./native-adapter-fixture";
for (const options of [{}, { stderr: "native warning" }, { prefix: "x".repeat(100000) + "😀\n" }, { unknownOutput: true }, { invalidIdentity: true }, { malformedAfter: true }, { checkinCode: 1 }, { streamFailure: true }]) {
    const fixture = nativeFixture(options), result = await fixture.run(() => executeCheckinOutput({ message: "exact comment\nsecond line", paths: ["selected.txt", "selected.txt"], includeAll: true, includePrivate: true, workdir: cwd }));
    assert(validateCheckinOutput(result.structuredContent)); const dto = result.structuredContent;
    assert.equal(dto.schemaVersion, 2); assert.equal(dto.ok, !options.checkinCode && !options.streamFailure);
    assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0][0], "checkin"); if (!options.streamFailure) assert.equal(fixture.kills.length, 0);
    assert.deepEqual(fixture.calls[0].slice(0, 6), ["checkin", "-c=exact comment\nsecond line", "--all", "--private", "selected.txt", "selected.txt"]);
    assert(!fixture.calls[0].includes("--applychanged"));
    if (!options.unknownOutput && !options.invalidIdentity) assert.equal(dto.data.createdChangeset?.id, "9007199254740997", "Valid identity survives later parse/native failure");
    else { assert.equal(dto.data.createdChangeset, null); assert.equal(dto.data.identityObservation.complete, false); }
    if (options.prefix) { assert(dto.data.capture?.truncated); assert(dto.data.capture.complete); assert(dto.data.identityObservation.complete); assert.equal(dto.completeness.projection, false); }
    const forged = structuredClone(dto); forged.data.commandCompleted = !forged.data.commandCompleted; assert(!validateCheckinOutput(forged));
}
const preview = nativeFixture(); const p = await preview.run(() => executeCheckinOutput({ message: "preview", paths: Array.from({ length: 130 }, (_, i) => `file-${i}`), preflight: true }));
assert(p.structuredContent.ok); assert.equal(preview.calls.length, 0); assert.equal(p.structuredContent.data.requested?.paths?.length, 130);
for (const input of [{message:"bad",paths:["--all"]},{message:"bad",updateAfter:true},{message:""},{message:"bad",extra:true},{message:"bad",paths:["-"]}]) { const f=nativeFixture();const r=await f.run(()=>executeCheckinOutput(input));assert(!r.structuredContent.ok);assert.equal(f.calls.length,0); }
const core=nativeFixture({checkinCode:1});await assert.rejects(()=>core.run(()=>checkin.execute({message:"native refusal"})));assert.equal(core.calls.length,1);
const s={start:"__S__",end:"__E__",field:"__F__"};const list=Array.from({length:40},(_,i)=>`cs:${i}@br:/main@Repo${i}@example@unity (mount:'/mount${i}')`).join(",")+",cs:99@br:/main@Root@example@unity (mount:'/')";
const parsed=parseCheckinEvidence(s.start+"CHANGESET"+s.field+list+s.end+"\n",s);assert(parsed.admitted);assert.equal(parsed.linkedChangesets.length,40);
const collector=checkinIdentityCollector(s);collector.feed(s.start+"CHANGESET"+s.field+"x".repeat(70000)+s.end);assert.equal(collector.result().identityObservation.complete,false);
console.log("PASS: v2 one-shot exact checkin, native refusals, identities after large output, chunked UTF8, no hidden recovery, pure preview, arbitrary counts projected not gated");

for (const name of ["plastic-checkin-source.json", "plastic-checkin-xlink-source.json"]) {
    const fixture=JSON.parse(readFileSync(new URL("./fixtures/"+name,import.meta.url),"utf8"));
    const parsed=parseCheckinEvidence(fixture.created,fixture.separators);
    assert(parsed.identityObservation.complete);assert.equal(parsed.changesets.length,1);
}
