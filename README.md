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

- Plastic SCM / Unity Version Control CLI (`cm`) available on `PATH`
- A configured Plastic workspace for workspace-scoped operations

## Testing

```bash
npm test
```

The test suite covers tool validation, path-resolution regressions, extension registration, and bash guard behavior. Real smoke validation should be run against a local Plastic workspace before relying on mutation tools in a new environment.

## Implementation notes

- The core implementation lives in `src/plastic-core.ts`.
- `index.ts` is the Pi registration layer.
- Output shapes are intentionally stable for prompt and workflow compatibility.

## License

MIT. See `LICENSE`.
