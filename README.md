# Pi Plastic

Pi tools, footer status, and skill guidance for Plastic SCM / Unity Version Control workflows.

## Plastic branch footer status

When Pi starts inside a Plastic workspace, this package adds a themed `Plastic <branch>` status to Pi's built-in footer. It discovers the nearest enclosing `.plastic/plastic.workspace`, reads the local selector as a fast credential-free fallback, and confirms the branch with a bounded `cm status` call. Selector changes and successful same-workspace `plastic_*` tools refresh the status; sibling workspaces are ignored.

The extension owns only the `plastic-branch` status key. It does not replace Pi's footer or suppress Pi's Git branch display, so Git and Plastic information can appear together in nested workspaces. If the Plastic marker exists but neither the selector nor `cm` yields a branch, the footer shows `Plastic branch unavailable`. Non-Plastic directories show no Plastic status.

## Repository-search and workflow providers

When `@aefree/pi-repo-search` and/or `@aefree/pi-workflow` contracts are installed, Pi session startup registers `plastic.ignore-files` and `vcs.plastic`. The search policy is marker-based and discovers readable `ignore.conf` and `cloaked.conf` only from the nearest Plastic workspace to each requested root. It adds them as ripgrep ignore files without replacing native ripgrep/Git-ignore behavior.

`vcs.plastic` detects ownership from `.plastic/plastic.workspace` alone. It intentionally does not invoke `cm` while detecting. Preflight then re-detects the target, verifies that its canonical workspace still equals the selected root, and runs bounded/cancellable `cm status --machinereadable`. A missing CLI, authentication/readiness failure, timeout, root change, or oversized command output blocks Plastic and must not cause fallback to an enclosing Git workspace. It exposes bounded package-owned guidance resource IDs `repository-search-ignore-policy` and `vcs-workflow` for selected workflow consumers.

The same extension registers bounded legacy-reference services for exactly the four pi-plastic paths in the compatibility map. Reads use byte-exact pinned 0.6.4 legacy payload copies, remain package-contained and capped at 50 KiB/2,000 lines, and return package/version/resource provenance. Owner roots and versions are derived from the physical package copy at session startup rather than hardcoded.

## Mutation authorization

Every mutating `cm` spawn reached through a registered `plastic_*` tool is guarded after command/workdir canonicalization and before process creation. Mutating tools accept optional `authorizationToken` without echoing it in renderers or results. Checkin maps to `commit`; code-review and remote branch/shelveset/workspace metadata writes map to `publish`; workspace update/add/undo/remove/switch/merge/shelveset-apply map to `vcs_mutation`. Exact target IDs use `plastic:<encoded-canonical-workdir>:<operation>:<entity>`.

`workflow_execute` may inspect a token for readiness but never consumes it. Pass that same token to the final Plastic mutation tool, where the command sink consumes it once. One token or direct confirmation permits exactly one mutating `cm` process spawn; authorization is not cached across retries or separate spawns. After an ambiguous side-effecting failure, inspect Plastic status and obtain fresh direct confirmation or a fresh exact-target token before retrying. A noninteractive retry with the consumed token blocks before process creation and reports that remediation. Without a token, TUI/RPC obtains direct `ctx.ui.confirm` bound to the exact action/target and issues/consumes internally; print/JSON blocks. Wrong-session, wrong-action, wrong-target, expired, replayed, and empty-target tokens fail before spawn. Unknown low-level command methods require direct TUI/RPC confirmation instead of token-only classification. Compound `plastic_mergeToBranch` and `plastic_switchBranch(pendingChanges="shelve")` calls cannot safely use one token across differently mapped sinks; preview them, then omit the token in TUI/RPC so each sink is confirmed directly.

This enforcement covers registered `plastic_*` tool process sinks. The package's existing bash guards still block specific unsafe `cm diff` and interactive merge patterns, but this token contract does **not** claim general shell, arbitrary `cm`, Git, or bash-command enforcement.

## Tools

- `plastic_tool_search` (dynamic capability search and loader)
- `plastic_status`
- `plastic_update`
- `plastic_add`
- `plastic_checkin`
- `plastic_undo`
- `plastic_resolveDeleteChangeConflict`
- `plastic_diff`
- `plastic_patch`
- `plastic_diffRevisions`
- `plastic_diffFile`
- `plastic_branchCreate`
- `plastic_switchBranch`
- `plastic_merge`
- `plastic_mergeToBranch`
- `plastic_finalizeMerge`
- `plastic_currentBranch`
- `plastic_branchList`
- `plastic_branchExists`
- `plastic_branchDelete`
- `plastic_shelvesetCreate`
- `plastic_shelvesetApply`
- `plastic_shelvesetDelete`
- `plastic_shelvesetList`
- `plastic_codeReviewCreate`
- `plastic_codeReviewUpdate`
- `plastic_codeReviewDelete`
- `plastic_codeReviewFind`
- `plastic_workspaceCreate`
- `plastic_workspaceList`

## Dynamic tool loading

All 29 existing public `plastic_*` tools retain their names and behavior. `plastic_tool_search` is an additional package-owned loader that searches the explicit Plastic capability catalog, reports bounded matches and safety guidance, and additively enables selected tools for the next model request.

The default **balanced** session set keeps `plastic_tool_search`, `plastic_status`, and `plastic_currentBranch` active. The other Plastic tools remain registered but inactive until selected; built-in and other-extension tools are not removed. Previous loader additions on the active session branch are restored on startup, resume, fork, and reload.

For controlled comparisons, set `PI_PLASTIC_TOOL_LOADING_MODE` before starting Pi:

```bash
PI_PLASTIC_TOOL_LOADING_MODE=balanced    # default production candidate
PI_PLASTIC_TOOL_LOADING_MODE=loader-only # maximum initial schema reduction
PI_PLASTIC_TOOL_LOADING_MODE=all-active  # legacy 29-tool baseline; loader omitted
```

Pi 0.82 uses canonical `sourceInfo` provenance to identify this package's effective tools before deferring, restoring, or activating them. If canonical provenance or ownership of the effective loader cannot be proven, `pi-plastic` fails safe: it preserves the complete current active set exactly, does not defer, remove, or activate any `plastic_*` name, and an effective package loader can only report known tools that are already active rather than activating inactive names. On sourceInfo-capable Pi instances, providers without native deferred definitions still receive the complete current active set after a loader call. Reload or restart Pi after source edits; source files are not watched automatically.

## Safety behavior

- `plastic_branchCreate` supports an explicit parent branch independent of the loaded workspace branch, defaults relative names to the current branch when no parent is supplied, and rejects top-level paths unless `allowRootBranch=true` is explicit.
- `plastic_diff` remains a disabled alias by design; use `plastic_diffFile` or `plastic_diffRevisions` for text-only file diffs.
- `plastic_patch` generates review patches with `cm patch`, including `clean` and `integration` filters for branch review workflows. It does not expose patch apply.
- Bash safety rails block `cm diff` and unsafe interactive `cm merge --merge` usage.
- Merge tooling surfaces Plastic `FILE_CONFLICT` records and merge-state metadata from `cm status`.
- `plastic_mergeToBranch` performs the common safe closeout flow: resolve the source branch's parent as the default target, switch to the target branch, optionally update, merge a source branch non-interactively, verify merge state, and check in the merge result.
- `plastic_finalizeMerge` supports reviewed/manual-resolution flows where Plastic still needs merge metadata finalized before checkin.

## Patch generation examples

```text
plastic_patch(source="<branch-spec>", integration=true)
plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")
plastic_patch(source="<left-spec>", destination="<right-spec>")
plastic_patch(source="<branch-spec>", toolPath="<path-to-diff-tool>")
```

If `output` is omitted, Plastic prints patch content to stdout. If `output` is provided, Plastic writes a new patch file and refuses to overwrite an existing file. Inspect patches before sharing them because they can contain source code, binary content, local paths, or secrets that were present in the changed files.

## Included skill

- `using-plastic` - PlasticSCM branch, workspace, merge, shelveset, checkin, and code-review workflow guidance

## Install

Install the stable GitHub release over HTTPS:

```bash
pi install git:github.com/aefreedman/pi-plastic@v0.3.0
```

Equivalent SSH install:

```bash
pi install git:git@github.com:aefreedman/pi-plastic@v0.3.0
```

To intentionally track the moving default branch instead of a release tag:

```bash
pi install https://github.com/aefreedman/pi-plastic
```

Local development install:

```bash
pi install <path-to-pi-plastic>
```

Project-local install:

```bash
pi install -l <path-to-pi-plastic>
```

## Requirements

- Node.js 22.19.0 or newer
- Pi 0.82.0 or newer; provenance-aware dynamic loading and restoration are validated on Pi 0.82
- Plastic SCM / Unity Version Control CLI (`cm`) available on `PATH`, or `PI_PLASTIC_CM_EXECUTABLE` set to its full executable path
- Git available on `PATH`, or `PI_PLASTIC_GIT_EXECUTABLE` set to its full executable path, for text-only diff tools
- A configured Plastic workspace for workspace-scoped operations
- `@aefree/pi-capability-registry`, `@aefree/pi-repo-search`, and `@aefree/pi-workflow` are normal semver runtime dependencies. The pi-plastic tarball does not embed linked sibling workspaces or `node_modules` paths.

## Testing

```bash
npm test
```

The default suite is credential-free and covers tool validation, path-resolution regressions, extension registration, OpenAI strict-schema compatibility classification, and bash guard behavior.

Run the opt-in read-only live smoke test against a dedicated clean sandbox workspace:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/sandbox npm run test:live
```

The live test requires `/main`, no pending changes, and no merge in progress. It does not mutate the repository. Mutation tools should still be rehearsed manually in a disposable sandbox before relying on them in a new environment.

### Dynamic tool-loading eval

The package-local behavioral eval uses fresh Pi 0.82 JSON subprocesses against an explicitly attested dedicated Plastic sandbox and is not a skill eval. It compares all-active, balanced, and loader-only mode behavior, checks exact smallest-sufficient loader activations, blocks destructive calls unless they are supported `preflight: true` previews, captures tool calls and sanitized provider-schema measurements, and deletes raw provider payload captures by default.

```bash
npm run eval:tool-loading -- --dry-run
PI_PLASTIC_EVAL_SANDBOX=/absolute/path/to/sandbox PI_PLASTIC_EVAL_ALLOW=dedicated-sandbox npm run eval:tool-loading -- --model openai-codex/gpt-5.6-luna --condition balanced
```

See [`evals/tool-loading/README.md`](evals/tool-loading/README.md) for approved model restrictions, cases, measurements, and result hygiene.

## Constrained sampling compatibility

Pi 0.82 introduced provider-side constrained sampling for tools. `pi-plastic` does not currently opt in: every public Plastic schema includes optional fields (at minimum `workdir`), while OpenAI strict function schemas require closed objects and all declared properties to be required. Pi forwards the registered schema without converting those optional fields.

Enabling `strict: "prefer"` now would therefore either produce invalid strict OpenAI requests or require a breaking redesign of the ordinary tool arguments. The test suite audits all registered tools and prevents accidental opt-in until a schema is genuinely strict-compatible. Existing TypeBox validation and Plastic runtime safety checks remain authoritative.

OpenAI Codex models may advertise grammar tools without advertising strict JSON-schema tools. Grammar sampling is not used here because Plastic operations have structured multi-field arguments rather than a single bounded string language.

## Implementation notes

- The core implementation lives in `src/plastic-core.ts`.
- Shared workspace discovery and branch parsing live in `src/plastic-workspace.ts`.
- `extensions/plastic-branch-status.ts` owns the additive footer status and its session-scoped refresh lifecycle.
- `index.ts` is the Pi tool registration layer.
- Output shapes are intentionally stable for prompt and workflow compatibility.

## License

MIT. See `LICENSE`.
