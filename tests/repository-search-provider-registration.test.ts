import assert from "node:assert/strict";
import register from "../extensions/repository-search-provider.ts";
import { createRepositoryPolicyRegistryV1 } from "@aefree/pi-repo-search/contracts/v1";
import { createWorkflowProviderRegistryV1 } from "@aefree/pi-workflow/contracts/v1";

const handlers = new Map<string, Array<(_event: unknown, ctx: any) => Promise<void> | void>>();
const pi = { on(event: string, handler: (_event: unknown, ctx: any) => Promise<void> | void) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); } };
register(pi as any);
const scope = {}; const ctx = { sessionManager: scope };
for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
assert.deepEqual(createRepositoryPolicyRegistryV1().snapshotCompatible(scope).map((item) => item.id), ["plastic.ignore-files"]);
assert.deepEqual(createWorkflowProviderRegistryV1().snapshotCompatible(scope).map((item) => item.id), ["vcs.plastic"]);
// A replacement registration has a fresh nonce; stale cleanup must not erase it.
for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
assert.equal(createRepositoryPolicyRegistryV1().snapshotCompatible(scope).length, 0);
assert.equal(createWorkflowProviderRegistryV1().snapshotCompatible(scope).length, 0);
console.log("PASS: Plastic repository-search and workflow providers register and clean up by session scope");
