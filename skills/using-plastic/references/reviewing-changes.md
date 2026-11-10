# Reviewing Changes

## Critical Rule

Never run `cm diff` in Pi. It may open a GUI window and block CLI automation.

`plastic_diff` requires an explicit mode and performs bounded non-GUI comparison.

## Focused Patch Generation

Use `plastic_patch` when you need a branch-review patch for AI assistance, code review, or sharing outside the Plastic GUI:

```text
plastic_patch(source="<branch-spec>", integration=true)
plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")
plastic_patch(source="<branch-spec>", includeBinaries=true, output="<new-binary-patch-file>")
```

`integration=true` shows changes pending merge into the parent branch. `clean=true` strips content that arrived via merges. CM 11.0.16.10616 generates git diff natively, including rename support, without an external backend. Inspect individual artifacts rather than asserting rename evidence from client capability. Changed binaries are listed by default; `includeBinaries=true` requests raw byte hunks, not proof that any particular binary was included. Non-UTF8 output returns bounded byte/hash metadata without lossy decoding; explicit new output preserves the bytes. The package is generation-only: CM `--tool` is application-only and is not accepted.

## Text-Only Diff Options

Do not use diffs as routine post-edit validation or checkin preflight. Prefer focused tests, `plastic_status` for pending scope, and direct reads for current content. Use a diff only when change-boundary evidence is needed, such as reviewing unfamiliar changes or confirming a specific risky hunk.

```text
plastic_status(machineReadable=true) # “what changed?” / changed-path listing
plastic_diff(mode="file", path="<workspace-path>", maxChars=4000) # one intentional file comparison
plastic_diff(mode="workspace", paths=["<workspace-path>"], maxChars=3000) # explicitly scoped pending review
plastic_diff(mode="workspace", allPending=true) # explicit small whole-workspace review
plastic_diff(mode="file", path="<workspace-path>", revision="cs:<number>") # explicit historical comparison
plastic_diff(mode="revisions", leftRevision="<left-file-qualified-revspec>", rightRevision="<right-file-qualified-revspec>")
```

The consolidated tool owns historical exports, stable bounded local snapshots and cleanup. Added and explicitly selected private files use a deliberate empty base; added-empty is distinct from unchanged. Loaded bases use strict fileinfo/ls metadata, a genuine qualified file revision ID, and hash-verified exported bytes, never status changesets relabeled as revisions. Controlled deletions use the frozen loaded workspace tree; local moves use observed OldPath metadata. Workspace mode retains per-file failures with ok=false; inspect counts, exclusions, unmatched paths and read/projection completeness, including limited, skipped and unattempted comparisons. Default all-pending review selects at most three items. Directory selections include pending descendants; directory rows are explicitly skipped. No failed export becomes an empty side, no atomic snapshot is claimed, and general mixed-Xlink ownership remains unverified. Text uses one configured GNU/POSIX backend with ASCII-safe operands and logical Unicode labels; binary inputs use byte equality. Do not construct cm cat recipes for ordinary review.

`cm cat --file` is a filesystem write: its argument is the output destination, never the source file. Pointing it at a working file overwrites pending changes even if stdout is piped to a temporary file. Reviewers must use typed comparisons for ordinary baseline review; a necessary unsupported export must follow the [historical export rules](changeset-operations.md#historical-export-fallback), with a new absolute temporary destination outside the workspace and a verified file revision selector.

## Metadata Listing (No GUI Diff)

Use changeset metadata to understand branch activity:

```bash
cm find changeset "where branch = '<branch-name>' order by changesetid desc limit 20" --format="{changesetid} {owner} {date} {comment}" --nototal
```

## Read Files Directly

Use the Read tool for full context instead of GUI diffs.

## CLI-Safe File Diff

Use the common no-revision path first; `base`, `head`, and `cs:head` are rejected rather than guessed:

```text
plastic_diff(mode="file", path="<workspace-path>", maxChars=4000)
plastic_diff(mode="file", path="<workspace-path>", revision="br:/<branch>", maxChars=4000)
plastic_diff(mode="revisions", leftRevision="<left-file-qualified-revspec>", rightRevision="<right-file-qualified-revspec>", maxChars=4000)
```

## Pending Changes

Prefer tool-first:

```text
plastic_status()
```

Manual shell fallback:

```bash
cm status --all
```

When pending changes include deletions, verify deleted paths in status output before checkin.
