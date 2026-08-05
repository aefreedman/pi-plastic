# Plastic Quick Reference

Use runtime `plastic_*` tools first. Keep shell commands below as manual fallback.

Note: command examples target current `cm` 11.x CLI syntax; legacy aliases may differ.

| Operation | Preferred tool method | Shell fallback | Notes |
|-----------|------------------------|----------------|-------|
| Status | `plastic_status()` | `cm status` | Pending changes |
| Current branch | `plastic_currentBranch()` | `cm status | head -1 | cut -d@ -f1 | xargs` | Reads active branch |
| Create child branch | `plastic_branchCreate(branch="<new-branch>", parent="<parent-branch>")` | `cm branch create <parent-branch>/<new-branch>` | Parent may differ from the loaded branch; top-level creation requires explicit override |
| Switch branch | `plastic_switchBranch(branch="<branch-spec>")` | `cm switch --silent --noinput <branch-spec>` | `pendingChanges="shelve"` for tracked pending changes; private-only pending changes switch directly unattended |
| Add files | `plastic_add(paths=[...])` | `cm add <files>` | Stage for checkin |
| Checkin | `plastic_checkin(message="...")` | `cm checkin -c="message"` | Commit changes (`includeAll` excludes private unless added/`includePrivate`) |
| Update | `plastic_update()` | `cm update --dontmerge --noinput` | Pull latest without interactive merge |
| Merge | `plastic_merge(source="<source-branch-spec>")` | `cm merge <source-branch-spec> --merge --nointeractiveresolution --mergetype=try` | Surfaces `FILE_CONFLICT`; run `plastic_status()` before checkin |
| Finalize merge metadata | `plastic_finalizeMerge(source="<source-branch-spec>", strategy="destination")` | `cm merge <source-branch-spec> --merge --nointeractiveresolution --mergetype=forced --keepdestination` | Use after manual/reviewed resolution when checkin says merge is still in progress |
| Shelve | `plastic_shelvesetCreate(comment="description")` | `cm shelveset create -c="description"` | Save work temporarily |
| Patch for review | `plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")` | `cm patch <branch-spec> --clean --integration --output=<patch-file>` | Focused branch-review patch; inspect before sharing |
| Changed-file listing | `plastic_status(machineReadable=true)` | `cm status --all` | Lists changed, added, moved, deleted, and private items without GUI diff |
| Diff (one workspace file) | `plastic_diffFile(path="<workspace-path>", maxChars=4000)` | None recommended | Intentional focused comparison only; not routine validation |
| Diff (pending review) | `plastic_workspaceDiff(paths=["<workspace-path>"], maxChars=3000)` | None recommended | Requires selected paths or explicit `allPending=true`; use status for changed-path listing |
| Diff (workspace vs supported revision) | `plastic_diffFile(path="<workspace-path>", revision="cs:<number>")` | None recommended | Also accepts a branch, label, file-qualified, or global revision spec |
| Diff (revision vs revision) | `plastic_diffRevisions(leftRevision="<left-revspec>", rightRevision="<right-revspec>")` | None recommended | Requires two file-qualified revisions; avoids GUI and package temp-file recipes |

## Merge verification checklist

- Run `plastic_merge(...)`.
- If `plastic_merge(...)` reports `FILE_CONFLICT`, inspect/resolve the listed paths and validate before finalizing.
- Immediately run `plastic_status()`.
- Pending merge links are expected until the merge result is checked in; merge-in-progress hints are blockers.
- If validation/tests were run after the merge, run `plastic_status()` again before checkin so generated private artifacts do not muddy the result.
- If `plastic_checkin(...)` says a merge is still in progress after files are resolved and validated, run `plastic_finalizeMerge(source=..., strategy="destination")`, then retry checkin.
