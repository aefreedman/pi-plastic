import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRepositoryPolicyRegistryV1 } from "@aefree/pi-repo-search/contracts/v1";
import { registerPlasticLegacyReferencesV1 } from "../src/legacy-reference-provider.ts";
import { createPlasticRepositorySearchPolicyV1, createPlasticWorkflowProviderV1, loadPlasticOwnerV1 } from "../src/repository-search-provider.ts";

const WORKFLOW_PROVIDER_CONTRACT_MODULE = "@aefree/pi-workflow/contracts/v1";

type WorkflowRegistryV1 = Readonly<{
  register(scope: object, provider: unknown): unknown;
  unregister(token: unknown): boolean;
}>;
type WorkflowRegistryLoader = () => Promise<WorkflowRegistryV1 | undefined>;
type ModuleImporter = (specifier: string) => Promise<unknown>;
type ScopeRegistrations = Readonly<{
  policyToken: ReturnType<ReturnType<typeof createRepositoryPolicyRegistryV1>["register"]>;
  workflowRegistration?: Readonly<{ registry: WorkflowRegistryV1; token: unknown }>;
  referenceRegistration: ReturnType<typeof registerPlasticLegacyReferencesV1>;
}>;

/**
 * Only a resolution error for this exact optional contract is ignorable. Errors
 * raised while evaluating an installed contract must still reach the host.
 */
export function isMissingWorkflowProviderContract(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== "ERR_MODULE_NOT_FOUND" && candidate.code !== "MODULE_NOT_FOUND") return false;
  if (typeof candidate.message !== "string") return false;
  return candidate.message.includes(`'${WORKFLOW_PROVIDER_CONTRACT_MODULE}'`) ||
    candidate.message.includes(`\"${WORKFLOW_PROVIDER_CONTRACT_MODULE}\"`) ||
    candidate.message.includes("Cannot find package '@aefree/pi-workflow'");
}

/** Load the optional provider registry without making this extension import it at module evaluation. */
export async function loadWorkflowProviderRegistryV1(importer: ModuleImporter = (specifier) => import(specifier)): Promise<WorkflowRegistryV1 | undefined> {
  let contracts: { createWorkflowProviderRegistryV1?: unknown };
  try {
    contracts = await importer(WORKFLOW_PROVIDER_CONTRACT_MODULE) as typeof contracts;
  } catch (error) {
    if (isMissingWorkflowProviderContract(error)) return undefined;
    throw error;
  }
  if (typeof contracts.createWorkflowProviderRegistryV1 !== "function") {
    throw new TypeError(`${WORKFLOW_PROVIDER_CONTRACT_MODULE} does not export createWorkflowProviderRegistryV1().`);
  }
  const registry = (contracts.createWorkflowProviderRegistryV1 as () => unknown)();
  if (registry === null || typeof registry !== "object" ||
      typeof (registry as { register?: unknown }).register !== "function" ||
      typeof (registry as { unregister?: unknown }).unregister !== "function") {
    throw new TypeError(`${WORKFLOW_PROVIDER_CONTRACT_MODULE} returned an invalid workflow provider registry.`);
  }
  return registry as WorkflowRegistryV1;
}

/** Session-scoped, side-effect-free policy, optional VCS-provider, and bounded legacy-reference registration. */
export function createPlasticRepositoryProviderExtension(loadWorkflowRegistry: WorkflowRegistryLoader = loadWorkflowProviderRegistryV1): (pi: ExtensionAPI) => void {
  return (pi) => {
    const registrations = new WeakMap<object, ScopeRegistrations>();
    const unregisterScope = (current: ScopeRegistrations | undefined): void => {
      if (current === undefined) return;
      createRepositoryPolicyRegistryV1().unregister(current.policyToken);
      current.workflowRegistration?.registry.unregister(current.workflowRegistration.token);
      current.referenceRegistration.unregister();
    };

    pi.on("session_start", async (_event, ctx) => {
      // Resolve before altering current registrations: a present-but-broken
      // optional package must fail visibly without tearing down a working scope.
      const workflowRegistry = await loadWorkflowRegistry();
      const owner = await loadPlasticOwnerV1(import.meta.url);
      const scope = ctx.sessionManager;
      unregisterScope(registrations.get(scope));
      const policyToken = createRepositoryPolicyRegistryV1().register(scope, createPlasticRepositorySearchPolicyV1(owner));
      const referenceRegistration = registerPlasticLegacyReferencesV1(scope, owner);
      const workflowRegistration = workflowRegistry === undefined
        ? undefined
        : Object.freeze({ registry: workflowRegistry, token: workflowRegistry.register(scope, createPlasticWorkflowProviderV1(owner)) });
      registrations.set(scope, Object.freeze({ policyToken, workflowRegistration, referenceRegistration }));
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
