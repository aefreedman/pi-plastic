import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packagePath = fileURLToPath(new URL("../", import.meta.url));
const workspacePath = dirname(packagePath);
const registryKey = "@aefree/pi-file-discovery/filters/v1";

type Handler = (_event: unknown, context: any) => Promise<void> | void;
type FakePi = ReturnType<typeof fakePi>;
function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, unknown>();
  return {
    handlers,
    on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    registerTool(tool: { name: string }) { tools.set(tool.name, tool); },
    getActiveTools() { return [...tools.keys()]; },
  };
}
async function emit(pi: FakePi, event: "session_start" | "session_shutdown", context: any): Promise<void> {
  for (const handler of pi.handlers.get(event) ?? []) await handler({}, context);
}
function clearRegistry(): void { delete (globalThis as Record<symbol, unknown>)[Symbol.for(registryKey)]; }
function linkType(): "junction" | "dir" { return process.platform === "win32" ? "junction" : "dir"; }

/** The isolated Plastic package deliberately has no sibling optional package dependency. */
async function isolatedPlasticCopy(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pi-plastic-file-discovery-${name}-`));
  for (const entry of ["extensions", "src", "package.json"]) await cp(join(packagePath, entry), join(root, entry), { recursive: true });
  return root;
}
/** A neutral local file-discovery copy owns the real contract and registry dependency. */
async function isolatedFileDiscoveryCopy(name: string): Promise<string> {
  const source = join(workspacePath, "pi-file-discovery");
  const root = await mkdtemp(join(tmpdir(), `pi-file-discovery-${name}-`));
  for (const entry of ["src", "package.json"]) await cp(join(source, entry), join(root, entry), { recursive: true });
  await mkdir(join(root, "node_modules", "@aefree"), { recursive: true });
  await symlink(join(source, "node_modules", "@aefree", "pi-capability-registry"), join(root, "node_modules", "@aefree", "pi-capability-registry"), linkType());
  return root;
}
async function loadPlastic(root: string): Promise<(pi: any) => void> {
  return (await import(`${pathToFileURL(join(root, "extensions/file-discovery-filter.ts")).href}?${encodeURIComponent(root)}`)).default;
}
async function resolveFilters(root: string, scope: object): Promise<{ outcome: string; records?: readonly any[] }> {
  const contract = await import(`${pathToFileURL(join(root, "src/contracts/v1/index.ts")).href}?${encodeURIComponent(root)}`);
  return contract.resolveFileDiscoveryFiltersV1(scope);
}

{
  clearRegistry();
  const root = await isolatedPlasticCopy("optional");
  try {
    const pi = fakePi();
    (await loadPlastic(root))(pi as any);
    await emit(pi, "session_start", { sessionManager: {} });
    assert.equal((globalThis as Record<symbol, unknown>)[Symbol.for(registryKey)], undefined, "Plastic must not create an optional registry when file discovery is not loaded.");
  } finally {
    await rm(root, { recursive: true, force: true });
    clearRegistry();
  }
}

for (const order of ["plastic-first", "file-discovery-first"] as const) {
  clearRegistry();
  const plasticRoot = await isolatedPlasticCopy(order);
  const fileDiscoveryRoot = await isolatedFileDiscoveryCopy(order);
  try {
    const pi = fakePi();
    pi.registerTool({ name: "discover_candidate_files" });
    const registerPlastic = await loadPlastic(plasticRoot);
    const scope = {};
    const context = { cwd: dirname(plasticRoot), sessionManager: scope };

    if (order === "plastic-first") {
      registerPlastic(pi as any);
      await emit(pi, "session_start", context);
    } else {
      assert.equal((await resolveFilters(fileDiscoveryRoot, scope)).outcome, "missing");
      registerPlastic(pi as any);
      await emit(pi, "session_start", context);
    }

    const active = await resolveFilters(fileDiscoveryRoot, scope);
    assert.equal(active.outcome, "available", `${order} must compose separate local package roots.`);
    assert.equal(active.records?.[0]?.owner.packageRoot, plasticRoot, "Plastic must retain the isolated physical owner root.");

    // A second extension instance replaces the same owner record. Its predecessor's
    // delayed shutdown holds a stale token and must not unregister the replacement.
    registerPlastic(pi as any);
    const starts = pi.handlers.get("session_start")!;
    const shutdowns = pi.handlers.get("session_shutdown")!;
    await starts.at(-1)!({}, context);
    await shutdowns[0]!({}, context);
    assert.equal((await resolveFilters(fileDiscoveryRoot, scope)).outcome, "available", `${order} stale shutdown must not remove a replacement registration.`);
    await shutdowns.at(-1)!({}, context);
    assert.equal((await resolveFilters(fileDiscoveryRoot, scope)).outcome, "missing", `${order} current shutdown must remove the session-scoped registration.`);
  } finally {
    await rm(plasticRoot, { recursive: true, force: true });
    await rm(fileDiscoveryRoot, { recursive: true, force: true });
    clearRegistry();
  }
}

console.log("PASS: Plastic optional file-discovery registry rendezvous composes in both local load orders");
