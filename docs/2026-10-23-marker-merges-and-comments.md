# Native marker merges and changeset comments

[Documentation index](README.md) · [Merging](2026-10-06-merging.md)

## Client baseline

These additions target Unity VCS **11.0.16.10512** (October 22, 2026). Installed `cm help merge` and `cm changeset editcomment --help` advertise these contracts. See [release notes](https://docs.unity.com/unity-version-control/release-notes/11) and [merge documentation](https://docs.unity.com/unity-version-control/uvcs-cli/merge).

No older-client fallback, automatic retry, installation or policy substitution exists. Unsupported flags mean failure/uncertainty, not permission to run another merge. Package Pi validation dependencies are unchanged; this CLI baseline is not a new Pi validation claim.

## Workspace conflict markers

```text
plastic_merge(source="br:/main/owned-feature", strategy="auto", format="json")
```

Normal auto workspace merge emits `--merge --nointeractiveresolution --mergetype=try --conflict-markers` plus nonce-framed output controls. It never selects source/destination or launches an external merge GUI for text conflicts. Compound workspace closeout uses this same default. Explicit source/destination remain intentional discard policies, not preservation/finalization proof. Server merge is a separate workflow.

CM writes diff3 destination/base/source regions to files. Applying output can contain `CONFLICT_MARKERS` and `UNRESOLVED` records. Labels contain workspace paths, not independently verified revision identities. Binary, symlink, recursive-intermediate, directory and delete-change conflicts still require explicit decisions.

Complete native exit zero establishes command completion only. Marker inspection AND independent pending/full-status path/source correlation must pass before readiness or automatic closeout. Auto does not require brittle FILE_SRC/FILE_CONFLICT/DO_MERGE declaration/action cardinality. Exit 1 can mean useful partial application; it remains uncertain, not rollback. Bounded complete stdout/stderr stays opaque external `data.commandOutput` evidence, not admitted conflict/path facts. Invalid UTF-8, truncation, timeout and abort cannot establish completion. No replay, force-finalization or automatic checkin follows uncertainty.

### Resolve and inspect

1. Use `plastic_mergeListConflictMarkers(workdir="<target-workspace>")`. It emits read-only `cm merge --list-conflict-markers` once. Only complete exit-zero **exactly empty** stdout/stderr establishes `clear`. Nonempty records, exit 1 and diagnostics remain `unknown`: installed help does not specify an unambiguous list-record grammar. The reserved `pending` state is not fabricated from synthetic records.
2. Reconcile files with both contributors and ancestor context, remove real markers, and validate. Inspect remaining non-text/directory/delete-change conflicts independently.
3. Re-list and inspect remaining conflict state, branch identity, pending paths and source links. Removing markers is the normal path; never force-finalize or reapply merely because exit 1 or checkin rejection occurred. No backup/restore dance is needed for marker text.
4. Only for explicitly intentional marker text, use `plastic_mergeMarkResolved(paths=["exact-file"], acknowledgeIntentionalMarkers=true)`. It removes tracking **without inspecting contents**. Exact existing regular files must be physically contained in resolved workdir; symlink escapes, globs and directories are rejected. Preflight performs zero SCM commands. Completion proves neither validation nor readiness; re-inspect independently. Never use bypass to silence real conflicts.
5. Check in only after independent conflict, branch, scope/source and validation evidence. Every typed checkin inspects markers before mutation, including preflight's read-only path. Unknown listing stops mutation without retry. Closeout propagates these gates and preserves prior effects/created identity.

Nested merge/checkin/closeout receipts retain compact marker state/attempt/capture evidence, not repeated raw listings. Standalone listing retains bounded external output. **An empty marker list NEVER establishes all-conflict readiness.** XML status merge fields are not a replacement conflict-readiness contract; combined CO+RP/CO+CP layouts remain unsupported.

CM documents that already marked files are untouched on a repeated marker merge. This is not an automatic retry policy.

## Changeset comments

```text
plastic_changesetEditComment(changeset="cs:42@Example Repository@example@unity", comment="Is it ready?", output="json")
plastic_changesetEditComment(changeset="cs:42@Example Repository@example@unity", comment="", output="json")
plastic_changesetEditComment(changeset="cs:42@Example Repository@example@unity", commentsFile="/tmp/reviewed-comment.txt", preflight=true)
```

Supply exactly one of `comment` or `commentsFile`. Empty text clears; omission does not. Shell-free text preserves spaces, question marks, Unicode and bounded line breaks. Option-leading text requires explicit comment-file form. The file form emits `-commentsfile=<path>`, never guesses a filename. Selectors begin with `cs:` followed by a number or GUID; qualifiers are preserved.

Preflight performs zero commands and does not verify existence, permission or contents. Completion proves one command returned, not independently observed stored text or repository identity. Failed/uncertain writes are never retried automatically.

## Historical evidence boundary

Historical session captures included exit-zero applications with unsupported pending/full-status profiles and checkin rejection despite source-linked pending state. They do not prove latest-client marker readiness. Keep producer output bounded and untrusted. Do not widen admission from marker words, source links, exit zero or an empty list alone. Unknown/mixed pending layouts stay unsupported. Forced-finalization/preservation workarounds are not a current API.
