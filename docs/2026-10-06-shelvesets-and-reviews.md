# Shelvesets and code reviews

[Documentation index](README.md) · [Find object IDs](2026-10-06-discovery.md) · [Safety and receipts](2026-10-06-safety-and-receipts.md)

Creation/application/update/deletion each returns its own bounded receipt. Preserve exact selectors and any earlier creation effects; do not chain on an inferred substring, hidden readback, or guessed namespace.

## Presentation versus CLI formatting

| Operation | Presentation | CLI template |
|---|---|---|
| Shelf create/apply; review create/update | `output="text"` or `output="json"`; default text | Creation review `format` remains an arbitrary CLI template |
| Shelf/review deletion | `format="text"` or `format="json"`; default text | No new custom output grammar |
| Shelf/review discovery | `output="text"` or `output="json"` | Native `format`/`dateFormat`; canonical ids source conflicts with meaningful templates |

Custom review creation stdout stays opaque even if it looks like an ID. Defaults, ordered controls/duplicates and qualifiers are preserved; the tool does not force a formatter to manufacture reusable identity.

## shelvesetCreate

```text
plastic_shelvesetCreate(paths=["Assets/Example.txt"], comment="Save owned work", summaryFormat=true, output="json")
```

One exact command preserves paths/all/dependencies/summaryFormat and exclusive comment/commentsFile. Omitted/empty path lists retain existing selection behavior; inspect intent before relying on broad scope.

Only an entire supported emitted default or summary `sh:` scalar is created-identity evidence. No IDs are parsed from progress or fragments. Emitted qualifiers remain exact; requested/emitted namespace equivalence is not inferred.

Comment-less creation with configured PLASTICEDITOR is refused before dispatch because it could launch an editor. Supply comment/commentsFile rather than overriding the environment. A command-only preflight still dispatches zero CLI commands.

Successful emitted identity remains recorded if stderr warnings make completion uncertain. Root/Xlink/global effects and omitted other-repository information are not independently verified.

## shelvesetApply

```text
plastic_shelvesetApply(shelveset="<exact observed shelf selector>", output="json")
```

Preserve selector, ordered changePaths, preview/dontCheckout and the documented comparison method. No automatic conflict input, strategy switch, readback/retry or undo.

| Option | Meaning |
|---|---|
| `preflight=true` | Render command only; no CLI, no existence/conflict analysis |
| `preview=true` | Real CM dispatch; can prompt/fail and does not prove no effects |
| `dontCheckout` | Exact requested CLI policy; not proof of preservation |
| `comparisonMethod` | ignoreeol, ignorewhitespaces, ignoreeolandwhitespaces, recognizeall |

A tracked text change on the same clean base has conflict-free preview/apply evidence. An added-item case prompted for evil-twin resolution and failed. This does not establish general safe unattended conflict resolution.

Complete apply output does not prove applied items/cleanliness/restoration; observedAppliedItems remains null. The agent can inspect state and choose an authorized resolution rather than assuming rollback or replay safety.

## codeReviewCreate

```text
plastic_codeReviewCreate(target="br:/main/owned-feature", title="Owned feature review", output="json")
```

Preserve target/title and optional status/assignee/repository/format. **Assign someone only when requested.** Creating a review does not authorize changing another person's assignment or opening a real review conversation.

An entire supported default numeric/GUID scalar can be emitted identity evidence. Custom stdout is always opaque; repository scope and requested review attributes stay unverified. A separate explicitly scoped query may provide its own identity evidence, never hidden creation verification.

### Creation and find use different format grammars

Installed CM 11 help documents creation `{0}` as ID and `{1}` as GUID. The positional formatter below completed in a fresh owned fixture:

```text
plastic_codeReviewCreate(target="br:/main/owned-feature", title="Owned formatted review", format="{0}|{1}", output="json")
```

The native receipt still reports observedCreatedIdentity=null for that custom format. A named `{id}|{title}` creation formatter failed with Invalid format string; no automatic substitution was performed.

`cm find review` is different: the sourced fields `{id}|{status}|{title}` work, but a find `{guid}` field failed. Do not infer support from inconsistent help examples. The canonical tool [ids source](2026-10-06-discovery.md#codereviewfind) returns numeric IDs without attempting GUID/title/status recovery.

## codeReviewUpdate

```text
plastic_codeReviewUpdate(id="<observed review ID>", status="Reviewed", output="json")
```

One exact `codereview -e` command preserves ID/selector plus optional status/assignee/repository. Empty optional review controls retain their existing omitted-flag behavior. No status enum redesign, assignment, readback or retry is added.

An empty successful stdout means command completion, not verified requested state. In bounded fixtures, directly scoped observations still showed Under review after one requesting Reviewed update. The producer reports observedUpdatedState=null/effect not-proven; it does not infer cause, no-op, absence or eventual consistency.

The agent may investigate the exact review and select a further authorized action. Uncertainty is not permission to repeat the mutation until an observation matches expectations.

## Object deletion

```text
plastic_shelvesetDelete(shelveset="<explicitly owned exact selector>", preflight=true)
plastic_codeReviewDelete(ids=["<explicitly owned ID>"], preflight=true)
```

Delete only when requested. Shelf deletion takes one scalar; review deletion preserves an ordered plural list, including duplicates, and optional exact repository spelling.

Preflight is a zero-CLI command preview, not existence/permission/readiness proof. Completion does not establish deletion of any/all objects, namespace equivalence, restoration, exclusivity, history effects or rollback. Native errors/core rejection preserve possible-start/partial/capture uncertainty; no hidden query/retry follows.

## Write/deletion bounds

| Bound | Create/apply/update | Delete |
|---|---|---|
| Ordered operands | Up to 256 where lists are supported | 1 shelf /1–256 review IDs |
| Controls | 4,096 UTF-16 code units | 4,096 UTF-16 code units |
| Aggregate request | 32,768 UTF-8 bytes | 32,768 UTF-8 bytes |
| Capture | 65,536 stdout /16384 stderr bytes |Same |
| Compact receipt | 524,288 UTF-8 bytes | 131,072 UTF-8 bytes |

Strict known keys, booleans, Unicode, list ownership and non-option operands are checked before dispatch. Explicit null, sparse/oversized lists, invalid modes and conflicting comments fail. Request/list snapshots precede await; aliases retain canonical precedence.

Writes expose full admitted stdout as opaque command output. Only supported whole creation scalars become identity. Apply/update/repository observed-state fields remain null; scope requested-only/rollback not-proven. Unpaired Unicode and inconsistent overflow/truncation claims fail semantic validation.

Shared retirement is the existing 30 second deadline plus bounded grace, not proof the process stopped. Failed applying calls can have effects; retained identity/partial effects survive uncertainty. See [safety and receipts](2026-10-06-safety-and-receipts.md#respond-to-failure-without-inventing-recovery).

## Workflow references

For operational guidance, load only [shelving](../skills/using-plastic/references/shelving.md) or [code-review creation](../skills/using-plastic/references/code-review-creation.md) when relevant. These remain package-local skill references, not instructions to create test fixtures, assign people or execute every example.
