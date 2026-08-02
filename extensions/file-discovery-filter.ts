import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPlasticFileDiscoveryFilterV1, loadPlasticOwnerV1 } from "../src/file-discovery-filter.ts";
import {
  createPlasticFileDiscoveryFilterRegistryV1,
  type PlasticFileDiscoveryRegistrationToken,
} from "../src/file-discovery-filter-rendezvous.ts";

type ScopeRegistration = Readonly<{ token: PlasticFileDiscoveryRegistrationToken }>;
type ScopeLifecycle = { generation: number; active: boolean };

function hasFileDiscoveryTool(pi: Pick<ExtensionAPI, "getActiveTools">): boolean {
  return pi.getActiveTools?.().includes("discover_candidate_files") ?? false;
}

/**
 * Session-scoped optional Plastic file-discovery filter registration.
 *
 * Independently loaded packages rendezvous through the published global
 * capability-registry protocol. No import is attempted from Plastic's module
 * root, so an absent file-discovery package leaves Plastic unchanged.
 */
export function createPlasticFileDiscoveryFilterExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    const registrations = new WeakMap<object, ScopeRegistration>();
    const lifecycles = new WeakMap<object, ScopeLifecycle>();

    pi.on("session_start", async (_event, ctx) => {
      if (!hasFileDiscoveryTool(pi)) return;
      const scope = ctx.sessionManager;
      const previous = lifecycles.get(scope);
      const lifecycle = { generation: (previous?.generation ?? 0) + 1, active: true };
      lifecycles.set(scope, lifecycle);

      const owner = await loadPlasticOwnerV1(import.meta.url);
      // Do not revive a scope whose shutdown occurred while owner discovery was pending.
      if (lifecycles.get(scope) !== lifecycle || !lifecycle.active) return;
      const registry = createPlasticFileDiscoveryFilterRegistryV1();
      const token = registry.register(scope, createPlasticFileDiscoveryFilterV1(owner));
      // Registration succeeds before the prior token is retired, preserving a valid
      // record if construction or validation fails. Nonces make stale retirement safe.
      const current = registrations.get(scope);
      if (lifecycles.get(scope) !== lifecycle || !lifecycle.active) {
        registry.unregister(token);
        return;
      }
      registrations.set(scope, Object.freeze({ token }));
      if (current !== undefined) registry.unregister(current.token);
    });
    pi.on("session_shutdown", (_event, ctx) => {
      const scope = ctx.sessionManager;
      const lifecycle = lifecycles.get(scope);
      if (lifecycle !== undefined) {
        lifecycle.active = false;
        lifecycle.generation += 1;
      }
      const current = registrations.get(scope);
      if (current === undefined) return;
      createPlasticFileDiscoveryFilterRegistryV1().unregister(current.token);
      // A stale shutdown must not erase a replacement registration.
      if (registrations.get(scope) === current) registrations.delete(scope);
    });
  };
}

export default function registerPlasticFileDiscoveryFilters(pi: ExtensionAPI): void {
  createPlasticFileDiscoveryFilterExtension()(pi);
}
