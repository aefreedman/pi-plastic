# Reviewing Changes

## Critical Rule

Never run `cm diff` in Pi. It may open a GUI window and block CLI automation.

`plastic_diff` is disabled by design.

## Focused Patch Generation

Use `plastic_patch` when you need a branch-review patch for AI assistance, code review, or sharing outside the Plastic GUI:

```text
plastic_patch(source="br:/main/task001", integration=true)
plastic_patch(source="br:/main/task001", clean=true, integration=true, output="review.patch")
plastic_patch(source="cs:2", destination="cs:4")
plastic_patch(source="br:/main/task001", toolPath="C:\\gnu\\diff.exe")
```

`integration=true` shows changes pending merge into the parent branch. `clean=true` strips content that arrived via merges. Use `output` for large patches; Plastic refuses to overwrite an existing output file. Inspect patch contents before sharing because patches can contain source code, binary data, local paths, or secrets present in changed files.

## Text-Only Diff Options

Prefer tool-first when available:

```text
plastic_diffFile(path="Assets/Scripts/PlayerController.cs", revision="cs:123")
plastic_diffRevisions(leftRevision="Assets/Scripts/PlayerController.cs#cs:122", rightRevision="Assets/Scripts/PlayerController.cs#cs:123")
```

Manual shell fallback for revision vs revision text diff:

```bash
cm cat "Assets/Scripts/PlayerController.cs#cs:122" --file=left.tmp
cm cat "Assets/Scripts/PlayerController.cs#cs:123" --file=right.tmp
git diff --no-index -- left.tmp right.tmp
```

## Metadata Listing (No GUI Diff)

Use changeset metadata to understand branch activity:

```bash
cm find changeset "where branch = '/main/feature-name' order by changesetid desc limit 20" --format="{changesetid} {owner} {date} {comment}" --nototal
```

## Read Files Directly

Use the Read tool for full context instead of GUI diffs.

## CLI-Safe File Diff

Use Plastic tool:

```text
plastic_diffFile(path="Assets/Scripts/PlayerController.cs", revision="cs:123")
plastic_diffRevisions(leftRevision="Assets/Scripts/PlayerController.cs#cs:122", rightRevision="Assets/Scripts/PlayerController.cs#cs:123")
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
