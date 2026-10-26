# Workspace observations and safety assessment

[Documentation index](README.md) · [Merging and closeout](2026-10-06-merging.md) · [Workspace operations](2026-10-06-workspace-operations.md)

Native auto merge, standalone checkin and closeout share one pending-record model. Parsing retains ordinary controlled, merge-associated and private rows together, plus bounded diagnostic gaps. An operation-specific assessment decides whether those facts authorize checkin; recognizing one captured whole-workspace example is no longer the readiness contract.

- Caller workdirs are resolved/normalized once using their path dialect. Native Windows, forward-slash Windows and relative caller spellings identify the same directory. Observed paths remain lexical evidence: traversal, invalid identities, duplicate paths and out-of-workspace paths are not normalized into acceptable operands.
- Machine observations retain status, path, directory, revision token and merge-source changeset facts, independently of the displayed table.
- Full status supplies loaded identity, pending source links and unresolved/unknown-state evidence. Section, operation/path and source metadata must agree with machine facts. Size, age, whitespace column widths and section order are display only.
- Known English headings/metadata are still required; localization, unknown sections, extra/ambiguous links and unresolved binary/directory/non-text state do not become safe merely because markers are empty.
- The additive assessment contains readiness, completeness, row/link counts and up to eight specific blockers. Command completion remains recorded if a later observation fails; assessment failure does not imply merge rollback.
- Mixed merge-associated and unrelated ordinary controlled changes are valid observations but block automatic checkin with a scope blocker. Partial merged selection and private inclusion remain unsupported. Disjoint private-only extras are excluded with includePrivate=false.

Independent machine/full-status observations allow up to 499 pending rows within the existing 64 KiB capture bound. They do not inherit the legacy 128 applying-frame-pair limit. Explicit source/destination policies retain their narrow applying parsers and deliberate-discard semantics; their supported scope is not expanded by this redesign. Historical [observed profiles](2026-10-21-observed-workflow-profiles.md) document evidence provenance, not an exhaustive list of valid compositions.

Readiness remains point-in-time evidence, not transaction finality, target-head/source-link/exclusivity/other-workspace/Xlink proof. No automatic replay, force-finalization, backend fallback or compensation is introduced.
