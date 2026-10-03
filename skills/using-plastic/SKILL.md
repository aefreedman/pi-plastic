---
name: using-plastic
description: PlasticSCM operations for Unity workflows - branch management, checkins, workspace isolation, and code reviews.
---
# using-plastic Skill

Purpose: PlasticSCM operations for Unity workflows.

## Critical Rule

Never run `cm diff` in Pi. It may launch GUI windows and block the CLI agent.

`cm cat --file=<path>` writes to that path and can overwrite existing files; `--file` is never an input selector. Never point it at a canonical workspace file during inspection or review, even when piping stdout elsewhere. Use typed diff tools for baseline comparisons. If a typed tool cannot represent a required export, read the [historical export rules](references/changeset-operations.md#historical-export-fallback) first. A changeset number is not a file revision ID; never turn `cs:<number>` into `revid:<number>`.

Never run interactive `cm merge --merge` flows. Use `plastic_merge` (preferred) or explicitly pass `--nointeractiveresolution --mergetype=try` (safe default). Use source/destination policy flags only as explicit overrides.

Treat `plastic_merge` success as provisional until `plastic_status` confirms there are no merge-in-progress hints. Pending merge links are expected until the merge result is checked in; merge-in-progress hints are not. If files are manually resolved and validated but checkin is blocked by Plastic merge metadata, use `plastic_finalizeMerge` with an explicit source/destination policy before retrying checkin.

For the common closeout flow of merging a finished source branch into its parent branch, prefer `plastic_mergeToBranch` when available. When `target` is omitted, it resolves the source branch's Plastic parent branch instead of assuming `/dev`. It switches to the target, optionally updates, runs the safe merge, checks merge state, and checks in the merge result. Pass `target` only when the user explicitly wants a different integration branch.

Use `plastic_mergeBranches` only for the separate workspace-free server-side route. It requires explicit same-repository/server `br:/...@<repository>@<server>` source and target selectors plus a nonempty message. Its preflight renders the command only; it does not contact Plastic or analyze conflicts. A completed result proves one emitted root-mount target changeset for the dispatch, but does not verify the source merge link, target-head exclusivity, rollback, or xlink effects. Native receipts distinguish preflight/completed/no-op/conflict/uncertain/failed outcomes; inspect attempt/capture/effect before deciding whether to retry. Full @cloud/@unity server qualifiers are preserved. Requested and emitted server names stay separate, with alias equivalence explicitly unverified. No-op and conflict output do not prove that no effect occurred. Do not use it for xlink handling, conflict-policy selection, shelve merges, retries, target-head unification, or a workspace fallback; undetected server-side xlink effects remain possible.

Plastic merges are workspace- and branch-oriented, not Git fast-forwards: the merge is applied to the branch currently loaded in the workspace, and the merge checkin must be created on that target branch. Switching to the target after a checkin on the source branch does not move or integrate that changeset. Treat any source/target/final-branch mismatch as a failed closeout; inspect target-branch history and rerun the merge from the actual target rather than merely switching branches.

Use one `plastic_diff` with explicit `mode="file"|"revisions"|"workspace"`. File mode requires `path`; omit `revision` for a verified loaded base, or supply a supported historical selector. Revisions mode requires `leftRevision` and `rightRevision`; exported selectors remain unresolved identities unless loaded metadata is independently observed. Workspace mode requires nonempty `paths` or `allPending=true`; `includePrivate` applies only to all-pending. Old specialized names are removed, not aliases. Prefer focused tests, `plastic_status` for pending scope, and direct reads; diff only when change-boundary evidence is needed, not routine validation or checkin preflight.

Loaded bases use strict UTF-8 status/fileinfo/ls observations and a qualified genuine revision ID, verified against the loaded file hash. Controlled deletions use the frozen loaded workspace tree; local moves use observed OldPath metadata. Added/explicitly selected private files use a deliberate empty base; an added empty file reports `added-empty`. Unavailable bytes, ownership or unsupported observations are errors, never empty bases or guessed IDs. Workspace results retain per-file failures with `ok=false`, counts, unmatched paths, skipped/limited/unattempted/omitted outcomes and completeness; inspect these before concluding review is complete. Defaults: 3 all-pending items (20 scoped), 3000 characters per workspace excerpt; file/revisions excerpts default to 8000. Keep bounds small. Comparisons use stable bounded local snapshots and owned ASCII-safe operands, not an atomic workspace/repository snapshot. Binary inputs use exact byte equality. Text comparison uses the configured `PI_PLASTIC_DIFF_EXECUTABLE` or PATH `diff`, with no backend retry or automatic substitution.

Use `plastic_patch` for review patch generation with `clean` and `integration` filters; it is generation-only and does not apply patches. `toolPath` is its highest-priority one-call patch-backend override, followed by `PI_PLASTIC_PATCH_EXECUTABLE`. On Windows, configure one to a verified patch-capable non-GUI executable such as Git's `diff.exe`: patch generation deliberately does not reuse `PI_PLASTIC_DIFF_EXECUTABLE`/GnuWin32. On macOS with Plastic 11, Apple BSD `/usr/bin/diff` has prior text-only evidence but rejects the `--binary` argument used by `cm patch`; set the patch-specific policy to a verified GNU Diffutils-compatible non-GUI executable. The non-Windows fallback to the text setting or bare `diff` is only valid when that executable accepts the local Plastic patch arguments. Interactive Pi sessions issue one path-redacted package capability warning per runtime for an invalid configured patch override or missing Windows setting; fix `PI_PLASTIC_PATCH_EXECUTABLE` and retry, while headless sessions retain `plastic_patch` tool-time validation. Unqualified `br:/...` patch selectors are qualified only from the current workspace's exact selector repository; otherwise pass `br:/<branch>@<repository>@<server>`. For a large patch, pass an intentional new `output` path: the package stages and atomically publishes it, never overwriting an existing path. Do not use `cm cat --raw`: it is unsupported for this workflow. Typed retrieval owns cleanup; the low-level byte-preserving fallback is `cm cat --file` only when a typed tool cannot represent the case. Plastic/server output may represent moves as moves or delete/add records, so inspect generated patches rather than assuming a move-aware encoding.

Prefer runtime `plastic_*` tools first. Keep `cm` shell commands as manual fallback.

Directly invoked mutating `plastic_*` tools run without package-owned approval tokens or UI confirmation. Inspect exact targets and rely on the tools' command, workspace, path-containment, and non-interactive process guards. Do not call preflight and then the same operation as routine ceremony. Use preflight when mutation scope is ambiguous or broad, moved/deleted paths may need rewriting, a compound operation needs preview, or the user explicitly asks for one. A command process is attempted once without implicit retry; after an ambiguous failure, inspect Plastic status before deciding whether to retry manually.

Create normal work branches beneath an intended parent: use `<parent-branch>/<new-branch>`, not `/<new-branch>`. The parent does not need to be the branch loaded in the workspace. Prefer `plastic_branchCreate(branch="<new-branch>", parent="<parent-branch>")`; omitting `parent` uses the current branch only as a convenience. Rare top-level branch creation requires the explicit `allowRootBranch=true` override.

## External File Loading

CRITICAL: Use relative path references and load files only when needed for the current step.

- Do NOT preemptively load all reference files.
- Treat loaded references as mandatory instructions for the active task scope.
- Read the reference files only when relevant.
- For long files, use Read with `offset`/`limit` to load only needed sections.

## Reference Files (Load On Demand)

Quick reference -> ../using-plastic/references/quick-reference.md
Branch management -> ../using-plastic/references/branch-management.md
Changesets -> ../using-plastic/references/changeset-operations.md
Reviewing changes -> ../using-plastic/references/reviewing-changes.md
Shelving -> ../using-plastic/references/shelving.md
Workspaces -> ../using-plastic/references/workspaces.md
Code review creation -> ../using-plastic/references/code-review-creation.md
Integration -> ../using-plastic/references/integration.md
Troubleshooting -> ../using-plastic/references/troubleshooting.md
Resources -> ../using-plastic/references/resources.md
Conventional commits -> ../_shared/references/conventional-commits.md
