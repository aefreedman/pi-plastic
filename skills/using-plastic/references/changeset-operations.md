# Changeset Operations

## Status

```bash
cm status --all
```

Tool-first:

```text
plastic_status()
```

## Add Files

```bash
cm add <workspace-path>
```

## Checkin

```bash
cm checkin -c="feat(player): add dash mechanic"
```

Tool-first:

```text
plastic_checkin(message="feat(player): add dash mechanic", includeAll=true)
```

Unattended behavior notes:

- Exact caller paths and explicit `includeAll`, `applyChanged` and `includePrivate` flags go to one native command. The adapter does not rewrite paths, infer flags, auto-add private files, widen scope or retry.
- Plastic owns checkin eligibility, including pending merges and Xlinks. Native nonzero/timeout/cancel or unknown terminal state remains a stop, never permission for automatic replay.
- Schema v2 separates command completion from root/linked identity observations. A successful command can have unknown identities; valid emitted identities can remain alongside a later failure without making it successful.
- `preflight=true` performs zero reads or mutations and returns the exact argv plan. It is not scope/conflict analysis.

Note: avoid `updateAfter=true` in unattended runs because it can trigger interactive update-merge. Use `plastic_update()` followed by `plastic_merge(...)` (default auto strategy) when a merge is required.

## Checkins With Deletions

Before checkin, verify deleted items are present in pending changes:

```bash
cm status --all
```

Safe checklist:
- Confirm deleted items appear in status output before checkin.
- Explicitly select intended paths/options, including for moved/deleted items. Preflight shows those exact operands without rewriting them.
- Set `applyChanged` deliberately when native semantics require it; the tool does not infer it.
- Re-run `cm status --all` after add/scope changes, then checkin.

Example path-scoped checkin including a deletion:

```bash
cm checkin -c="<commit-message>" <workspace-path-1> <workspace-path-2>
```

Use full-scope checkin when in doubt:

```bash
cm checkin -c="<commit-message>"
```

## Safe Diff Usage

Never run `cm diff` in Pi. Do not replace it with a routine safe-diff call: use `plastic_status` for pending scope, focused tests for behavior, and direct reads for current content. Request diff output only when change-boundary evidence is needed.

```text
plastic_status(machineReadable=true) # list pending paths/statuses
plastic_diff(mode="file", path="<workspace-path>", maxChars=4000) # one intentional file comparison
plastic_diff(mode="workspace", paths=["<workspace-path>"], maxChars=3000) # explicitly scoped review
plastic_diff(mode="workspace", allPending=true) # explicit small whole-workspace review
plastic_diff(mode="file", path="<workspace-path>", revision="cs:<number>")
plastic_diff(mode="revisions", leftRevision="<left-file-qualified-revspec>", rightRevision="<right-file-qualified-revspec>")
```

The typed diff tools own historical `cm cat --file` materialization and cleanup; do not create agent-authored temporary files for ordinary diffs. `cm cat --raw` is unsupported for this workflow. Use typed retrieval first; `cm cat --file` is the byte-preserving low-level fallback only when a typed tool cannot represent the case.

## Historical Export Fallback

Use this fallback only when typed retrieval cannot represent the required case. For an ordinary workspace-base comparison, omit `revision` from `plastic_diff` in file mode; for a changeset comparison, supply its `revision="cs:<number>"` argument.

`cm cat <revspec> --file=<output-file>` writes historical bytes to the output file and can overwrite it. `--file` does not select the source. Piping this command to `Set-Content` or redirecting stdout does not change the destination or protect it: with `--file`, the file contents are written there rather than to stdout.

Before a necessary manual export:

- Verify the source selector. `revid:<id>` means an actual file revision ID, not a workspace changeset number. Use a verified repository/server-qualified revision ID, or a file-qualified `<path>#cs:<number>` selector for a file at a changeset.
- Create a new unique temporary directory outside the workspace and select a new absolute output path within it. Confirm that the destination does not exist. Never use a canonical workspace path or an existing baseline as the export destination.
- Export directly to that temporary destination; do not combine `--file` with a stdout pipeline to capture the content. Check command success and the exported content before comparison. Keep comparison baselines immutable.

If an export overwrites a workspace file, stop further exports and edits, record the exact command and destination, and inspect pending status. A clean status after exporting base revisions can mean pending work was erased; it does not prove successful review. Report the incident before attempting recovery, and preserve unrelated user changes.

## Commit Message Format

Use conventional commits from ../../_shared/references/conventional-commits.md.

## Changeset History

```bash
cm find changeset --orderby="date desc" --limit=20 \
  --format="{changesetid} {date} {owner} {comment}"
```

## Writable-Xlink checkin receipts

A current-client checkin can emit linked and root identities in one record. The receipt retains observed mounted identities with explicit completeness, without requiring ownership/source-tree reconstruction. A unique root emission appears as `createdChangeset`; missing/ambiguous roots remain unknown even if the native command completed. See [native Xlink operations](../../../docs/2026-11-15-writable-xlink-merges.md). Never retry an uncertain checkin automatically; inspect actual histories and workspace state.
