# Reviewing Changes

## Critical Rule

Never run `cm diff` in Pi. It may open a GUI window and block CLI automation.

`plastic_diff` requires an explicit mode and performs bounded non-GUI comparison.

## Focused Patch Generation

Use `plastic_patch` when you need a branch-review patch for AI assistance, code review, or sharing outside the Plastic GUI:

```text
plastic_patch(source="<branch-spec>", integration=true)
plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")
plastic_patch(source="<branch-spec>", toolPath="<path-to-diff-tool>")
```

`integration=true` shows changes pending merge into the parent branch. `clean=true` strips content that arrived via merges. Plastic/server output may encode moved items as moves or as delete/add records, so inspect the generated patch rather than assuming a move-aware representation. `toolPath` is the highest-priority patch backend override, followed by `PI_PLASTIC_PATCH_EXECUTABLE`. On macOS with Plastic 11, Apple BSD `/usr/bin/diff` is validated for text-only diffs but rejects the `--binary` argument passed by `cm patch`; configure a verified GNU Diffutils-compatible non-GUI executable through the patch-specific setting or `toolPath`. Text-diff configuration is independent. The non-Windows fallback to `PI_PLASTIC_DIFF_EXECUTABLE` or bare `diff` is suitable only when that executable accepts the local Plastic patch arguments. This macOS observation does not validate a Windows backend; verify an explicit Windows patch backend locally. `destination` passes a second spec to `cm patch`, but its two-spec behavior is not yet an established review workflow. Unqualified `br:/...` selectors are qualified only from the exact current workspace repository, otherwise use `br:/<branch>@<repository>@<server>`. Use `output` for large patches and choose a new path: the package stages, validates, and atomically publishes it without overwriting an existing file. Inspect patch contents before sharing because patches can contain source code, binary data, local paths, or secrets present in changed files.

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
