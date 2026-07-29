import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRepositoryPolicyRegistryV1 } from "@aefree/pi-repo-search/contracts/v1";
import { createPlasticRepositorySearchPolicyV1, loadPlasticOwnerV1 } from "../src/repository-search-provider.ts";

type ScopeRegistrations = Readonly<{
  policyToken: ReturnType<ReturnType<typeof createRepositoryPolicyRegistryV1>["register"]>;
}>;

/** Session-scoped, side-effect-free Plastic repository-search policy registration. */
export function createPlasticRepositoryProviderExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    const registrations = new WeakMap<object, ScopeRegistrations>();
    const unregisterScope = (current: ScopeRegistrations | undefined): void => {
      if (current !== undefined) createRepositoryPolicyRegistryV1().unregister(current.policyToken);
    };

    pi.on("session_start", async (_event, ctx) => {
      const owner = await loadPlasticOwnerV1(import.meta.url);
      const scope = ctx.sessionManager;
      unregisterScope(registrations.get(scope));
      const policyToken = createRepositoryPolicyRegistryV1().register(scope, createPlasticRepositorySearchPolicyV1(owner));
      registrations.set(scope, Object.freeze({ policyToken }));
    });
    pi.on("session_shutdown", (_event, ctx) => {
      const scope = ctx.sessionManager;
      const current = registrations.get(scope);
      if (current === undefined) return;
      unregisterScope(current);
      registrations.delete(scope);
    });
  };
}

export default function registerPlasticRepositoryProviders(pi: ExtensionAPI): void {
  createPlasticRepositoryProviderExtension()(pi);
}
