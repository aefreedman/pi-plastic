# Workspace operations

[Documentation index](README.md) · [Safety and receipts](2026-10-06-safety-and-receipts.md) · [Merging](2026-10-06-merging.md)

These tools act on explicitly requested workspace/branch scope. Command completion and resulting-state verification are separate. Prefer exact paths; broad directory/wildcard intent is not an exclusivity or containment guarantee for every operation.

## Choose an operation

| Tool | Intent | Receipt boundary |
|---|---|---|
| add | Add requested path operands | Added-item identity remains unverified |
| update | Update with dontmerge/noinput | Changed items, branch/head, preservation and cleanliness unverified |
| undo | Undo requested paths | Restored bytes, undone-item count and cleanliness unverified |
| checkin | Check in selected pending work | Can admit an emitted root changeset; head/link/alias/Xlink/exhaustion unverified |
| branchCreate | Create a hierarchical branch | Command completion, not observed created-branch identity |
| branchDelete | Delete an exact branch | Command completion, not deletion/history/rollback proof |
| switchBranch | Apply pending policy and switch | Ordered stage evidence; post-observation may remain uncertain |
| resolveDeleteChangeConflict | Request source-side removal | Not verified conflict resolution or retention |

Examples below are Pi tool calls and assume separately authorized mutation targets.

## add

```text
plastic_add(paths=["Assets/Example.txt"])
```

One `cm add` attempt preserves ordered path expressions, duplicates, spaces/Unicode, relative/absolute paths, directories and requested wildcards. It does not rewrite or expand them in the producer.

The array is not an option/stdin channel. Hyphen-leading or whitespace-prefixed switches and `-` are rejected; use `./-name` for a literal hyphen-leading filename. No automatic recursion/coparent/ignorefailed flags, containment inference, readback/retry/undo/checkin, format or preflight is added.

Valid complete exit 0, including admitted warnings, establishes command-completed only. Requested operand count is not a verified added-item count; expanded/other-workspace/symlink/Xlink scope and preservation stay unverified. The separate internal checkin add path is unchanged.

## update

```text
plastic_update()
```

Only workdir is accepted. Dispatch remains `cm update --dontmerge --noinput`, at most once, with no status/version/verification read or retry. No preview API is added.

Complete exit 0, including admitted warnings, is not a verified no-op, changed-file list, workspace root, branch/head, preservation, cleanliness or merge readiness. Opaque progress is not returned as structured state. Failure stops dependent core closeout before merge/checkin.

## undo

```text
plastic_undo(paths=["Assets/Example.txt"])
```

**Undo can irreversibly discard work.** The one-command path preserves exact requested expressions, ordering and duplicates. Broad paths/patterns do not certify exclusive scope.

Reject CLI options/filters such as `--added`, `--unchanged`, `-r`, `--symlink`, whitespace-prefixed flags and stdin `-`. A filter without a path could imply destructive cwd-wide scope. Use `./-name` for a literal. No automatic filters/recursion/symlink/force flags, backup, preview/format, readback/retry or rollback.

Even complete exit 0 cannot establish restored bytes, preservation or zero pending items. Choose independent scoped inspection when needed.

## checkin

```text
plastic_checkin(message="Save selected changes", paths=["Assets/Example.cs"], applyChanged=true)
```

Schema v2 forwards exact caller paths and explicit `includeAll`, `applyChanged` and `includePrivate` options to one native checkin. It does not inspect/rewrite pending scopes, infer flags, automatically add private files, fall back to parent paths or retry. Native Plastic decides whether the selection is eligible. `includeAll` is forwarded even with explicit paths; it applies within the native selection, not an implicit wider workspace selection. `updateAfter=true` remains disabled for unattended safety.

`preflight=true` builds the exact command without executing any CLI read or mutation. It does not analyze pending scope or conflicts.

The v2 receipt separates `commandCompleted`/actual attempt and exit from `createdChangeset`, `linkedChangesets`, `observedChangesets` and `identityObservation`. A successful command can have unknown identities. Well-formed emitted identities remain observations even alongside a later native failure; they do not establish every requested effect. Current-client comma-separated mounted identity lists are supported without a one-Xlink or fixed emission-count admission rule. Ambiguous roots stay null.

Output retention is bounded while draining the native process; diagnostic truncation does not terminate the mutation. Identity frames are observed separately after the retained prefix fills. Incomplete identity observation or presentation does not erase actual terminal success. Failed execution/unknown terminal state is never permission for automatic retry.

Standalone checkin accepts deliberately selected existing pending work; [compound closeout](2026-10-06-merging.md#mergetobranch) additionally requires a clean start because it chooses an automatic checkin. See [native Xlink behavior](2026-10-06-merging.md#xlinks).

## branchCreate

```text
plastic_branchCreate(branch="owned-feature", parent="/main")
```

Use an explicit parent independently of the loaded branch. If omitted, relative names require directly observed standard-status loaded branch; compact changeset-only status or a changeset-owner query cannot provide the parent.

- Qualified relative names/parents are rejected rather than losing scope; use a full qualified hierarchical target.
- Full hierarchical qualified targets remain verbatim.
- Top-level creation requires explicit `allowRootBranch=true`.
- A successful complete exit 0, even empty stdout, supports command completion with observedCreatedIdentity=null/effect not-proven.
- No automatic switch, verification query or branch-create preflight is added.

## branchDelete

```text
plastic_branchDelete(branch="/main/owned-feature", preflight=true)
```

One exact bounded branch operand and deleteChangesets policy are recorded. `deleteChangesets` defaults false; enable history deletion only with explicit intent. Preflight is a zero-CLI command plan, not existence/permission/readiness analysis. `format="text"|"json"` is presentation.

Relative/qualified spelling is preserved; options/stdin/unsafe text are rejected. Complete exit 0 does not prove deleted branch identity, history effects, scope or rollback. Possible-start/nonzero/incomplete failures remain uncertain, with no query, retry or switch-back. Core non-preflight failures reject.

## switchBranch

```text
plastic_switchBranch(branch="/main/owned-feature", pendingChanges="cancel", preflight=true)
```

The closed v1 receipt distinguishes preflight, already-loaded, canceled, blocked, switched, command-completed-unverified, failed and uncertain. Earlier shelf/switch completion and possible effects remain after later failure; shelveset identity, preservation, alias equivalence, Xlink results and rollback are not invented.

Admission requires directly observed standard loaded branch and strict complete pending evidence. Compact changeset ownership is not a loaded branch; malformed/lossy/skipped pending rows never mean clean.

Targets are bounded hierarchical selectors. Already-loaded comparison requires exact branch and, if requested, exact repository/server spelling. A completed switch with failed/mismatched post-read or unverified qualification returns an error retaining completion—not verified switched.

### Pending policies

- Tracked bring is blocked; explicit cancel with pending is canceled.
- Private-only/defaulted cancel, bring, or shelve can switch directly without a shelf under the existing policy.
- Tracked shelve creates a shelf then uses silent/noinput switch.
- Recovery is limited to the complete exit 1 empty-stdout workspace-specific no-changes error plus an admitted read proving no tracked pending. Failed recovery stops, never substitutes empty.
- Failed shelving retains uncertain preservation even if recovery observes the target. No automatic undo, shelf apply/delete, update/checkin or switch-back follows.

Preflight performs 2 local reads. Direct application uses 4 commands, shelving 5, eligible recovery at most 6; observations are not atomic. Pending capture: 1 MiB stdout/64 KiB stderr, 20,000 records. Other steps: 64 KiB/16 KiB. Receipt: 6 steps/131072 UTF-8 bytes; identities 4,096 code units and admitted standard-header grammar.

## resolveDeleteChangeConflict

```text
plastic_resolveDeleteChangeConflict(paths=["Assets/Example.txt"], keepOnDisk=true, preflight=true)
```

One `cm remove [--nodisk] <operands...>` requests source-side deletion. `keepOnDisk=true` is the default; explicit false omits nodisk and permits disk deletion. Requested retention is not a preservation guarantee, and requested operand count is not a resolved-item count.

Directory removal is recursive under client defaults. Deliberate directories/wildcards/absolute operands do not certify exclusive scope, containment, symlink, other-workspace or Xlink effects. No automatic flags/expansion/backup/readback or merge continuation.

Reject option/stdin operands and bare case-insensitive, outer-whitespace `private`/`controlled` mode tokens anywhere. For literal names use `./private`, `./controlled`, `./-name`, or a full path. Preflight is zero CLI; format selects text/JSON. Completed output, including admitted warnings, proves remove completion only; resolution/items/preservation/pending/workspace facts remain null.

## Shared capture and input limits

Add/undo/remove path lists: 1–256 operands, 4,096 UTF-16 code units each, 32,768 aggregate UTF-8 operand bytes; workdir 4096. Branch/checkin controls have their own aggregate schema/argv gates; see the loaded schema and operation-specific bounds above.

Selected single-command captures retain 64 KiB stdout/16 KiB stderr with fatal UTF-8/BOM preserved. Nominal retirement is 30 seconds plus 5 seconds TERM→KILL grace and at most 5 seconds additional drain. Earlier abort/capture failure can initiate that grace sooner. Retirement preserves genuine observed lifecycle facts but is not process-stop or rollback proof.

Nonzero/partial/invalid-UTF-8/overflow/abort/missing-terminal outcomes remain failed/uncertain as declared. Core failures reject, while native failures return their receipt. Legacy read and internal collectors are not globally migrated by these bounds. See [transport limitations](2026-10-06-development.md#structured-api-and-transport) for SDK normalization and foreign-hook behavior.
