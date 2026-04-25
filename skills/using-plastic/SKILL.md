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

`plastic_diff` is intentionally disabled. Use `plastic_diffFile` or `plastic_diffRevisions` for text-only diffs.

Prefer runtime `plastic_*` tools first. Keep `cm` shell commands as manual fallback.

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
