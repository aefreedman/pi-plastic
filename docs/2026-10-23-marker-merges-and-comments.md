# Native marker merges and changeset comments

[Documentation index](README.md) · [Merging](2026-10-06-merging.md)

## Client baseline

These additions target Unity VCS **11.0.16.10512** (October 22, 2026). Installed `cm help merge` and `cm changeset editcomment --help` advertise these contracts. See [release notes](https://docs.unity.com/unity-version-control/release-notes/11) and [merge documentation](https://docs.unity.com/unity-version-control/uvcs-cli/merge).

No older-client fallback, automatic retry, installation or policy substitution exists. Unsupported flags mean failure/uncertainty, not permission to run another merge. The CLI client version and Pi validation baseline are independent; the package manifest declares the Pi validation dependencies.

## Workspace conflict markers

```text
plastic_merge(source="br:/main/owned-feature", strategy="auto", format="json")
```

Normal auto workspace merge emits `--merge --nointeractiveresolution --mergetype=try --conflict-markers` plus nonce-framed output controls. It never selects source/destination or launches an external merge GUI for text conflicts. Compound workspace closeout uses this same default. Explicit source/destination remain intentional discard policies, not preservation/finalization proof. Server merge is a separate workflow. There is no forced-finalization API.

CM writes diff3 destination/base/source regions to files. Applying output can contain `CONFLICT_MARKERS` and `UNRESOLVED` records. Labels contain workspace paths, not independently verified revision identities. Binary, symlink, recursive-intermediate, directory and delete-change conflicts still require explicit decisions.

Complete native exit zero establishes command completion only. Marker inspection AND independent pending/full-status path/source correlation must pass before readiness or automatic closeout. Auto does not require brittle FILE_SRC/FILE_CONFLICT/DO_MERGE declaration/action cardinality. Exit 1 can mean useful partial application; it remains uncertain, not rollback. Bounded complete stdout/stderr stays opaque external `data.commandOutput` evidence, not admitted conflict/path facts. Invalid UTF-8, truncation, timeout and abort cannot establish completion. No replay, force-finalization or automatic checkin follows uncertainty.

### Resolve and inspect

1. Use `plastic_mergeListConflictMarkers(workdir="<target-workspace>")`. It emits read-only `cm merge --list-conflict-markers` once. Only complete exit-zero **exactly empty** stdout/stderr establishes `clear`. A narrow observed Windows CM 11.0.16.10512 profile reports `pending`: complete valid UTF-8 terminal exit 1, empty stderr, and only LF- or CRLF-terminated `CONFLICT_MARKERS /workspace-root-relative/path` records. Plain and space-containing ASCII filenames were captured on Windows; classification checks the output contract on every platform, not the host OS. Exact empty exit-zero evidence remains clear on all platforms. Admission is bounded (64 KiB stdout, 256 records, 4096 characters per path, 255 per component): components start with an ASCII letter/digit, contain only ASCII letters/digits, dot, underscore, hyphen or single internal spaces, and cannot end in dot/space or use Windows device names. Duplicate paths (including case variants), unsafe/ambiguous paths, blank/mixed records, diagnostics and inconsistent exits remain `unknown`.
2. Reconcile files with both contributors and ancestor context, remove real markers, and validate. Inspect remaining non-text/directory/delete-change conflicts independently.
3. Re-list and inspect remaining conflict state, branch identity, pending paths and source links. Removing markers is the normal path; never force-finalize or reapply merely because exit 1 or checkin rejection occurred. No backup/restore dance is needed for marker text.
4. Only for explicitly intentional marker text, use `plastic_mergeMarkResolved(paths=["exact-file"], acknowledgeIntentionalMarkers=true)`. It removes tracking **without inspecting contents**. Exact existing regular files must be physically contained in resolved workdir; symlink escapes, globs and directories are rejected. Preflight performs zero SCM commands. Completion proves neither validation nor readiness; re-inspect independently. Never use bypass to silence real conflicts.
5. Check in only after independent conflict, branch, scope/source and validation evidence. Every typed checkin inspects markers before mutation, including preflight's read-only path. Pending OR unknown listing stops mutation without retry. Closeout propagates these gates and preserves prior effects/created identity.

An informational pending listing returns `ok:true`, `outcome:"pending"`, `inspection.state:"pending"`, `effect:"not-attempted"` and `checkinReadiness:"unknown"`. Its `commandCompleted:false` deliberately retains the strict native-exit-zero meaning; successful classification is not command completion or readiness. Generic failures remain observably `unknown`/uncertain errors.

Native Windows Unicode listing bytes were invalid UTF-8 and included irreversible `?` replacements. They remain unknown: no fallback decoding, byte replacement, settings changes or retries occur, and no unobserved Unicode encoding or platform profile is claimed.

Nested merge/checkin/closeout receipts retain compact marker state/attempt/capture evidence, not repeated raw listings. Compact `pending` requires compatible exit-1 complete/capture metadata but cannot revalidate omitted text; state/counts are not file identity. Exit-1/nonempty metadata cannot be promoted to `clear`. Standalone listing retains bounded external output and reclassifies exact text/byte lengths. Printed paths never become automatic mutation operands; physical scope and exact-file acknowledgement remain independent. **An empty marker list NEVER establishes all-conflict readiness.** Unknown or mixed pending/full-status profiles remain unsupported; source-linked pending state and exit zero alone cannot authorize checkin. XML status merge fields are not a replacement conflict-readiness contract. The observed non-merge file profile `CO+RP` with a positive revision and `NO_MERGES` is supported when full status corroborates `Replaced / Checked-out (unchanged)`. Merge-associated `CO+RP`, directory variants and `CO+CP` remain unsupported.

CM documents that already marked files are untouched on a repeated marker merge. This is not an automatic retry policy.

## Changeset comments

```text
plastic_changesetEditComment(changeset="cs:42@Example Repository@example@unity", comment="Is it ready?", output="json")
plastic_changesetEditComment(changeset="cs:42@Example Repository@example@unity", comment="", output="json")
plastic_changesetEditComment(changeset="cs:42@Example Repository@example@unity", commentsFile="/tmp/reviewed-comment.txt", preflight=true)
```

Supply exactly one of `comment` or `commentsFile`. Empty text clears; omission does not. Shell-free text preserves spaces, question marks, Unicode and bounded line breaks. Option-leading text requires explicit comment-file form. The file form emits `-commentsfile=<path>`, never guesses a filename. Selectors begin with `cs:` followed by a number or GUID; qualifiers are preserved.

Preflight performs zero commands and does not verify existence, permission or contents. Completion proves one command returned, not independently observed stored text or repository identity. Failed/uncertain writes are never retried automatically.
