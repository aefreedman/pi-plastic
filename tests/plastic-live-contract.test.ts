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
const context = "<WorkspaceStatus><Status><RepSpec><Server>example@unity</Server><Name>Example Repository</Name></RepSpec><Changeset>16</Changeset></Status></WorkspaceStatus><WkConfigType>Branch</WkConfigType><WkConfigName>/main</WkConfigName>";
const status = (inventory = "") => `<StatusOutput>${context}${inventory}</StatusOutput>`;
const change = "<Change><Type>RP</Type><Path>C:\\example\\café.txt</Path></Change>";
assert.deepEqual(nativeXmlPendingPaths(parseLiveXml(status())), []);
assert.deepEqual(nativeXmlPendingPaths(parseLiveXml(status("<Changes />"))), []);
assert.deepEqual(nativeXmlPendingPaths(parseLiveXml(status(`<Changes>${change}</Changes>`))), ["C:\\example\\café.txt"]);
for (const xml of [
  "<OtherOutput />",
  "<StatusOutput />",
  "<StatusOutput><WorkspaceStatus /></StatusOutput>",
  status("<Changes><Unknown /></Changes>"),
  status("<Changes><Change><Type>RP</Type></Change></Changes>"),
  status("<Changes /><Changes />"),
  status(`<FutureChanges>${change}</FutureChanges>`),
  status(`<Unknown><Changes>${change}</Changes></Unknown>`),
  status(`<Changes><Change><Type>RP</Type><Path><FuturePath>C:\\example\\pending.txt</FuturePath></Path></Change></Changes>`),
  status().replace("</WorkspaceStatus>", `<FutureChanges>${change}</FutureChanges></WorkspaceStatus>`),
  status().replace("<WkConfigName>/main</WkConfigName>", `<WkConfigName><Changes>${change}</Changes></WkConfigName>`),
  status().replace("<Changeset>16</Changeset>", "<Changeset>16</Changeset><Changeset>17</Changeset>"),
]) assert.throws(() => nativeXmlPendingPaths(parseLiveXml(xml)));
assert.throws(() => parseLiveXml('<!DOCTYPE StatusOutput [<!ENTITY x "pending">]><StatusOutput />'));
assert.throws(() => parseLiveXml("<StatusOutput>"));
console.log("PASS: live harness mutation attestation, absolute scope and independent pending completeness controls (no CM commands)");
