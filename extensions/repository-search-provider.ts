import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRepositoryPolicyRegistryV1 } from "@aefree/pi-repo-search/contracts/v1";
import { createWorkflowProviderRegistryV1 } from "@aefree/pi-workflow/contracts/v1";
import { registerPlasticLegacyReferencesV1 } from "../src/legacy-reference-provider.ts";
import { createPlasticRepositorySearchPolicyV1, createPlasticWorkflowProviderV1, loadPlasticOwnerV1 } from "../src/repository-search-provider.ts";

/** Session-scoped, side-effect-free policy, VCS-provider, and bounded legacy-reference registration. */
export default function registerPlasticRepositoryProviders(pi: ExtensionAPI): void {
  let policyToken: ReturnType<ReturnType<typeof createRepositoryPolicyRegistryV1>["register"]> | undefined;
  let workflowToken: ReturnType<ReturnType<typeof createWorkflowProviderRegistryV1>["register"]> | undefined;
  let referenceRegistration: ReturnType<typeof registerPlasticLegacyReferencesV1> | undefined;
  pi.on("session_start", async (_event, ctx) => {
    referenceRegistration?.unregister();
    const owner = await loadPlasticOwnerV1(import.meta.url);
    policyToken = createRepositoryPolicyRegistryV1().register(ctx.sessionManager, createPlasticRepositorySearchPolicyV1(owner));
    workflowToken = createWorkflowProviderRegistryV1().register(ctx.sessionManager, createPlasticWorkflowProviderV1(owner));
    referenceRegistration = registerPlasticLegacyReferencesV1(ctx.sessionManager, owner);
  });
  pi.on("session_shutdown", () => {
    createRepositoryPolicyRegistryV1().unregister(policyToken);
    createWorkflowProviderRegistryV1().unregister(workflowToken);
    referenceRegistration?.unregister();
    policyToken = undefined; workflowToken = undefined; referenceRegistration = undefined;
  });
}
