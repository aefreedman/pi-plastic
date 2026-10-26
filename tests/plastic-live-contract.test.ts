import assert from "node:assert/strict";
import { configuredLiveWorkspace, nativeXmlPendingPaths, parseLiveXml } from "./plastic-live-harness.ts";

// Credential-free controls for the live harness itself: an opt-in test is only
// useful when it cannot accidentally reinterpret an unknown inventory as clean.
const vars = ["PI_PLASTIC_TEST_WORKSPACE", "PI_PLASTIC_ALLOW_MUTATION_TESTS", "PI_PLASTIC_SANDBOX_ATTESTATION"] as const;
const previous = Object.fromEntries(vars.map(name => [name, process.env[name]]));
try {
  for (const name of vars) delete process.env[name];
  assert.equal(configuredLiveWorkspace(), null);
  process.env.PI_PLASTIC_TEST_WORKSPACE = "relative-workspace";
  assert.throws(() => configuredLiveWorkspace(), /absolute/);
  process.env.PI_PLASTIC_TEST_WORKSPACE = process.cwd();
  assert.throws(() => configuredLiveWorkspace(true), /ALLOW_MUTATION_TESTS/);
  process.env.PI_PLASTIC_ALLOW_MUTATION_TESTS = "true";
  assert.throws(() => configuredLiveWorkspace(true), /Attest/);
  process.env.PI_PLASTIC_SANDBOX_ATTESTATION = "production";
  assert.throws(() => configuredLiveWorkspace(true), /Attest/);
  process.env.PI_PLASTIC_SANDBOX_ATTESTATION = "disposable-synthetic-only";
  assert(configuredLiveWorkspace(true));
} finally {
  for (const name of vars) { const value = previous[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
assert.deepEqual(nativeXmlPendingPaths(parseLiveXml("<StatusOutput><WorkspaceStatus /></StatusOutput>")), []);
assert.deepEqual(nativeXmlPendingPaths(parseLiveXml("<StatusOutput><Changes><Change><Type>RP</Type><Path>C:\\example\\café.txt</Path></Change></Changes></StatusOutput>")), ["C:\\example\\café.txt"]);
for (const xml of [
  "<OtherOutput />",
  "<StatusOutput><Changes><Unknown /></Changes></StatusOutput>",
  "<StatusOutput><Changes><Change><Type>RP</Type></Change></Changes></StatusOutput>",
  "<StatusOutput><Changes /><Changes /></StatusOutput>",
]) assert.throws(() => nativeXmlPendingPaths(parseLiveXml(xml)));
assert.throws(() => parseLiveXml("<StatusOutput>"));
console.log("PASS: live harness mutation attestation, absolute scope and independent pending completeness controls (no CM commands)");
