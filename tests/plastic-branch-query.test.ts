import assert from "node:assert/strict";
import { __plasticBranchInternals } from "../src/plastic-core.ts";

const { getBranchLeafName, resolveBranchCreationTarget } = __plasticBranchInternals;

assert.equal(getBranchLeafName("/main/feature/test"), "test");
assert.equal(getBranchLeafName("br:/main/feature/test"), "test");
assert.equal(getBranchLeafName("br:/main/feature/test@repo@server"), "test");
assert.equal(getBranchLeafName("test"), "test");

assert.equal(resolveBranchCreationTarget("foo", "/main"), "/main/foo");
assert.equal(resolveBranchCreationTarget("feature/foo", "/main"), "/main/feature/foo");
assert.equal(resolveBranchCreationTarget("foo", "/release"), "/release/foo");
assert.equal(resolveBranchCreationTarget("/release/foo"), "/release/foo");
assert.equal(resolveBranchCreationTarget("br:/release/foo@repo@server"), "br:/release/foo@repo@server");
assert.equal(resolveBranchCreationTarget("/foo", undefined, true), "/foo");
assert.throws(
  () => resolveBranchCreationTarget("/foo"),
  /Refusing to create top-level branch \/foo.*allowRootBranch=true/,
);
assert.throws(
  () => resolveBranchCreationTarget("foo"),
  /relative branch name requires a parent branch/,
);

console.log("PASS: Plastic branch query normalization tests passed");
