import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Eval-only provider payload capture. The runner gives each subprocess a unique
 * temporary file and deletes it unless --keep is requested. Never log payloads:
 * JSON mode stdout must remain a clean Pi event stream.
 */
const CAPTURE_ENV = "PI_PLASTIC_EVAL_PROVIDER_CAPTURE";

export default function providerCapture(pi: ExtensionAPI): void {
  const capturePath = process.env[CAPTURE_ENV];
  if (!capturePath) return;

  pi.on("before_provider_request", (event) => {
    try {
      appendFileSync(capturePath, `${JSON.stringify({ timestamp: Date.now(), payload: event.payload })}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Capture must not make a model trial fail or contaminate stdout.
    }
  });
}
