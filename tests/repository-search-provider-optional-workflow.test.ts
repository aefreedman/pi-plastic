import assert from "node:assert/strict";
import { createRepositoryPolicyRegistryV1 } from "@aefree/pi-repo-search/contracts/v1";
import { createWorkflowProviderRegistryV1 } from "@aefree/pi-workflow/contracts/v1";
import {
  createPlasticRepositoryProviderExtension,
  isMissingWorkflowProviderContract,
  loadWorkflowProviderRegistryV1,
} from "../extensions/repository-search-provider.ts";

type Handler = (_event: unknown, ctx: { sessionManager: object }) => Promise<void> | void;

function createHarness(loadWorkflowRegistry?: () => Promise<any>) {
  const handlers = new Map<string, Handler[]>();
  const pi = { on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); } };
  createPlasticRepositoryProviderExtension(loadWorkflowRegistry)(pi as any);
  const emit = async (event: "session_start" | "session_shutdown", scope: object): Promise<void> => {
    for (const handler of handlers.get(event) ?? []) await handler({}, { sessionManager: scope });
  };
  return { emit };
}

assert.equal(isMissingWorkflowProviderContract({
  code: "ERR_MODULE_NOT_FOUND",
  message: "Cannot find package '@aefree/pi-workflow' imported from C:\\package\\extensions\\repository-search-provider.ts",
}), true);
assert.equal(isMissingWorkflowProviderContract({
  code: "MODULE_NOT_FOUND",
  message: "Cannot find module '@aefree/pi-workflow/contracts/v1'\nRequire stack:\n- C:\\package\\extensions\\repository-search-provider.ts",
}), true);
assert.equal(isMissingWorkflowProviderContract({
  code: "MODULE_NOT_FOUND",
  message: "Cannot find module './missing-internal'\nRequire stack:\n- C:\\node_modules\\@aefree\\pi-workflow\\contracts\\v1.js",
}), false);

const missingContract = Object.assign(new Error("Cannot find package '@aefree/pi-workflow' imported from fixture"), { code: "ERR_MODULE_NOT_FOUND" });
assert.equal(await loadWorkflowProviderRegistryV1(async () => { throw missingContract; }), undefined, "only an absent workflow contract is optional");
const brokenContract = new Error("workflow contract initialization failed");
await assert.rejects(loadWorkflowProviderRegistryV1(async () => { throw brokenContract; }), brokenContract, "installed-but-broken workflow imports must surface");
await assert.rejects(loadWorkflowProviderRegistryV1(async () => ({})), /does not export/, "incompatible workflow contracts must surface");

const absentScope = {};
const absent = createHarness(async () => undefined);
await absent.emit("session_start", absentScope);
assert.deepEqual(createRepositoryPolicyRegistryV1().snapshotCompatible(absentScope).map((item) => item.id), ["plastic.ignore-files"], "workflow absence keeps repository-search policy");
assert.equal(createWorkflowProviderRegistryV1().snapshotCompatible(absentScope).length, 0, "workflow absence skips only vcs.plastic");
await absent.emit("session_shutdown", absentScope);
assert.equal(createRepositoryPolicyRegistryV1().snapshotCompatible(absentScope).length, 0);

const brokenScope = {};
const broken = createHarness(async () => { throw brokenContract; });
await assert.rejects(broken.emit("session_start", brokenScope), brokenContract);
assert.equal(createRepositoryPolicyRegistryV1().snapshotCompatible(brokenScope).length, 0, "broken imports do not leave partial policy registrations");

const present = createHarness();
const scopeA = {};
const scopeB = {};
await present.emit("session_start", scopeA);
assert.deepEqual(createWorkflowProviderRegistryV1().snapshotCompatible(scopeA).map((item) => item.id), ["vcs.plastic"]);
await present.emit("session_start", scopeB);
assert.deepEqual(createWorkflowProviderRegistryV1().snapshotCompatible(scopeB).map((item) => item.id), ["vcs.plastic"]);
await present.emit("session_shutdown", scopeA);
assert.equal(createRepositoryPolicyRegistryV1().snapshotCompatible(scopeA).length, 0);
assert.equal(createWorkflowProviderRegistryV1().snapshotCompatible(scopeA).length, 0);
assert.deepEqual(createRepositoryPolicyRegistryV1().snapshotCompatible(scopeB).map((item) => item.id), ["plastic.ignore-files"], "shutdown A must not remove B policy");
assert.deepEqual(createWorkflowProviderRegistryV1().snapshotCompatible(scopeB).map((item) => item.id), ["vcs.plastic"], "shutdown A must not remove B workflow provider");
await present.emit("session_start", scopeB);
assert.equal(createRepositoryPolicyRegistryV1().snapshotCompatible(scopeB).length, 1, "reload replaces rather than duplicates the policy");
assert.equal(createWorkflowProviderRegistryV1().snapshotCompatible(scopeB).length, 1, "reload replaces rather than duplicates vcs.plastic");
await present.emit("session_shutdown", scopeB);
assert.equal(createRepositoryPolicyRegistryV1().snapshotCompatible(scopeB).length, 0);
assert.equal(createWorkflowProviderRegistryV1().snapshotCompatible(scopeB).length, 0);

console.log("PASS: Plastic workflow provider composition is optional and scope-safe");
