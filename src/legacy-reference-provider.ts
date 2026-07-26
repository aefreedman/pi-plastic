import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { createCapabilityRegistry, type RegistrationToken, type RegistryRecord } from "@aefree/pi-capability-registry";
import type { WorkflowOwnerV1 } from "@aefree/pi-workflow/contracts/v1";

export const LEGACY_REFERENCE_SERVICE_REGISTRY_KEY_V1 = "@aefree/pi-game-dev/legacy-reference-services/v1" as const;
export const PLASTIC_LEGACY_REFERENCE_PATHS = Object.freeze([
  "references/cg-changelog/plastic-workflow.md",
  "references/cg-review/plastic-workflow.md",
  "references/cg-vcs-history-analyzer/plastic-backend.md",
  "references/cg-work/plastic-workflow.md",
] as const);
const MAX_RESOURCE_BYTES = 50 * 1024;
const MAX_RESOURCE_LINES = 2_000;

interface LegacyReferenceServiceV1 extends RegistryRecord {
  readonly contractVersion: 1;
  readonly kind: "legacy-reference-service";
  readonly owner: WorkflowOwnerV1;
  readonly legacyPaths: readonly string[];
  read(context: { cwd: string; signal: AbortSignal }, request: { legacyPath: string; offset?: number; limit?: number; signal: AbortSignal }): Promise<Readonly<Record<string, unknown>>>;
}

/** Register exactly the four pi-plastic rows consumed by the legacy compatibility map. */
export function registerPlasticLegacyReferencesV1(scope: object, owner: WorkflowOwnerV1): Readonly<{ token: RegistrationToken; unregister(): boolean }> {
  const registry = createCapabilityRegistry<LegacyReferenceServiceV1>({
    registryKey: LEGACY_REFERENCE_SERVICE_REGISTRY_KEY_V1,
    contractVersion: 1,
    compatibleVersions: [1],
    validate: assertLegacyReferenceService,
  });
  const service: LegacyReferenceServiceV1 = Object.freeze({
    contractVersion: 1,
    id: "legacy-reference.aefree-pi-plastic",
    kind: "legacy-reference-service",
    owner,
    legacyPaths: PLASTIC_LEGACY_REFERENCE_PATHS,
    async read(_context, request) {
      if (request.signal.aborted) throw abortError();
      if (!PLASTIC_LEGACY_REFERENCE_PATHS.includes(request.legacyPath as typeof PLASTIC_LEGACY_REFERENCE_PATHS[number])) throw new Error("legacy_resource_unmapped");
      const offset = request.offset ?? 1;
      const limit = request.limit ?? MAX_RESOURCE_LINES;
      if (!Number.isInteger(offset) || offset < 1 || offset > 100_000) throw new TypeError("offset must be an integer from 1 to 100000");
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESOURCE_LINES) throw new TypeError(`limit must be an integer from 1 to ${MAX_RESOURCE_LINES}`);
      const candidate = path.resolve(owner.packageRoot, "compatibility", "legacy-reference-v1", request.legacyPath);
      const canonical = await realpath(candidate);
      if (!isWithin(owner.packageRoot, canonical)) throw new Error("legacy_resource_outside_package");
      const text = await readBounded(canonical, request.signal);
      const allLines = text.split(/\r?\n/);
      const content = allLines.slice(offset - 1, offset - 1 + limit).join("\n");
      const resourceId = `plastic/${request.legacyPath.slice("references/".length, -3)}`;
      return Object.freeze({
        content,
        legacyPath: request.legacyPath,
        resourceId,
        ...(request.offset === undefined ? {} : { offset: request.offset }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        lines: content.length === 0 ? 0 : content.split(/\r?\n/).length,
        totalLines: allLines.length,
        provenance: Object.freeze({ packageName: owner.packageName, packageVersion: owner.packageVersion, resourceId, contractVersion: 1 as const }),
      });
    },
  });
  const token = registry.register(scope, service);
  let active = true;
  return Object.freeze({ token, unregister() { if (!active) return false; active = false; return registry.unregister(token); } });
}

function assertLegacyReferenceService(value: unknown): asserts value is LegacyReferenceServiceV1 {
  if (value === null || typeof value !== "object") throw new TypeError("legacy reference service must be an object");
  const service = value as Partial<LegacyReferenceServiceV1>;
  if (service.contractVersion !== 1 || service.kind !== "legacy-reference-service" || typeof service.id !== "string") throw new TypeError("invalid legacy reference identity");
  if (service.owner === undefined || typeof service.owner.packageName !== "string" || typeof service.owner.packageRoot !== "string" || typeof service.owner.packageVersion !== "string") throw new TypeError("invalid legacy reference owner");
  if (!Array.isArray(service.legacyPaths) || service.legacyPaths.length !== 4 || new Set(service.legacyPaths).size !== 4 || typeof service.read !== "function") throw new TypeError("invalid legacy reference surface");
}
async function readBounded(filePath: string, signal: AbortSignal): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    if (signal.aborted) throw abortError();
    const buffer = Buffer.alloc(MAX_RESOURCE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_RESOURCE_BYTES) throw new Error("resource_too_large");
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    if (text.split(/\r?\n/).length > MAX_RESOURCE_LINES) throw new Error("resource_too_large");
    return text;
  } finally { await handle.close(); }
}
function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function abortError(): Error { const error = new Error("Legacy reference read cancelled."); error.name = "AbortError"; return error; }
