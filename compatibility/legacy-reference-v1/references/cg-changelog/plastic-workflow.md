# Plastic Workflow (Merge Changesets)

Use this workflow when source selection includes Plastic.

## Default Target

- Default integration target branch: `/dev`
- Allow override through argument hint: `branch:/main` (or another branch)

## Data to Collect

- Changeset ID
- Comment/message
- Owner/contributor
- Date
- Branch target
- Merge/integration signal
- Usage/access hints from merge comments or linked work items (when available)
- Source status (`available`, `empty`, `partial`, or `failed`)

## Query Strategy

1. Read recent changesets on the target branch in the selected time window.
2. Filter for merge/integration changesets using available metadata and/or comment heuristics.
3. If merge-only filtering yields no results, fall back to recent target-branch changesets with a clear note.
4. Extract concise access details when explicitly present in comments or linked tracker metadata.
5. Record Plastic source status separately from any other requested changelog source.

Tool-first probes:

```text
plastic_currentBranch()
plastic_status()
```

Validated shell fallback examples use Plastic's query text for ordering and limiting. Do not pass ordering or limit as separate dashed options to `cm find changeset`.

```bash
# Recent target-branch changesets, newest first, bounded for manual/window filtering.
cm find changeset "where branch='/dev' order by date desc limit 200" \
  --format="{changesetid}|{date}|{owner}|{comment}{newline}" \
  --dateformat="yyyy-MM-dd HH:mm" \
  --nototal
```

Date-window syntax can vary across Plastic client/server versions. Prefer a validated project-local command or package helper when one exists. If exact date filtering fails, use the bounded recent-list fallback above, filter the selected window manually from the formatted dates, and mark the source as `partial` with a note that date filtering happened outside Plastic query evaluation.

If the fallback also fails, mark Plastic as `failed` and continue only if another requested source succeeds.

## Source Status Labels

- `available`: Plastic queried successfully and produced in-window records, or a confirmed quiet window.
- `empty`: Plastic queried successfully and found no in-window records.
- `partial`: Plastic returned usable recent data but not the preferred date-bounded or merge-metadata evidence.
- `failed`: Plastic could not be queried.
- `not requested`: Plastic was not requested or selected.

## Merge Signal Heuristics

Treat a changeset as merge-related when one or more are true:
- Native merge metadata indicates integration into target branch
- Comment includes merge indicators (`merge`, `integrate`, `merged`, `cherry-pick`)
- Branch relationship indicates integration flow into target

## Traceability Format

- Use changeset references as `(cs:12345)`

## Usage Detail Extraction

Plastic comments are often brief. Include a "How to access" line only when clear, explicit guidance exists.
Do not infer UI paths from file names alone.
