# Pi Plastic

Pi tools and skill guidance for Plastic SCM / Unity Version Control workflows.

## Tools

- `plastic_status`
- `plastic_update`
- `plastic_add`
- `plastic_checkin`
- `plastic_undo`
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

## Safety behavior

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

From GitHub:

```bash
pi install git:git@github.com:aefreedman/pi-plastic.git
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

- Plastic SCM / Unity Version Control CLI (`cm`) available on `PATH`, or `PI_PLASTIC_CM_EXECUTABLE` set to its full executable path
- Git available on `PATH`, or `PI_PLASTIC_GIT_EXECUTABLE` set to its full executable path, for text-only diff tools
- A configured Plastic workspace for workspace-scoped operations

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

## Constrained sampling compatibility

Pi 0.82 introduced provider-side constrained sampling for tools. `pi-plastic` does not currently opt in: every public Plastic schema includes optional fields (at minimum `workdir`), while OpenAI strict function schemas require closed objects and all declared properties to be required. Pi forwards the registered schema without converting those optional fields.

Enabling `strict: "prefer"` now would therefore either produce invalid strict OpenAI requests or require a breaking redesign of the ordinary tool arguments. The test suite audits all registered tools and prevents accidental opt-in until a schema is genuinely strict-compatible. Existing TypeBox validation and Plastic runtime safety checks remain authoritative.

OpenAI Codex models may advertise grammar tools without advertising strict JSON-schema tools. Grammar sampling is not used here because Plastic operations have structured multi-field arguments rather than a single bounded string language.

## Implementation notes

- The core implementation lives in `src/plastic-core.ts`.
- `index.ts` is the Pi registration layer.
- Output shapes are intentionally stable for prompt and workflow compatibility.

## License

MIT. See `LICENSE`.
