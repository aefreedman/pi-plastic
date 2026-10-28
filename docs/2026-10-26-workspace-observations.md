# Workspace observations and safety assessment

[Documentation index](README.md) · [Merging and closeout](2026-10-06-merging.md) · [Workspace operations](2026-10-06-workspace-operations.md)

Native auto merge, standalone checkin and closeout share one pending-record model. Parsing retains ordinary controlled, merge-associated and private rows together, plus bounded diagnostic gaps. An operation-specific assessment decides whether those facts authorize checkin.

- Caller workdirs are resolved/normalized once using their path dialect. Native Windows, forward-slash Windows and relative caller spellings identify the same directory. Observed paths remain lexical evidence: traversal, invalid identities, duplicate paths and out-of-workspace paths are not normalized into acceptable operands.
- Machine observations retain status, path, directory, revision token and merge-source changeset facts, independently of the displayed table.
- Full status supplies loaded identity, pending source links and unresolved/unknown-state evidence. Section, operation/path and source metadata must agree with machine facts. Size, age, whitespace column widths and section order are display only.
- Known English headings/metadata are still required; localization, unknown sections, extra/ambiguous links and unresolved binary/directory/non-text state do not become safe merely because markers are empty.
- The additive assessment contains readiness, completeness, row/link counts and up to eight specific blockers. Command completion remains recorded if a later observation fails; assessment failure does not imply merge rollback.
- Mixed merge-associated and unrelated ordinary controlled changes are valid observations but block automatic checkin with a scope blocker. Partial merged selection and private inclusion remain unsupported. Disjoint private-only extras are excluded with includePrivate=false.

Independent machine/full-status observations allow up to 499 pending rows within the existing 64 KiB capture bound. They do not inherit the legacy 128 applying-frame-pair limit. Explicit source/destination policies have separate narrow applying parsers and deliberate-discard semantics.

## Checkin status admission

Ordinary `CO` uses revision `-1` and requires a full-status link/conflict assessment. A non-merge `CO+RP` file uses a positive revision and `NO_MERGES`; full status must corroborate `Replaced / Checked-out (unchanged)`. Merge-associated `CO+RP`, directory variants and `CO+CP` remain unsupported. A status-admission rejection does not establish that workspace content needs repair.

Workspace merge completion correlates applying actions, pending paths and full-status source metadata:

| Applying declaration/action | Pending row | Required full-status operation |
|---|---|---|
| FILE_SRC / DO_COPIED | RP | Replaced with the same merge source |
| FILE_CONFLICT / DO_MERGE | CO | Checked-out (changed) with the same merge source |
| APPLY ADD / DO_COPIED | CP | Copied (new) with the same merge source |
| APPLY RM / DO_DELETED | DE | Removed with the same merge source |

Applying records and exit zero alone do not prove resolution. Checkin also requires complete marker and full-status observations, matching loaded identity/source link and selected scope. Unknown sections, annotations and contradictory directory relationships stop admission. Checkin events must cover merged controlled rows; additional CO events are allowed only for validated structural ancestor directories, not unrelated files.

Readiness remains point-in-time evidence, not transaction finality, target-head/source-link/exclusivity/other-workspace/Xlink proof. No automatic replay, force-finalization, backend fallback or compensation is introduced.
