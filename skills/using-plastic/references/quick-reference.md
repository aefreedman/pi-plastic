# Plastic Quick Reference

Use runtime `plastic_*` tools first. Keep shell commands below as manual fallback.

Note: command examples target current `cm` 11.x CLI syntax; legacy aliases may differ.

| Operation | Preferred tool method | Shell fallback | Notes |
|-----------|------------------------|----------------|-------|
| Status | `plastic_status()` | `cm status` | Pending changes |
| Current branch | `plastic_currentBranch()` | `cm status | head -1 | cut -d@ -f1 | xargs` | Reads active branch |
| Create branch | `plastic_branchCreate(branch="<branch-spec>")` | `cm branch create <branch-spec>` | Hierarchical names |
| Switch branch | `plastic_switchBranch(branch="<branch-spec>")` | `cm switch --silent --noinput <branch-spec>` | `pendingChanges="shelve"` for tracked pending changes; private-only pending changes switch directly unattended |
| Add files | `plastic_add(paths=[...])` | `cm add <files>` | Stage for checkin |
| Checkin | `plastic_checkin(message="...")` | `cm checkin -c="message"` | Commit changes (`includeAll` excludes private unless added/`includePrivate`) |
| Update | `plastic_update()` | `cm update --dontmerge --noinput` | Pull latest without interactive merge |
| Merge | `plastic_merge(source="<source-branch-spec>")` | `cm merge <source-branch-spec> --merge --nointeractiveresolution --mergetype=try` | Surfaces `FILE_CONFLICT`; run `plastic_status()` before checkin |
| Finalize merge metadata | `plastic_finalizeMerge(source="<source-branch-spec>", strategy="destination")` | `cm merge <source-branch-spec> --merge --nointeractiveresolution --mergetype=forced --keepdestination` | Use after manual/reviewed resolution when checkin says merge is still in progress |
| Shelve | `plastic_shelvesetCreate(comment="description")` | `cm shelveset create -c="description"` | Save work temporarily |
| Patch for review | `plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")` | `cm patch <branch-spec> --clean --integration --output=<patch-file>` | Focused branch-review patch; inspect before sharing |
| Diff (workspace vs revision) | `plastic_diffFile(path="<workspace-path>", revision="<revision-spec>")` | `cm cat <revspec> --file=base.tmp` + `git diff --no-index -- base.tmp <workspace-file>` | Text-only diff |
| Diff (revision vs revision) | `plastic_diffRevisions(leftRevision="<left-revspec>", rightRevision="<right-revspec>")` | `cm cat <left> --file=left.tmp` + `cm cat <right> --file=right.tmp` + `git diff --no-index -- left.tmp right.tmp` | Avoids GUI diff |

## Merge verification checklist

- Run `plastic_merge(...)`.
- If `plastic_merge(...)` reports `FILE_CONFLICT`, inspect/resolve the listed paths and validate before finalizing.
- Immediately run `plastic_status()`.
- Pending merge links are expected until the merge result is checked in; merge-in-progress hints are blockers.
- If validation/tests were run after the merge, run `plastic_status()` again before checkin so generated private artifacts do not muddy the result.
- If `plastic_checkin(...)` says a merge is still in progress after files are resolved and validated, run `plastic_finalizeMerge(source=..., strategy="destination")`, then retry checkin.
