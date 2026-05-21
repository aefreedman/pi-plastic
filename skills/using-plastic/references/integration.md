# Integration Points

## Work Workflow

- Create feature branch following detected conventions.
- Use incremental checkins.
- Never use `cm diff`; use text-only diff tools.
- Use `plastic_merge` (or `cm merge ... --nointeractiveresolution --mergetype=try`) for autonomous merges.

## Autonomous Merge Workflow

- Switch to the target branch/workspace and ensure you understand the current pending state.
- Run `plastic_merge(...)`.
- If Plastic stops on a delete/change directory conflict and source deletion is the intended resolution, run `plastic_resolveDeleteChangeConflict(...)`, then rerun `plastic_merge(...)`.
- Immediately run `plastic_status()` and treat it as the source of truth.
- Do not treat merge-tool success alone as proof that the merge is finished.
- If `plastic_status()` still shows `Pending merge links`, merge-in-progress state, or conflict-like pending items, stop and follow troubleshooting before any checkin.
- After compile/tests, run `plastic_status()` again so Unity-generated private artifacts are not mistaken for merge fallout.
- Only then create the merge checkin.

## Review Workflow

- Create or reuse review workspace.
- Switch to target branch and list recent changesets:

```bash
cm find changeset "where branch = '<branch-name>' order by changesetid desc limit 20" --format="{changesetid} {owner} {date} {comment}" --nototal
```

- Generate a focused branch-review patch when a whole-branch view is useful:

```text
plastic_patch(source="<branch-spec>", integration=true)
plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")
```

- Inspect specific file content changes with:

```text
plastic_diffFile(path="<workspace-path>", revision="<revision-spec>")
plastic_diffRevisions(leftRevision="<left-revspec>", rightRevision="<right-revspec>")
```

## Plan Workflow

- Search changeset history for related work.
