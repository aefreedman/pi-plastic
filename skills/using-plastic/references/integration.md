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
cm find changeset "where branch = '/main/feature-name' order by changesetid desc limit 20" --format="{changesetid} {owner} {date} {comment}" --nototal
```

- Inspect file content changes with:

```text
plastic_diffFile(path="Assets/Scripts/PlayerController.cs", revision="cs:123")
plastic_diffRevisions(leftRevision="Assets/Scripts/PlayerController.cs#cs:122", rightRevision="Assets/Scripts/PlayerController.cs#cs:123")
```

## Plan Workflow

- Search changeset history for related work.
