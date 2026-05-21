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

- `includeAll=true` includes changed/moved/deleted tracked items, but does not include private items by itself.
- `plastic_checkin` now inspects machine-readable pending changes before running checkin.
- If Plastic reports `There are no changes in the workspace` and only private items are pending in scope,
  the tool auto-runs `cm add` for safe in-scope private paths, then retries checkin once.
- Sensitive private paths (for example `.env*`, private key extensions, `.npmrc`, credentials/secrets JSON)
  are excluded from auto-add and reported as warnings/errors for explicit handling.
- The JSON response includes decision metadata (`decisionPath`, pre/post pending summaries, and auto-add info)
  so agents can continue unattended without asking for confirmation.

Note: avoid `updateAfter=true` in unattended runs because it can trigger interactive update-merge. Use `plastic_update()` followed by `plastic_merge(...)` (default auto strategy) when a merge is required.

## Checkins With Deletions

Before checkin, verify deleted items are present in pending changes:

```bash
cm status --all
```

Safe checklist:
- Confirm deleted items appear in status output before checkin.
- Prefer `plastic_checkin(preflight=true, paths=[...])` so the tool can rewrite unstable file scopes (moved/deleted) to stable parent scopes.
- `plastic_checkin` now inspects `cm status --machinereadable` and auto-enables `--applychanged` when moved/deleted items are in scope.
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

Never run `cm diff` in Pi.

Use one of these safe alternatives:

```text
plastic_diffFile(path="<workspace-path>", revision="<revision-spec>")
plastic_diffRevisions(leftRevision="<left-revspec>", rightRevision="<right-revspec>")
```

```bash
cm cat "<left-revspec>" --file=left.tmp
cm cat "<right-revspec>" --file=right.tmp
git diff --no-index -- left.tmp right.tmp
```

## Commit Message Format

Use conventional commits from ../../_shared/references/conventional-commits.md.

## Changeset History

```bash
cm find changeset --orderby="date desc" --limit=20 \
  --format="{changesetid} {date} {owner} {comment}"
```
