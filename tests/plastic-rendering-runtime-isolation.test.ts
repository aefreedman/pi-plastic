import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// A fresh process is essential: an already cached SDK VERSION cannot certify import order.
const fixture = mkdtempSync(join(tmpdir(),"plastic-rendering-root-"));
try {
  const oldRoot = join(fixture,"older-package"); mkdirSync(oldRoot);
  writeFileSync(join(oldRoot,"package.json"),JSON.stringify({name:"@earendil-works/pi-coding-agent",version:"1.0.0",piConfig:{configDir:".pi"}}));
  const sdkUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const script = join(fixture,"probe.mts");
  writeFileSync(script,`import assert from 'node:assert/strict';
const inherited = process.env.PI_PACKAGE_DIR;
await import(${JSON.stringify(new URL("./plastic-tool-rendering.test.ts",import.meta.url).href)});
const config = await import(${JSON.stringify(new URL("./config.js",sdkUrl).href)});
assert.equal(config.VERSION,'1.1.0','SDK must have evaluated only after canonical root pin');
assert.equal(process.env.PI_PACKAGE_DIR,inherited,'Owned override must be restored');
assert.equal(process.env.PI_RENDERING_UNRELATED_SENTINEL,'preserved');
console.log('PASS: fresh stale override imports canonical SDK VERSION1.1.0 and restores owned environment');`);
  const result = spawnSync(process.execPath,[fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs",import.meta.url)),script],{
    encoding:"utf8",timeout:30000,
    env:{...process.env,PI_PACKAGE_DIR:oldRoot,PI_RENDERING_UNRELATED_SENTINEL:"preserved"},
  });
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/fresh stale override imports canonical SDK VERSION1.1.0/);
  console.log(result.stdout.trim());
} finally { rmSync(fixture,{recursive:true,force:true}); }
