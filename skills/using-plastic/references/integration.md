# Integration Points

## Work Workflow

- Create feature branch following detected conventions.
- Use incremental checkins.
- Never use `cm diff`. Do not diff routinely; use a text-only diff tool only when review needs change-boundary evidence.
- Use `plastic_merge` (or `cm merge ... --nointeractiveresolution --mergetype=try --conflict-markers`) for autonomous merges.

## Autonomous Merge Workflow

Workspace merges are not Git fast-forwards. A merge applies to the branch currently loaded, and switching to the target after a checkin on the source branch does not move or integrate that changeset.

Use `plastic_mergeToBranch` for clean-start closeout. If `target` is omitted, the tool resolves the source branch's Plastic parent branch. It switches if needed, updates only if requested, merges once, and checks in once after native merge success. A native failure stops the sequence; standalone checkin lets Plastic decide eligibility. For marker handling, see the [marker workflow](../../../docs/2026-10-23-marker-merges-and-comments.md#resolve-and-inspect).

- Switch to the target branch/workspace and ensure you understand the current pending state.
- [Native Xlink operations](../../../docs/2026-10-06-merging.md#xlinks) are delegated to Plastic without ownership reconstruction, mount/file-count gates or status matrices.
- Run `plastic_merge(...)` with the exact native branch, changeset, label or shelveset operand. It executes one noninteractive merge and reports the native result.
- If Plastic stops on a delete/change directory conflict and source deletion is the intended resolution, use `plastic_resolveDeleteChangeConflict(...)` on the exact path. Reinspect pending effects before attempting another merge.
- Use `plastic_status()` to inspect pending work. It doesn't certify that a merge is complete or ready to check in.
- Pending merge links normally remain until checkin; they are not by themselves unresolved conflicts. Inspect native diagnostics and reconcile actual conflicts, then let native checkin decide eligibility.
- List native markers with `plastic_mergeListConflictMarkers()`, edit/validate, then re-inspect markers AND remaining conflicts/scope. Unknown evidence blocks; never force-finalize or reapply automatically.
- After compile/tests, run `plastic_status()` again so Unity-generated private artifacts are not mistaken for merge fallout.
- Only then create the merge checkin.
- Verify the merge checkin was created on the target branch. If the workspace or changeset is on the source branch, stop: do not switch to the target and claim completion. Inspect target history and pending effects before deciding whether another merge is needed.

## Server-side File Conflict Resolution

Use `plastic_mergeBranches(mode="analyze", source="<qualified-source>", target="<qualified-target>")` for read-only conflict discovery, not `preflight`. Then independently inspect contributors, produce merged files, validate them, and submit a reviewed absolute `fileConflictsResolutionsFile` with a nonempty message. Follow the [full workflow and safety boundaries](../../../docs/2026-10-06-merging.md#agent-conflict-resolution-workflow). Exact destination conflict paths are JSON keys, not local workspace paths. Never guess the roles/repository of numeric FILE_CONFLICT fields, export over workspace files, automatically discard unlisted conflicts, or retry uncertain applying results. Keep all inputs immutable through completion; directory conflicts and shelve modes remain separate.

## Review Workflow

- Create or reuse review workspace.
- Switch to target branch and list recent changesets:

```bash
cm find changeset "where branch = '<branch-name>' order by changesetid desc limit 20" --format="{changesetid} {owner} {date} {comment}" --nototal
```

- Generate a focused branch-review patch when a whole-branch view is useful:

```text
plastic_patch(source="<branch-spec>", integration=true)
plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<new-patch-file>")
```

  Native CM patch generation needs no external backend. Set `includeBinaries=true` to request changed binary contents as raw byte hunks (default: binary names only). Use a repository-qualified `br:/...@<repository>@<server>` selector when the current workspace selector cannot supply the exact repository. Requested output is staged and atomically published only when successful, without overwrite.

- When change-boundary evidence is needed, inspect specific files first and opt into multi-file output explicitly:

```text
plastic_diff(mode="file", path="<workspace-path>", maxChars=4000) # one intentional file comparison
plastic_diff(mode="workspace", paths=["<workspace-path>"], maxChars=3000) # explicitly scoped pending review
plastic_diff(mode="workspace", allPending=true) # explicit small whole-workspace review
plastic_diff(mode="file", path="<workspace-path>", revision="cs:<number>")
plastic_diff(mode="revisions", leftRevision="<left-file-qualified-revspec>", rightRevision="<right-file-qualified-revspec>")
```

## Plan Workflow

- Search changeset history for related work.
