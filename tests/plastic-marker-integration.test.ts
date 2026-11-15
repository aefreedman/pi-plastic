import assert from "node:assert/strict";
import { executeWorkspaceMergeOutput } from "../src/pi/workspace-merge-output";
import { executeCloseoutOutput } from "../src/pi/closeout-output";
import { nativeFixture } from "./native-adapter-fixture";
for (const mode of ["CONFLICT_MARKERS /file.txt\n", "UNRESOLVED /image.bin (binary)\n"]) {
    const f = nativeFixture({ mergeCode: 1, prefix: mode });
    const merged = await f.run(() => executeWorkspaceMergeOutput("merge", { source: "/main/source" }));
    assert(!merged.structuredContent.ok); assert.equal(f.calls.length, 1); assert.match(merged.content[0].text, /CONFLICT_MARKERS|UNRESOLVED/);
    const c = nativeFixture({ mergeCode: 1, prefix: mode });
    const closeout = await c.run(() => executeCloseoutOutput({ source: "/main/source", target: "/main/target" }));
    assert(!closeout.structuredContent.ok); assert.equal(c.calls.filter(a => a[0] === "merge").length, 1); assert(!c.calls.some(a => a[0] === "checkin"));
}
console.log("PASS: native marker/non-text failures retained; compound never checks in or replays failed merge");
