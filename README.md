# Pi Plastic

Pi tools, footer status, and skill guidance for Plastic SCM / Unity Version Control workflows.

## Plastic branch footer status

When Pi starts inside a Plastic workspace, this package adds a themed `Plastic <branch>` status to Pi's built-in footer. It discovers the nearest enclosing `.plastic/plastic.workspace`, reads the local selector as a fast credential-free fallback, and confirms the branch with a bounded `cm status` call. Selector changes and successful same-workspace `plastic_*` tools refresh the status; sibling workspaces are ignored.

The extension owns only the `plastic-branch` status key. It does not replace Pi's footer or suppress Pi's Git branch display, so Git and Plastic information can appear together in nested workspaces. If the Plastic marker exists but neither the selector nor `cm` yields a branch, the footer shows `Plastic branch unavailable`. Non-Plastic directories show no Plastic status.

## File-discovery filter

When `@aefree/pi-file-discovery` is also loaded, Pi session startup registers the independent advisory `plastic.ignore-files` file-discovery filter through the package-qualified capability-registry rendezvous key. The packages may have separate module roots; Plastic does not import file-discovery from its own root. It discovers readable `ignore.conf` and `cloaked.conf` only from the nearest Plastic workspace to each requested root, then supplies them as ripgrep ignore files without replacing native ripgrep/Git-ignore behavior. A root is emitted only when it has at least one readable ignore/cloak file; each emitted root declares `filterDecision: "applied"`, decision code `plastic_ignore_files_applied`, and that workspace as its `filterBoundary`. No-op Plastic roots are omitted from mixed requests, and a request with no effective ignore/cloak records is `not_applicable`. The integration is optional: without `pi-file-discovery`, all Plastic tools and skills still load and no filter registry is created. Missing, malformed, or unavailable Plastic filter data degrades to generic discovery; `pi-file-discovery` owns that execution hygiene and disclosure behavior. It does not register workflow guidance or perform Plastic CLI readiness checks; owning `plastic_*` tools validate their own workspace and CLI requirements.


## Mutation execution

Directly invoked mutating `plastic_*` tools do not require approval tokens or package-owned UI confirmation. After the tool's existing argument, command, workspace-readiness, exact-target, and path-containment checks pass, each command attempt proceeds to its intended `cm` spawn. The process layer makes one attempt and does not retry implicitly; inspect Plastic status before manually retrying an ambiguous side-effecting failure.

Removing the approval layer does not relax Plastic safety guards. Command allowlists, exact mutation targets, workspace/path containment, non-interactive process selection, blocked `cm diff`, safe merge flags, and operation-specific preflight behavior remain authoritative. Compound tools may intentionally execute multiple validated command steps.

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
- `plastic_workspaceDiff`
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
- `plastic_workspaceList`

## Dynamic tool loading

The package exposes 29 public `plastic_*` tools. `plastic_workspaceCreate` is intentionally not registered or discoverable until the package provides a paired, safe workspace-cleanup capability. `plastic_tool_search` is a package-owned loader that searches the explicit Plastic capability catalog, reports bounded matches and safety guidance, and additively enables selected tools for the next model request.

The default **balanced** session set keeps `plastic_tool_search`, `plastic_status`, and `plastic_currentBranch` active. The other Plastic tools remain registered but inactive until selected; built-in and other-extension tools are not removed. Previous loader additions on the active session branch are restored on startup, resume, fork, and reload.

For controlled comparisons, set `PI_PLASTIC_TOOL_LOADING_MODE` before starting Pi:

```bash
PI_PLASTIC_TOOL_LOADING_MODE=balanced    # default production candidate
PI_PLASTIC_TOOL_LOADING_MODE=loader-only # maximum initial schema reduction
PI_PLASTIC_TOOL_LOADING_MODE=all-active  # all 29 currently exposed tools; loader omitted
```

Pi 0.82 and newer use canonical `sourceInfo` provenance to identify this package's effective tools before deferring, restoring, or activating them. If canonical provenance or ownership of the effective loader cannot be proven, `pi-plastic` fails safe: it preserves the complete current active set exactly, does not defer, remove, or activate any `plastic_*` name, and an effective package loader can only report known tools that are already active rather than activating inactive names. On sourceInfo-capable Pi instances, providers without native deferred definitions still receive the complete current active set after a loader call. Reload or restart Pi after source edits; source files are not watched automatically.

## Safety behavior

- `plastic_branchCreate` supports an explicit parent branch independent of the loaded workspace branch, defaults relative names to the current branch when no parent is supplied, and rejects top-level paths unless `allowRootBranch=true` is explicit.
- `plastic_diff` remains a disabled alias by design; use `plastic_status` for changed-path listing, `plastic_diffFile` for one file, `plastic_workspaceDiff` for pending review, or `plastic_diffRevisions` for an explicit historical pair.
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
pi install git:github.com/aefreedman/pi-plastic@v0.4.0
```

Equivalent SSH install:

```bash
pi install git:git@github.com:aefreedman/pi-plastic@v0.4.0
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
- Pi 0.82.0 or newer; the current development and eval baseline is Pi 0.83
- Plastic SCM / Unity Version Control CLI (`cm`) available on `PATH`, or `PI_PLASTIC_CM_EXECUTABLE` set to its full executable path
- GNU/POSIX-compatible `diff` available on `PATH`, or `PI_PLASTIC_DIFF_EXECUTABLE` set to its full executable path (including paths containing spaces), for text-only diff and patch tools. Pi does not discover Git Bash paths automatically.
- A configured Plastic workspace for workspace-scoped operations
- `pi-file-discovery` is an optional independently loaded integration. When its `discover_candidate_files` tool is active, it receives the advisory Plastic ignore/cloak filter through the shared global capability protocol; when absent, `pi-plastic` loads without file-discovery filtering. The tarball does not embed linked sibling workspaces or `node_modules` paths.

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

The package-local behavioral eval uses fresh Pi 0.83 JSON subprocesses against an explicitly attested dedicated Plastic sandbox and is not a skill eval. It compares all-active, balanced, and loader-only mode behavior, checks exact smallest-sufficient loader activations, blocks destructive calls unless they are supported `preflight: true` previews, captures tool calls and sanitized provider-schema measurements, and deletes raw provider payload captures by default.

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
