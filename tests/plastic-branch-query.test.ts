import assert from "node:assert/strict";
import { __plasticBranchInternals } from "../src/plastic-core.ts";

const { getBranchLeafName } = __plasticBranchInternals;

assert.equal(getBranchLeafName("/main/feature/test"), "test");
assert.equal(getBranchLeafName("br:/main/feature/test"), "test");
assert.equal(getBranchLeafName("br:/main/feature/test@repo@server"), "test");
assert.equal(getBranchLeafName("test"), "test");

console.log("PASS: Plastic branch query normalization tests passed");
