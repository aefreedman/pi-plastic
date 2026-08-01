import assert from "node:assert/strict";
import { createPlasticRepositoryProviderExtension, isMissingRepoSearchRuntime } from "../extensions/repository-search-provider.ts";

const records = new WeakMap<object, Map<string, { token: { id: string; nonce: string }; policy: { id: string } }>>();
let nonce = 0;
const registry = {
  register(scope: object, policy: { id: string }) {
    const scoped = records.get(scope) ?? new Map();
    if (scoped.has(policy.id)) throw new Error(`duplicate ${policy.id}`);
    const token = { id: policy.id, nonce: String(++nonce) };
    scoped.set(policy.id, { token, policy }); records.set(scope, scoped); return token;
  },
  unregister(token: { id: string; nonce: string }) {
    for (const scoped of [records.get(scope)]) {
      const current = scoped?.get(token.id);
      if (current?.token.nonce === token.nonce) return scoped!.delete(token.id);
    }
    return false;
  },
};
const runtime = { createRepositoryPolicyRegistryV1: () => registry };
const handlers = new Map<string, Array<(_event: unknown, ctx: any) => Promise<void> | void>>();
const pi = { on(event: string, handler: (_event: unknown, ctx: any) => Promise<void> | void) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); } };
createPlasticRepositoryProviderExtension(async () => runtime as any)(pi as any);
const scope = {}; const ctx = { sessionManager: scope };
for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
assert.deepEqual([...records.get(scope)!.keys()], ["plastic.ignore-files"]);
for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
assert.equal(records.get(scope)?.size ?? 0, 0);

const absentHandlers = new Map<string, Array<(_event: unknown, ctx: any) => Promise<void> | void>>();
createPlasticRepositoryProviderExtension(async () => { throw Object.assign(new Error("Cannot find package '@aefree/pi-repo-search'"), { code: "ERR_MODULE_NOT_FOUND" }); })({ on(event: string, handler: any) { absentHandlers.set(event, [...(absentHandlers.get(event) ?? []), handler]); } } as any);
for (const handler of absentHandlers.get("session_start") ?? []) await handler({}, ctx);
assert.equal(records.get(scope)?.size ?? 0, 0, "an absent optional package must leave pi-plastic usable without registration");
assert.equal(isMissingRepoSearchRuntime({ code: "ERR_MODULE_NOT_FOUND", message: "Cannot find package '@aefree/pi-repo-search'" }), true);
assert.equal(isMissingRepoSearchRuntime({ code: "ERR_MODULE_NOT_FOUND", message: "Cannot find package 'nested-defect'" }), false);
console.log("PASS: optional Plastic repository-search policy registration");
