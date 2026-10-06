# Tools and loading

[Documentation index](README.md) · [Tool-by-tool routing](README.md#look-up-a-tool)

Pi Plastic registers **27 core tools** with output schemas, plus `plastic_tool_search`. The loader describes/activates capabilities and intentionally has no core receipt schema.

## Capability loader

When a tool is inactive, use the smallest sufficient capability search:

```text
plastic_tool_search(query="review pending changes")
plastic_tool_search(toolNames=["plastic_patch"])
```

Matches are bounded, include workflow/safety guidance, and enable selected tools for the **next model request**. Activation is additive: it does not remove built-ins or other extensions' tools.

| Controls | Meaning |
|---|---|
| `query` | Capability/workflow text |
| `toolNames` | Up to four exact public tool names |
| `limit` | 1–4 matches; default is the single best capability match |

Use exact names only when you actually need those tools. Browsing the catalog does not require enabling everything. The [index](README.md#look-up-a-tool) maps every registered tool to its semantic reference.

`plastic_workspaceCreate` is not registered or discoverable: the package does not yet provide the paired safe workspace-cleanup capability. It is not an alternative to the read-only `plastic_workspaceList` tool.

## Loading modes

Set `PI_PLASTIC_TOOL_LOADING_MODE` before starting Pi:

| Mode | Initial package tools | Use |
|---|---|---|
| `balanced` | Loader, `plastic_status`, `plastic_currentBranch` | Default; inspect first and activate task capabilities as needed |
| `loader-only` | Loader | Maximum initial schema reduction |
| `all-active` | All 27 core tools; loader omitted from the active set | Controlled comparison or intentional full exposure |

Inactive tools remain registered. Prior loader additions on the active session branch are restored on startup, resume, fork, and reload.

## Ownership and fallback

Pi's canonical `sourceInfo` identifies this package's effective tools before activation, deferral, or restoration.

If ownership of the tools/loader cannot be established:

- Preserve the existing active set exactly.
- Do not defer, remove, or activate a same-named tool that could belong to another extension.
- An effective package loader may report known tools already active, but cannot activate unowned inactive names.

On a sourceInfo-capable host, providers without native deferred definitions still receive the current active set after a loader call. This is not a claim that every provider or RPC transport preserves every receipt.

## Tool families

| Family | Purpose |
|---|---|
| Status and discovery | Observe pending paths, branch paths/existence, workspace records, shelf IDs, review IDs |
| Workspace operations | Add/undo/update/check in, create/delete/switch branches, request delete/change removal |
| Merging | Workspace merge/finalization, server merge, staged branch closeout |
| Diffs and patches | Compare explicitly scoped content or generate a review artifact—not patch application |
| Shelvesets and reviews | Create/apply/delete shelvesets; create/update/delete code reviews |

Use status to list changed paths. Use diff when content evidence is needed, not as routine ceremony. Use preflight only when scope is broad/ambiguous, a compound operation needs inspection, or the user asks for it; its meaning varies by tool.

Read [safety and receipts](2026-10-06-safety-and-receipts.md) before chaining mutations. [Workflow skill references](../skills/using-plastic/SKILL.md) supply task-specific guidance; loading a tool is not authorization to mutate.
