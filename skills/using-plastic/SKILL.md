---
name: using-plastic
description: PlasticSCM operations for Unity workflows - branch management, checkins, workspace isolation, and code reviews.
---
# using-plastic Skill

Purpose: PlasticSCM operations for Unity workflows.

## Critical Rule

Never run `cm diff` in Pi. It may launch GUI windows and block the CLI agent.

Never run interactive `cm merge --merge` flows. Use `plastic_merge` (preferred) or explicitly pass `--nointeractiveresolution --mergetype=try` (safe default). Use source/destination policy flags only as explicit overrides.

Treat `plastic_merge` success as provisional until `plastic_status` confirms there are no merge-in-progress hints. Pending merge links are expected until the merge result is checked in; merge-in-progress hints are not. If files are manually resolved and validated but checkin is blocked by Plastic merge metadata, use `plastic_finalizeMerge` with an explicit source/destination policy before retrying checkin.

For the common closeout flow of merging a finished source branch into its parent branch, prefer `plastic_mergeToBranch` when available. When `target` is omitted, it resolves the source branch's Plastic parent branch instead of assuming `/dev`. It switches to the target, optionally updates, runs the safe merge, checks merge state, and checks in the merge result. Pass `target` only when the user explicitly wants a different integration branch.

`plastic_diff` is intentionally disabled. Route changed-path listing to `plastic_status()`, one intentional workspace-file comparison to `plastic_diffFile(path="<workspace-path>")`, an explicitly scoped pending review to `plastic_workspaceDiff(paths=[...])`, and an explicit historical pair to `plastic_diffRevisions`. Do not use diffs as routine post-edit validation or checkin preflight. Prefer focused tests, `plastic_status` for pending scope, and direct reads for current file content; diff only when change-boundary evidence is needed. `plastic_diffFile` uses machine-readable status: added and explicitly selected private/new files compare against an empty base; changed, moved, and deleted items use their reported base revision when available. A `--nodata` base failure means Plastic cannot provide historical bytes; refresh/update the workspace or use two known file-qualified revisions. Explicit `revision` behavior remains a separate historical request. Binary content is reported rather than decoded as text.

`plastic_workspaceDiff` requires selected paths or explicit `allPending=true`, runs status once, has small default file/per-file/combined-output bounds, and returns per-file outcomes without aborting when one file is unavailable. Selected private paths are included; whole-workspace private review additionally requires `includePrivate=true`. Keep `maxChars` small unless more output is intentional. Use `plastic_patch` for review patch generation with `clean` and `integration` filters; it is generation-only and does not apply patches. It uses `PI_PLASTIC_DIFF_EXECUTABLE` when set, otherwise GNU/POSIX `diff` on PATH; paths containing spaces are supported, but Pi does not discover Git Bash paths automatically. Pass `toolPath` only for an intentional one-call override. For a large patch, pass an intentional new `output` path because Plastic will not overwrite it.

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
