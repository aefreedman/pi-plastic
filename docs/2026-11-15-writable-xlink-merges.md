# Bounded writable-Xlink merges

[Documentation index](README.md) · [Merging](2026-10-06-merging.md) · [Receipts](2026-10-06-safety-and-receipts.md)

## Supported subset

Native auto workspace merge, standalone merged checkin and compound closeout can correlate **one writable Xlink**, with one root and one linked pending source link. This is not general multi-repository merge support.

- The complete pending inventory contains **2–32 present file rows**, only `RP`, `CO` or `CP`, with at least one root and one linked row.
- Directory, deletion, move, private and unrelated controlled compositions are unsupported. Nested, multiple, read-only, ambiguous or contradictory mounts stop conservatively.
- Root and linked repositories must be distinct, on the exact same observed server spelling. Aliases are not unified. Identical numeric changeset IDs in different repositories do not establish ownership.
- Both recursive pinned mount inventories admit at most **32 entries**. There are at most **four ownership commands**, **32 KiB argv per command**, **128 KiB aggregate captured output**, and **32 KiB structured ownership evidence**. Existing per-process transport limits still apply. A limit is a stop, not prefix success.

Unknown observations do not authorize checkin. An applying merge can already have changed files before unsupported ownership becomes visible; preserve its state and inspect the receipt. Never replay the merge, force finalization, discard a contributor, or substitute a native checkin merely to obtain success.

## Ownership and source evidence

Ownership is read lazily only for the two-link candidate. Ordinary no-Xlink routes add no ownership queries.

1. One bounded `fileinfo --xml` response identifies every pending file's exact repository/server, Xlink membership, mount, writable flag and loaded linked target. Paths must remain inside the explicit workspace and agree with physical filesystem identities; missing files or symlink/path drift stop.
2. A separate mount `fileinfo` response must identify exactly that Xlink, its target and repository. A path prefix alone is never an owner.
3. Recursive mount metadata is read from the **exact loaded root changeset** and the **exact observed root source-link changeset**. The immutable source tree must point to precisely the linked pending source changeset, repository, server and branch. Moving branch heads are not substituted.
4. Every pending row must uniquely match its independently observed owner and source link. Complete standard status must still account for the rows and links without unknown conflict sections. Clear markers alone are insufficient.

A branch request is checked against the exact observed root source branch; a pinned `cs:` request is checked against the exact root link ID, with any supplied qualifiers retained. These observations do not lock source heads or establish an atomic snapshot.

Standalone checkin repeats ownership observation before mutation and requires the complete merged controlled scope. Partial path selections stop. Root item events must correspond exactly; current CM reports linked item effects through an exact mount `CO` event and linked emitted target identity rather than per-file events. Structural parent events cannot substitute for unrelated files or another mount. Linked emissions remain observations, not global Xlink-effect proof.

Compound closeout independently repeats machine/full-status and ownership checks before its checkin preflight and actual checkin. Complete child facts remain in the closed ledger, including linked emissions. A later failure retains earlier effects without automatic compensation.

## Live validation

Use only an authenticated disposable synthetic workspace and a **distinct existing** synthetic linked repository on its server. No additional repository, account or workspace is created by the test. Supply the existing mutation opt-in and sandbox attestation plus `PI_PLASTIC_TEST_XLINK_REPOSITORY`, then run `npm run test:live:xlink-merge`.

The test creates unique owned branches/fixtures and exercises standalone merge/checkin and full compound closeout. It independently verifies both repositories' target branches, source ancestry, historical bytes, exact pending scope and one applying merge/checkin per scenario. Success restores the original clean root branch/changeset; synthetic histories remain. Failure preserves state without destructive cleanup or retry. Raw evidence is private and external to the package and sandbox. See [live regression controls](2026-10-26-live-workspace-regressions.md).
