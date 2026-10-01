import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPlasticTools } from "./src/pi/register";

export { __plasticCapabilityDiagnosticInternals } from "./src/pi/capability-diagnostics";

// Pi provenance belongs to the manifest entry, never the extracted adapter.
const EXTENSION_SOURCE_PATH = fileURLToPath(import.meta.url);

export default function plasticTools(pi: ExtensionAPI) {
  registerPlasticTools(pi, EXTENSION_SOURCE_PATH);
}
