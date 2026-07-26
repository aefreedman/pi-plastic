# PlasticSCM History Backend

Load this reference only after `cg-vcs-history-analyzer` selects PlasticSCM. All operations are read-only. Run queries from the selected Plastic workspace.

## Detect and Anchor the Workspace

Use the read-only status command:

```bash
cm status
```

A successful status identifies an active workspace. Record the workspace/branch line from the output and confirm that scoped paths belong to it.

## Bounded File History

`cm history` is the direct path-history command and includes revision IDs needed for selected comparisons:

```bash
cm history "$path" --moveddeleted --limit=20 \
  --format="{changesetid}|{date}|{owner}|{id}|{branch}|{comment}{newline}"
```

`--moveddeleted` includes move and remove operations. If a path is missing, check its exact case and use only a narrowly related path query; do not scan the repository indefinitely.

For details about a selected changeset:

```bash
cm find changeset "where changesetid = <id>" \
  --format="{changesetid}|{date}|{owner}|{branch}|{comment}" --nototal

cm find revision "where changeset = <id>" \
  --format="{id}|{item}|{owner}|{date}" --nototal
```

Keep query predicates quoted. `cm find` also accepts `order by ... limit ...` inside the query; use a limit for broad metadata searches.

## Inspect Selected Changes

Never run `cm diff` in Pi. It may launch a GUI and block automation, and the `plastic_diff` alias is intentionally disabled.

Use a non-GUI revision-to-revision text comparison:

```bash
cm cat "revid:<older-revision-id>" --file="<temporary-old-file>"
cm cat "revid:<newer-revision-id>" --file="<temporary-new-file>"
git diff --no-index -- "<temporary-old-file>" "<temporary-new-file>"
```

Create temporary files outside the repository when practical and remove them afterward. `git diff --no-index` exit status `1` means differences were found. If `cm cat` or a non-GUI text comparator is unavailable, report the selected-diff step as blocked; do not substitute metadata for patch evidence.

Adjacent entries in `cm history` are candidate older/newer revisions, but branching and merges can make lineage ambiguous. State which revision IDs were compared and lower confidence when parentage is unclear.

## Trace a Line

Use annotation only for a named file or line question:

```bash
cm annotate "$path" --comparisonmethod=ignorewhitespaces \
  --format="{line}|{changeset}|{owner}|{date}|{content}"
```

Annotation reports where each line was last changed under the selected comparison method. It does not prove original intent, ownership, or expertise.

## Bounded Message Search

Use at most the thematic-query budget and one narrowly relevant term per query:

```bash
cm find changeset \
  "where comment like '%fix%' order by date desc limit 20" \
  --format="{changesetid}|{date}|{owner}|{branch}|{comment}" --nototal
```

Repeat with a different term only when it answers the delegated question. Changeset comments are candidate discovery and quoted metadata; inspect selected revision diffs before making causal claims.

## Interpretation Limits

- Contributor counts show activity only in the bounded history sample.
- Moves, deletes, branches, merges, and replicated history can complicate lineage.
- An empty result can mean a wrong/case-mismatched path, a private or newly added item, a deleted/moved item, or the wrong workspace/repository.
- Do not call a contributor an owner or expert without evidence beyond changeset frequency.
