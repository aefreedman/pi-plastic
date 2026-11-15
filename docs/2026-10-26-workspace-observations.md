# Workspace observations

[Documentation index](README.md) · [Merging](2026-10-06-merging.md) · [Workspace operations](2026-10-06-workspace-operations.md)

Read-only status tools report native workspace observations. Their parsing/completeness describes what was read, not permission for a subsequent VCS operation.

Schema v2 workspace merge and checkin do not reconstruct ownership, correlate applying records with pending rows, or require a particular file count, merge-link cardinality, status composition, table layout or source-tree profile. Plastic owns merge/checkin eligibility, including Xlinks. See [native Xlink behavior and resource budgets](2026-11-15-writable-xlink-merges.md).

## Checkin status admission

There is no adapter-owned status admission step for standalone checkin. Exact caller paths and explicit options go to one native command. A `CO+RP`, deleted, moved, directory or unfamiliar pending record is not by itself an adapter prohibition or a reason to repair workspace content. Inspect native errors and state rather than retrying automatically.

Compound closeout is different only because it automatically checks in: it requires complete initial observations showing no pending files or merge state, even when the target is already loaded. Any pending record blocks that convenience workflow without interpreting its owner or status. Use standalone commands for deliberate existing pending work.

## Completion and uncertainty

A complete native terminal exit zero establishes command completion. It does not prove semantic resolution, preservation, ancestry, branch-head exclusivity, global Xlink effects or atomicity. Bounded diagnostic truncation is a presentation fact, not execution failure. Failed execution or unknown terminal state stops automatic continuation without replay or compensation.
