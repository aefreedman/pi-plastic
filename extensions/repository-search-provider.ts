import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPlasticRepositorySearchPolicyV1, loadPlasticOwnerV1 } from "../src/repository-search-provider.ts";

const REPO_SEARCH_CONTRACT_RUNTIME = "@aefree/pi-repo-search/contracts/" + "v1";

type PolicyToken = { readonly id: string; readonly nonce: string };
type RepositoryPolicyRegistry = {
  register(scope: object, policy: ReturnType<typeof createPlasticRepositorySearchPolicyV1>): PolicyToken;
  unregister(token: PolicyToken): boolean;
};
type RepoSearchContractRuntime = {
  createRepositoryPolicyRegistryV1?: () => RepositoryPolicyRegistry;
};
type RuntimeLoader = () => Promise<RepoSearchContractRuntime>;
type ScopeRegistrations = Readonly<{ policyToken: PolicyToken; registry: RepositoryPolicyRegistry }>;

/** Accept only failures resolving the optional package itself; installed-package defects remain visible. */
export function isMissingRepoSearchRuntime(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== "ERR_MODULE_NOT_FOUND" && candidate.code !== "MODULE_NOT_FOUND") return false;
  if (typeof candidate.message !== "string") return false;
  return candidate.message.includes("Cannot find package '@aefree/pi-repo-search'") ||
    candidate.message.includes(`'${REPO_SEARCH_CONTRACT_RUNTIME}'`) ||
    candidate.message.includes(`\"${REPO_SEARCH_CONTRACT_RUNTIME}\"`);
}

const loadRepoSearchRuntime: RuntimeLoader = async () => import(REPO_SEARCH_CONTRACT_RUNTIME) as Promise<RepoSearchContractRuntime>;

/** Session-scoped optional Plastic policy registration when pi-repo-search is installed. */
export function createPlasticRepositoryProviderExtension(loadRuntime: RuntimeLoader = loadRepoSearchRuntime): (pi: ExtensionAPI) => void {
  return (pi) => {
    const registrations = new WeakMap<object, ScopeRegistrations>();
    const unregisterScope = (current: ScopeRegistrations | undefined): void => {
      if (current !== undefined) current.registry.unregister(current.policyToken);
    };

    pi.on("session_start", async (_event, ctx) => {
      let runtime: RepoSearchContractRuntime;
      try {
        runtime = await loadRuntime();
      } catch (error) {
        if (isMissingRepoSearchRuntime(error)) return;
        throw error;
      }
      if (typeof runtime.createRepositoryPolicyRegistryV1 !== "function") return;
      const registry = runtime.createRepositoryPolicyRegistryV1();
      const owner = await loadPlasticOwnerV1(import.meta.url);
      const scope = ctx.sessionManager;
      unregisterScope(registrations.get(scope));
      const policyToken = registry.register(scope, createPlasticRepositorySearchPolicyV1(owner));
      registrations.set(scope, Object.freeze({ policyToken, registry }));
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
