# Observed workflow profiles and limits

[Documentation index](README.md) · [Merging](2026-10-06-merging.md) · [Status](2026-10-06-status.md) · [Diffs and patches](2026-10-06-diffs-and-patches.md)

These bounded profiles were independently observed on Windows English CM 11.0.16.10484. They are not a promise of client-family, localization, Xlink, directory-conflict or binary-conflict support. Existing sourceAdmission labels identify historical source contracts, not the client or package revision currently loaded.

## Multi-file workspace merges and checkins

The resolved route admits repeated and mixed rows structurally rather than requiring one exact global status tuple:

| Applying declaration/action | Pending row | Required resolved full-status row |
|---|---|---|
| FILE_SRC / DO_COPIED | RP | Replaced with the same merge source |
| FILE_CONFLICT / DO_MERGE | CO | Checked-out (changed) with the same merge source |
| APPLY ADD / DO_COPIED | CP | Copied (new) with the same merge source |
| APPLY RM / DO_DELETED | DE | Removed with the same merge source |

Framing, decimal tokens, byte/record bounds and unique canonical paths remain strict. Each declaration/action must correlate with one controlled pending path and the requested source link, repository/server and loaded namespace. Added directories/children and deleted file/directory rows use their captured layouts; deleting a directory need not enumerate every removed descendant. Unknown or contradictory hierarchies remain unsupported. Size and age displays are bounded opaque cells, including bytes/KB/MB, blank directory sizes, and Deleted sections without an age column. They are not revision or resolution evidence.

**FILE_CONFLICT + DO_MERGE and exit zero do not prove resolution.** Independent unresolved experiments emitted those same records and a pending source link, without explicit in-progress text. Their CO/NO_MERGES rows and unchanged full-status rows stop before checkin. Failed/unknown observations never authorize replay or automatic finalization.

Standalone checkin now performs an additional merge-readiness read when required. Ordinary CO also needs native link-state observation because the unresolved control uses CO/-1/NO_MERGES. A preflight can therefore perform more than one read. Native checkin events must cover the merged controlled rows; extra CO events are admitted only for strict in-workspace structural ancestor directories, not arbitrary extra files. A single exact root branch/repository/server changeset and complete success capture are still required.

### Private and partial selection

For the expanded merged route, `includePrivate=false` explicitly excludes observed unrelated PR rows. They must be lexically disjoint from all merged controlled paths; directory ancestors/descendants and collisions fail closed. Exact correlated controlled operands are used when private work is present, never workspace-wide private addition. Extra unrelated controlled rows still stop. Partial merged selection and `includePrivate=true` remain unsupported for this route. Existing ordinary non-merged recovery rules are separate; this merged route never adds private files or retries a checkin.

The compound route independently rechecks readiness and loaded target before checkin. It never replays an applying merge, compensates with undo, or claims rollback. Observations are not an exclusive transaction or a source/head/Xlink guarantee.

## Reviewed result-file server merges

Analysis admits captured APPLY ADD/RM/FSPROT and supported discard-warning observations; applying admits captured ADD/RM with its stricter terminal-success rules. Analysis remains a read-only remote observation, not merge completion or approval to submit stale resolutions.

A FILE_CONFLICT candidate can become completed only with an admitted successful final root target changeset and exact stable reviewed result-file coverage. The new candidate-success route requires resultFile-only entries, no keep or unlisted-discard policy, and unique canonical conflict paths matching the candidate set. Existing keep-policy behavior outside this route is not broadened.

The caller's JSON is bounded to 1 MiB/500 entries; aggregate result bytes are bounded to 4 MiB. Inputs must be regular nonsymlink files at canonical absolute paths. Hash/identity observations are taken before help, revalidated before dispatch, and checked after completion. Missing, changed, extra or mismatched inputs leave completion unverified; observed emitted changesets remain recorded and must not be retried automatically. Inputs are never modified by the tool.

`parse.resolvedConflictsVerified` counts candidates with matching stable caller inputs, not general proof of server-stored result bytes. `parse.unknownOperationClasses` is a bounded closed set of sanitized classes; `unknownOperations` counts those classes, not arbitrary raw opcode strings. Exact emitted branch/repository/server spelling and root mount must match; alias equivalence remains unverified. Server comments admit bounded interior CR/LF only; other controls and malformed Unicode remain rejected.

These are point-in-time snapshots, not locks or atomic server-input guarantees. Keep all inputs and contributor heads immutable until completion. Independent validation loaded one synthetic typed result and checked exact bytes; that is evidence for the observed profile, not a verification automatically performed for every server merge.

## Inferred local moves

Status XML and machine observations admit the captured LM layout with separate authoritative old/source and new/destination paths. Optional `similarity` is a fraction in [0,1]. XML may expose more precision than the machine percentage; rounded display values are not asserted equal or used as identity. Empty/sentinel display timestamps do not become valid revision timestamps.

Unsafe, duplicate, colliding, foreign-root or malformed move endpoints remain rejected/incomplete. XML rejects an invalid whole document; machine can return partial data only with truthful completeness. This observation support does not authorize a rename, change the user's add/delete intent, expand checkin selection, or rewrite diff policy.

## Bounded diagnostics

Patch setup errors distinguish missing backend configuration, unverified selector repository and unavailable/existing output. On Windows configure `PI_PLASTIC_PATCH_EXECUTABLE` deliberately or pass a verified `toolPath`; the text-diff setting is not an automatic patch fallback.

Loaded-base diff errors distinguish fileinfo/ls profile, path/type, ownership and changeset/hash gates without echoing raw producer diagnostics. Large JSON presentations retain compact failure counts/reasons with indices referring only to returned structured outcomes. Historical files over the existing 4 MiB materialization cap are still rejected; `maxChars` controls output, not input bytes.

The exact supplemental fileinfo/ls profiles parse successfully while keeping loaded changeset, revision changeset and file revision ID distinct. They did not reproduce every historical asset diff failure. Improved diagnostics and regression evidence are not a claim that an unidentified historical cause has been fixed.
