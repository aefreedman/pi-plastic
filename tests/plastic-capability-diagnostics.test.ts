import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Native patch generation has no external backend or startup capability probe.
for (const path of ["../src/pi/register.ts", "../src/plastic-core.ts", "../index.ts"]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(source, /notifyPatchCapabilityWarning|getPatchBackendCapabilityWarning|capability-diagnostics/);
}
assert.equal(existsSync(new URL("../src/pi/capability-diagnostics.ts", import.meta.url)), false);
const support = readFileSync(new URL("../src/operations/patch-support.ts", import.meta.url), "utf8");
assert.doesNotMatch(support, /PI_PLASTIC_PATCH_EXECUTABLE|probePatchExecutable|resolvePatchToolPath|withPatchBackendContractDiagnostic/);
console.log("PASS: native patch generation has no obsolete backend diagnostics or startup probes");
