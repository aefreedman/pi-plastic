import assert from "node:assert/strict";
import { __plasticBranchInternals } from "../src/plastic-core.ts";

const { getBranchLeafName, resolveSafeBranchCreationTarget } = __plasticBranchInternals;

assert.equal(getBranchLeafName("/main/feature/test"), "test");
assert.equal(getBranchLeafName("br:/main/feature/test"), "test");
assert.equal(getBranchLeafName("br:/main/feature/test@repo@server"), "test");
assert.equal(getBranchLeafName("test"), "test");

assert.equal(resolveSafeBranchCreationTarget("foo", "/main"), "/main/foo");
assert.equal(resolveSafeBranchCreationTarget("feature/foo", "/main"), "/main/feature/foo");
assert.equal(resolveSafeBranchCreationTarget("/main/foo", "/main"), "/main/foo");
assert.equal(resolveSafeBranchCreationTarget("br:/main/foo", "br:/main@repo@server"), "br:/main/foo");
assert.throws(
  () => resolveSafeBranchCreationTarget("/foo", "/main"),
  /Refusing to create non-descendant branch \/foo.*allowNonDescendant=true/,
);
assert.throws(
  () => resolveSafeBranchCreationTarget("/main/sibling", "/main/current"),
  /Refusing to create non-descendant branch \/main\/sibling/,
);

console.log("PASS: Plastic branch query normalization tests passed");
