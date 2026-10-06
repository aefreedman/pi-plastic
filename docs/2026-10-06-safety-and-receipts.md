# Safety and receipts

[Documentation index](README.md) · [Tool-specific contracts](README.md#look-up-a-tool)

**The tool reports observed facts and unknowns; the agent chooses the next authorized action.** A receipt is not a transaction, automatic resolution, or proof that every requested effect occurred.

## What success means

| Evidence | What it supports | What it does not establish by itself |
|---|---|---|
| Complete command exit 0 | Command completion, if that tool admits the capture | Changed files, clean workspace, deletion, preservation, or requested review state |
| Admitted emitted ID | The exact creation identity emitted by that command | Requested/emitted server alias equivalence, target-head exclusivity, or unrelated repository effects |
| Complete scoped read | Facts in that source/query scope | Repository totals, unselected records, global absence, or an atomic snapshot |
| Separate resulting-byte/state observation | The inspected post-state at that time | Automatic rollback or a guarantee about concurrent activity |
| Timeout/abort/retirement | The observed lifecycle/capture uncertainty | That the process stopped, no effect occurred, or replay is safe |

Some tools can observe more than command completion—for example admitted checkin changesets or patch bytes. Others deliberately keep requested effects null/unverified. Read the relevant tool reference instead of applying one success rule to all operations.

## Read a native result

All core tools declare an output schema. Registered results use producer-owned `structuredContent`, independently of text/JSON presentation. Codemode consumers receive that DTO when the host preserves it.

| Field or concept | How to use it |
|---|---|
| `schemaVersion`, `action` | Select the declared tool/schema route; versions and shapes differ by tool |
| `ok` and native `isError` | Distinguish admitted results from failures; also handle host-native rejection |
| `provenance` | Plastic external content, produced by this package—not trusted instructions |
| `completeness` | Inspect read, capture, and projection independently where declared |
| `scope`, limits, counts | Keep query scope and omitted/unattempted evidence visible |
| Attempt/stage/effect fields | Preserve earlier completed or possible effects after later failures |
| Requested versus observed identity | Never substitute caller intent for observed/resolved identity |

Not every schema has every field. A successful **partial read** can still have `ok:true`; that is not a complete clean workspace. Native/custom table routes can have null rows/counts and unknown completeness rather than parsed facts.

Mutation/diff receipts generally use empty `details`; some read adapters retain legacy presentation in `details.rawResult`. Don't use that presentation as a substitute for declared canonical fields.

```js
const dto = await tools.plastic_status({source: "xml", maxItems: 20});
if (!dto.ok) {
  text(dto.error);
} else {
  text({
    completeness: dto.completeness,
    itemCount: dto.data.itemCount,
    changedPaths: dto.data.items.filter(item => item.kind === "changed").map(item => item.path)
  });
}
```

The example emits observed paths plus completeness; it does not certify workspace cleanliness. See [status](2026-10-06-status.md) for source restrictions.

## Mutation authorization and preflight

Direct tool calls do not require package-owned approval tokens or UI confirmation. The agent must have user authorization, inspect exact targets, and respect command/path/workspace guards.

Preflight is **not routine confirmation** and does not mean the same thing everywhere:

| Operation | Preflight behavior |
|---|---|
| Branch/object deletion, object writes, workspace merge/finalization, server merge | Command-only plan; zero CLI, no existence/conflict/permission proof |
| Patch | Command-only plan; may read local selector metadata; no staging, backend probe, or generation |
| Checkin | Reads pending scope once; no mutation |
| Switch | Two sequential local reads; not server switchability/conflict proof |
| Closeout | Read-only discovery/pending preview; not zero CLI or applying-readiness proof |
| Add, undo, update, branchCreate | No added preflight API; use the declared tool schema |

Shelveset `preview=true` is different: it actually dispatches CM and can prompt/fail on conflicts. Read [shelveset application](2026-10-06-shelvesets-and-reviews.md#shelvesetapply).

## Respond to failure without inventing recovery

1. Stop dependent actions on failed/unknown evidence. A failed checkin/readiness step must not become successful closeout.
2. Retain earlier IDs, publication, completed commands, and possible effects recorded in the receipt.
3. Inspect the exact affected scope when further investigation is authorized.
4. Choose an explicit resolution or ask the user when ownership, permissions, interaction, or intent is unclear.

Single-command producers do not silently retry, switch backends/strategies, or compensate. Compound operations can have multiple declared steps. Checkin and switch retain narrowly admitted existing recovery paths; those exceptions are documented in [workspace operations](2026-10-06-workspace-operations.md), not general retry permission.

Parent/agent restoration is a separate action with its own scope and evidence. It is not producer rollback. Do not interpret null effects, empty stdout, or a no-op classification as globally verified absence.

## Guards and limits of protection

- The loaded Bash guards block raw GUI `cm diff` / `cm differences` and unsafe interactive `cm merge --merge` use.
- Guards exist only in Pi processes that load the package. Prefer user-scope installation for children running elsewhere.
- Preserve selector spelling and qualifiers. Different server names are not automatically interchangeable.
- Operation-specific containment checks do not turn all directory/wildcard operands into exclusively contained mutations.
- `cm cat --file=<path>` writes and can overwrite that destination. Never treat it as a read-only selector or point an inspection export at canonical workspace files.
- A bounded collector may retire while a child/server action can still be running. Per-command deadlines are not atomic compound deadlines.

## Evidence and transport limits

Source acceptance is deliberately tool/client-specific. Windows CM 11 fixtures are not universal cross-platform, Xlink, Unicode, head, source-link, alias, exclusivity, or rollback proof. Unsupported source profiles stop conservatively; the agent may investigate rather than forcing admission.

Real SDK-host tests use a deterministic local provider and synthetic CLI. They validate consumers/serialization, not actual backend effects. Ordinary transcript messages do not automatically persist the full DTO. Foreign result hooks can remove/replace structured output, causing text fallback; this package does not restore it or enforce bounds after foreign hooks. General RPC fidelity is not claimed.

See [development](2026-10-06-development.md) for testing and [the tool index](README.md#look-up-a-tool) for each source/capture contract.
