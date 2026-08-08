# Reviewing Changes

## Critical Rule

Never run `cm diff` in Pi. It may open a GUI window and block CLI automation.

`plastic_diff` is disabled by design.

## Focused Patch Generation

Use `plastic_patch` when you need a branch-review patch for AI assistance, code review, or sharing outside the Plastic GUI:

```text
plastic_patch(source="<branch-spec>", integration=true)
plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")
plastic_patch(source="<left-spec>", destination="<right-spec>")
plastic_patch(source="<branch-spec>", toolPath="<path-to-diff-tool>")
```

`integration=true` shows changes pending merge into the parent branch. `clean=true` strips content that arrived via merges. Plastic/server output may encode moved items as moves or as delete/add records, so inspect the generated patch rather than assuming a move-aware representation. `toolPath` is the highest-priority patch backend override, followed by `PI_PLASTIC_PATCH_EXECUTABLE`; on Windows configure either with a verified patch-capable non-GUI executable such as Git's `diff.exe`. The package deliberately does not reuse `PI_PLASTIC_DIFF_EXECUTABLE`/GnuWin32 for Windows patches; on non-Windows it falls back to that text-diff setting or `diff`, whose compatibility with Plastic's patch arguments must be verified locally; Plastic-backed macOS patch validation is still pending. Unqualified `br:/...` selectors are qualified only from the exact current workspace repository, otherwise use `br:/<branch>@<repository>@<server>`. Use `output` for large patches and choose a new path: the package stages, validates, and atomically publishes it without overwriting an existing file. Inspect patch contents before sharing because patches can contain source code, binary data, local paths, or secrets present in changed files.

## Text-Only Diff Options

Do not use diffs as routine post-edit validation or checkin preflight. Prefer focused tests, `plastic_status` for pending scope, and direct reads for current content. Use a diff only when change-boundary evidence is needed, such as reviewing unfamiliar changes or confirming a specific risky hunk.

```text
plastic_status(machineReadable=true) # “what changed?” / changed-path listing
plastic_diffFile(path="<workspace-path>", maxChars=4000) # one intentional file comparison
plastic_workspaceDiff(paths=["<workspace-path>"], maxChars=3000) # explicitly scoped pending review
plastic_workspaceDiff(allPending=true) # explicit small whole-workspace review
plastic_diffFile(path="<workspace-path>", revision="cs:<number>") # explicit historical comparison
plastic_diffRevisions(leftRevision="<left-file-qualified-revspec>", rightRevision="<right-file-qualified-revspec>")
```

The diff tools materialize historical bytes and remove their temporary files internally. Added and explicitly selected private/new files use an empty base; an added empty file is reported as `added-empty`, not generic unchanged. Changed, moved, and deleted records use their status revision ID when available. A `--nodata` item cannot supply historical/base bytes: refresh the workspace or use two known file-qualified revisions. `plastic_workspaceDiff` requires selected paths or `allPending=true` and returns per-file unavailable outcomes instead of aborting the batch. Text-diff tools use bounded GNU/POSIX text diff, materialize backend operands to ASCII-safe package paths while preserving logical Unicode output labels, treat valid Unity YAML as text, and report genuine binary content explicitly. Do not construct `cm cat` temporary-file recipes for ordinary review. `cm cat --raw` is unsupported in this workflow; typed retrieval owns cleanup, and `cm cat --file` is the byte-preserving low-level fallback only when needed.

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
plastic_diffFile(path="<workspace-path>", maxChars=4000)
plastic_diffFile(path="<workspace-path>", revision="br:/<branch>", maxChars=4000)
plastic_diffRevisions(leftRevision="<left-file-qualified-revspec>", rightRevision="<right-file-qualified-revspec>", maxChars=4000)
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
