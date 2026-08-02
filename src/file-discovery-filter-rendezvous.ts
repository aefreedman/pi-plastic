/**
 * Narrow local adapter for the published capability-registry global protocol.
 *
 * Pi loads independently installed packages from separate module roots. Plastic
 * therefore registers its optional file-discovery filter through the stable
 * global capability key instead of importing a sibling package contract.
 */
const ROOT_PROTOCOL = "@aefree/pi-capability-registry/root";
const ROOT_PROTOCOL_VERSION = 1;
export const PLASTIC_FILE_DISCOVERY_FILTER_REGISTRY_KEY_V1 = "@aefree/pi-file-discovery/filters/v1" as const;

type FilterOwner = Readonly<{ packageName: string; packageRoot: string }>;
type FilterRecord = Readonly<{ contractVersion: 1; id: string; kind: "file-discovery-filter"; owner: FilterOwner; evaluate: (...args: never[]) => unknown }>;
export type PlasticFileDiscoveryRegistrationToken = Readonly<{ registryKey: string; contractVersion: 1; scope: object; ownerKey: string; id: string; nonce: number }>;
type StoredRecord = Readonly<{ nonce: number; record: FilterRecord }>;
type ScopedState = { sequence: number; records: Map<string, StoredRecord> };
type VersionState = { version: 1; scopes: WeakMap<object, ScopedState> };
type RegistryRoot = { protocol: string; protocolVersion: number; registryKey: string; versions: Map<unknown, unknown> };

export type PlasticFileDiscoveryFilterRegistryV1 = Readonly<{
  register(scope: object, filter: FilterRecord): PlasticFileDiscoveryRegistrationToken;
  unregister(token: PlasticFileDiscoveryRegistrationToken | undefined): boolean;
}>;

/** Create Plastic's view of the shared file-discovery v1 capability registry. */
export function createPlasticFileDiscoveryFilterRegistryV1(): PlasticFileDiscoveryFilterRegistryV1 {
  const registryKey = PLASTIC_FILE_DISCOVERY_FILTER_REGISTRY_KEY_V1;
  const globalRecord = globalThis as typeof globalThis & Record<symbol, unknown>;
  const symbol = Symbol.for(registryKey);
  let candidate = globalRecord[symbol];
  if (candidate === undefined) {
    candidate = { protocol: ROOT_PROTOCOL, protocolVersion: ROOT_PROTOCOL_VERSION, registryKey, versions: new Map() } satisfies RegistryRoot;
    globalRecord[symbol] = candidate;
  }
  const root = assertRoot(candidate, registryKey);
  let versionCandidate = root.versions.get(1);
  if (versionCandidate === undefined) {
    versionCandidate = { version: 1, scopes: new WeakMap<object, ScopedState>() } satisfies VersionState;
    root.versions.set(1, versionCandidate);
  }
  const version = assertVersionState(versionCandidate, registryKey);

  return Object.freeze({
    register(scope, filter) {
      assertScope(scope);
      assertFilter(filter);
      let scoped = version.scopes.get(scope);
      if (scoped === undefined) {
        scoped = { sequence: 0, records: new Map() };
        version.scopes.set(scope, scoped);
      } else {
        assertScopedState(scoped, registryKey);
      }
      const ownerKey = `${filter.owner.packageName}\0${filter.owner.packageRoot}\0${filter.id}`;
      for (const current of scoped.records.values()) {
        if (current.record.id === filter.id && ownerKeyFor(current.record) !== ownerKey) {
          throw new TypeError(`Provider id '${filter.id}' conflicts in file-discovery registry '${registryKey}'.`);
        }
      }
      const nonce = scoped.sequence + 1;
      scoped.records.set(ownerKey, Object.freeze({ nonce, record: filter }));
      scoped.sequence = nonce;
      return Object.freeze({ registryKey, contractVersion: 1, scope, ownerKey, id: filter.id, nonce });
    },
    unregister(token) {
      if (!token || token.registryKey !== registryKey || token.contractVersion !== 1) return false;
      const scoped = version.scopes.get(token.scope);
      if (scoped === undefined) return false;
      assertScopedState(scoped, registryKey);
      const current = scoped.records.get(token.ownerKey);
      if (current === undefined || current.nonce !== token.nonce || current.record.id !== token.id) return false;
      scoped.records.delete(token.ownerKey);
      return true;
    },
  });
}

function assertRoot(value: unknown, registryKey: string): RegistryRoot {
  if (value === null || typeof value !== "object") throw incompatible(registryKey);
  const root = value as Partial<RegistryRoot>;
  if (root.protocol !== ROOT_PROTOCOL || root.protocolVersion !== ROOT_PROTOCOL_VERSION || root.registryKey !== registryKey || !(root.versions instanceof Map)) throw incompatible(registryKey);
  return root as RegistryRoot;
}
function assertVersionState(value: unknown, registryKey: string): VersionState {
  if (value === null || typeof value !== "object") throw incompatible(registryKey);
  const state = value as Partial<VersionState>;
  if (state.version !== 1 || !(state.scopes instanceof WeakMap)) throw incompatible(registryKey);
  return state as VersionState;
}
function assertScopedState(value: unknown, registryKey: string): asserts value is ScopedState {
  if (value === null || typeof value !== "object") throw incompatible(registryKey);
  const state = value as Partial<ScopedState>;
  if (!Number.isSafeInteger(state.sequence) || (state.sequence ?? -1) < 0 || !(state.records instanceof Map)) throw incompatible(registryKey);
}
function assertScope(scope: unknown): asserts scope is object {
  if ((typeof scope !== "object" && typeof scope !== "function") || scope === null) throw new TypeError("File-discovery registration requires a session scope object.");
}
function assertFilter(value: unknown): asserts value is FilterRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Plastic attempted an invalid file-discovery filter registration.");
  const filter = value as Partial<FilterRecord>;
  if (filter.contractVersion !== 1 || filter.kind !== "file-discovery-filter" || typeof filter.id !== "string" || !filter.id || typeof filter.evaluate !== "function" || filter.owner === null || typeof filter.owner !== "object" || typeof filter.owner.packageName !== "string" || !filter.owner.packageName || typeof filter.owner.packageRoot !== "string" || !filter.owner.packageRoot) throw new TypeError("Plastic attempted an invalid file-discovery filter registration.");
}
function ownerKeyFor(record: FilterRecord): string { return `${record.owner.packageName}\0${record.owner.packageRoot}\0${record.id}`; }
function incompatible(registryKey: string): TypeError { return new TypeError(`@aefree/pi-file-discovery advertises an incompatible capability-registry contract for '${registryKey}'.`); }
