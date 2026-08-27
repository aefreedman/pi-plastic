import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __plasticCapabilityDiagnosticInternals } from "../index.ts";

async function main(): Promise<void> {
  let checks = 0;
  const notifications: Array<{ message: string; level: string }> = [];
  const notify = __plasticCapabilityDiagnosticInternals.createPatchCapabilityWarningNotifier(async () => {
    checks += 1;
    return "Pi Plastic capability warning: configured patch backend unavailable.";
  });

  await notify({ hasUI: false, ui: { notify(message, level) { notifications.push({ message, level }); } } });
  assert.equal(checks, 0, "Headless sessions must not run or emit UI diagnostics.");
  assert.equal(notifications.length, 0, "Headless sessions must not receive a notification.");

  await notify({ hasUI: true, ui: { notify(message, level) { notifications.push({ message, level }); } } });
  await notify({ hasUI: true, ui: { notify(message, level) { notifications.push({ message, level }); } } });
  assert.equal(checks, 1, "A package runtime must check and warn at most once.");
  assert.deepEqual(notifications, [{ message: "Pi Plastic capability warning: configured patch backend unavailable.", level: "warning" }]);

  const indexText = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(indexText, /pi\.on\("session_start", async/, "Capability diagnostics must be evaluated at session startup.");
  assert.match(indexText, /await notifyPatchCapabilityWarning\(ctx as CapabilityDiagnosticContext\)/, "Session startup must use the UI-only capability notifier.");

  console.log("PASS: plastic capability diagnostic tests succeeded");
}

void main();
