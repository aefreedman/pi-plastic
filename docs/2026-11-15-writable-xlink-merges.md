# Native writable-Xlink operations

[Documentation index](README.md) · [Merging](2026-10-06-merging.md) · [Receipts](2026-10-06-safety-and-receipts.md)

Workspace merge and checkin delegate Xlink behavior to Plastic. There is no adapter-owned mount inventory, ownership reconstruction, one-mount restriction, file-count limit or supported-status composition matrix. Native Plastic resolves sources, handles linked repositories and decides checkin eligibility.

## Requests and results

- `plastic_merge` forwards the exact native branch, changeset, label or shelveset operand with the selected noninteractive policy. It executes one applying command, without hidden ownership queries or checkin.
- `plastic_checkin` forwards the exact paths and explicit options once. It does not add private files, infer `applyChanged`, rewrite selected paths, broaden scope or retry a native rejection.
- Current-client checkin output may contain root and linked changeset identities together. Schema v2 retains their exact repository, server, branch and mount as observations. `createdChangeset` is the unique observed root emission, not proof of all requested effects; it can be null even when the command completed. `linkedChangesets` contains observed mounted emissions.
- Native nonzero exit, cancellation, timeout or unknown terminal state stops compound continuation. Native diagnostic grammar is not a second VCS permission system. Exit zero means command completion, not semantic merge correctness or an atomic cross-repository transaction.

`plastic_mergeToBranch` is a convenience sequence that starts from a clean workspace and no pending merge state, then switches/updates as requested, merges once and checks in once. Clean start protects against including preexisting work; it is point-in-time, not concurrency isolation. Use standalone operations when deliberately working with an existing pending merge or dirty workspace.

## Resource budgets

Diagnostic output is retained to 64 KiB stdout and 16 KiB stderr while both streams continue draining. Retention overflow never terminates a valid mutation. Execution/UTF-8/terminal evidence and diagnostic projection are separate; `completeness.projection=false` does not turn observed native completion into failure.

Changeset frames are observed incrementally, including after the diagnostic prefix is full. Identity memory is byte-bounded; omissions, malformed/oversized frames and ambiguous roots are explicit in `identityObservation`. They do not authorize replay or invent identities. Command arguments have an aggregate execution byte budget rather than a file-count cap. A large operation is not split into multiple mutations automatically.

## Live validation

Use an authenticated disposable workspace and a distinct existing synthetic linked repository. Supply the mutation opt-in, sandbox attestation and `PI_PLASTIC_TEST_XLINK_REPOSITORY`, then run `npm run test:live:xlink-merge`. The test creates unique owned fixtures with more than 32 changed linked files/tree entries, exercises standalone merge/checkin and full compound closeout, and independently verifies both repositories' history/ancestry and historical bytes.

The test does not create repositories/accounts/workspaces. Success restores the original clean branch/changeset; synthetic history remains. Failure preserves state. Raw native evidence stays outside the package and sandbox. See [live regression controls](2026-10-26-live-workspace-regressions.md).
