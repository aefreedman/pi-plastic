# Live workspace merge regressions

[Documentation index](README.md) · [Workspace observations](2026-10-06-merging.md#workspace-observations)

The opt-in live suites complement captured fixtures. They exercise the registered tools from the current source checkout against real CM processes, then independently inspect resulting bytes, native status XML, branch identity, changeset history and source ancestry. Schema validity alone is not acceptance.

## Choose the exact sandbox

Use an authenticated, dedicated disposable synthetic Plastic workspace. Never point these tests at production, private project content, or a workspace another agent is using. Inspect its current branch and pending state first. The suite refuses pending files, merge links or tracked markers; it does not assume the branch is `/main`.

All calls pass the exact sandbox workdir explicitly. Registration source identity and checkout revision/dirty state are recorded. No provider-backed agent, credential provisioning, package installation, backend retry, or alternate executable route is involved.

Read-only smoke:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/disposable-workspace npm run test:live
```

Mutation matrix:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/disposable-workspace \
PI_PLASTIC_ALLOW_MUTATION_TESTS=true \
PI_PLASTIC_SANDBOX_ATTESTATION=disposable-synthetic-only \
npm run test:live:merge
```

The three environment settings are deliberate separate choices: exact target, mutation permission, and a declaration that the workspace content is disposable/synthetic. An absolute path is mandatory; symlinks are resolved. There is no configured machine-specific workspace default. PowerShell users can set the same names through `$env:` before running npm.

## Pinned-changeset and loaded-base diff regression

With the same workspace, mutation permission and attestation settings, run `npm run test:live:pinned-merge`. It creates unique source/target branches, verifies implicit loaded-base unchanged/changed diffs against the current client, applies one pinned changeset merge with divergent contributors, checks in through the registered tool, and independently verifies exact content and source ancestry. An explicit already-integrated no-op merge must not create a changeset. Success restores the original clean branch/changeset; failure preserves state without replay or native checkin workaround. This single-repository scenario does not establish Xlink support.

## Writable-Xlink checkin regression

`npm run test:live:xlink-checkin` additionally requires `PI_PLASTIC_TEST_XLINK_REPOSITORY` naming a distinct existing disposable synthetic repository on the sandbox server. The test does not create repositories or additional workspaces. It mounts that repository's empty changeset 0 under a unique run-owned directory, checks in root/linked edits through the registered tool exactly once, and independently verifies both histories and historical bytes. Success restores the original clean root branch/changeset; synthetic branches/history remain. This proves root identity retention and linked emission observation. The separate `npm run test:live:xlink-merge` validates the [native Xlink workflow](2026-10-06-merging.md#xlinks) through standalone and compound routes, with independent both-repository ancestry/content and no applying replay.

## Replaced-checkout regression

With the same exact disposable workspace, mutation permission and attestation settings, run `npm run test:live:replaced-checkout` for the standalone `CO+RP` checkin profile. It creates two synthetic revisions on a unique descendant branch, reverts only its owned file to the earlier revision (which checks it out), and requires native `CO+RP` with a positive revision and `NO_MERGES`. It verifies a zero-command preflight, one typed checkin, exact reverted bytes and native changeset history, then restores the original clean branch. On failure it preserves state without undo, retry or a native checkin workaround.

## Scenario matrix

`PI_PLASTIC_LIVE_SCENARIOS` selects an exact comma-separated subset. Unknown names fail instead of silently selecting a different suite.

| Scenario | What it establishes |
|---|---|
| `mixed-forward` | Forward-slash Windows workdir; nested paths with spaces; real source/target divergence; auto-merged CO, RP, CP and deletion; both contributors' exact bytes preserved |
| `mixed-native` | Same workflow with native workdir spelling |
| `mixed-relative` | Same workflow with explicit relative workdir and controlled process cwd |
| `scope-private` | Selected standalone checkin leaves unrelated controlled bytes and private work uncommitted; independent history verifies selection |
| `merged-private` | Complete controlled merge scope may be checked in while explicitly excluding a disjoint private sibling |
| `merged-unrelated` | Exact selected merged paths are dispatched once; native Plastic decides eligibility while unrelated/private fixture work is independently checked |
| `no-op` | Already integrated source can be inspected/merged without inventing another changeset |
| `text-conflict` | Real overlapping edits create diff3 markers; closeout and standalone checkin stop; real process trace proves one applying merge, no checkin, replay, force or contributor discard; explicit owned-file reconciliation is tested afterward |
| `large-merge` | 130 source files exercise native completion and bounded diagnostic projection, without a semantic file-count admission rule |
| `unicode-path` | Unicode filename/content: either verified integration or an observable capture/encoding stop, with original path retained in independent UTF-8 XML; no lossy decoding fallback |

The default matrix runs the seven positive/real-conflict scenarios and can take several minutes. Give the outer command runner at least a 15-minute deadline, or select one scenario per invocation and inspect its completed result before starting the next. Individual CM calls remain bounded at 30 seconds. An outer timeout is an infrastructure failure, not a failed merge-normalization assertion: inspect the exact run's evidence and current sandbox state before any new attempt; do not replay an uncertain mutation.

Capacity, Unicode-path and `merged-unrelated` scope probes run **alone**, because a correctly bounded/encoding/policy stop deliberately retains a pending merge. For example:

```bash
PI_PLASTIC_LIVE_SCENARIOS=large-merge npm run test:live:merge
```

Supply the workspace/mutation/attestation variables too. A probe reporting `passed-state-preserved` proves only its recorded stop/state, not successful integration or a clean sandbox. Review its evidence and make an explicit recovery decision before another run.

Positive mixed scenarios use ASCII/space-containing paths with Unicode UTF-8 file content. This avoids confusing the client's historical non-UTF-8 display encoding with successful Unicode path support. The separate Unicode-path probe tests that boundary rather than weakening capture validation.

## Owned state and failure policy

Each run creates unique descendant branches beneath the initially loaded branch and writes only its own uniquely named directory under `fixtures/`. Setup uses ordinary native branch/add/checkin operations; changed-but-not-checked-out fixture bytes are explicitly included in setup checkins. This does not authorize force-finalizing an unresolved merge or recovering the tool under test with a second applying call.

Successful matrix runs independently verify clean state and restore the original branch at its original changeset. Synthetic branches and changesets remain as inspection evidence; repository history is not deleted. Exact known private fixture files are removed only in their scenario's explicit teardown. No broad undo or wildcard deletion occurs.

On an unexpected failure, execution stops. There is **no destructive finally cleanup**, automatic switch of a dirty workspace, merge replay, force, marker bypass, or CLI checkin workaround. Preserve the pending merge and inspect recorded source/target/owned paths before choosing recovery. A failing baseline run must not be reported as a passing live test merely because manual CLI recovery subsequently succeeds.

## Evidence and methodology

Each run writes `observations.jsonl` and `summary.json` to a new private temporary directory. Optionally set `PI_PLASTIC_LIVE_EVIDENCE_DIR` to an explicit external directory; package and sandbox-contained destinations are rejected. These artifacts contain native outputs, coordinates, local paths and full structured receipts: **never commit or publish them**.

The process trace wraps the real execution seam and launches the actual executable; it does not synthesize stdout. Setup and independent observations are separately labeled. The summary identifies selected outcomes, original branch, retained run-owned state and cleanup status. Console output names the private evidence directory without dumping raw repository metadata.

For a redesign/regression investigation, run the same scenario against the baseline and candidate source. Record both revisions and exact scenario selections. Keep failures, partial effects and infrastructure errors distinct. Live execution is bounded per CLI process, with no timeout retry or fallback. A client/platform observation is not universal support or an atomic repository snapshot.

`npm run test:live:contract` is credential-free and runs no CM commands. It validates opt-in/attestation behavior and ensures unknown/malformed independent pending XML cannot be interpreted as a clean workspace. Default `npm test` includes these harness controls. The ordinary deterministic suites still own malformed transport, cancellation, synthetic warning, and schema-semantic adversarial coverage.

## Native workspace receipt v2 probes

With the same disposable-workspace mutation settings, `npm run test:live:selectors` verifies native label and shelveset operands and exact historical bytes. `npm run test:live:pinned-merge` covers pinned sources, no-op and loaded-base diffs. `npm run test:live:xlink-checkin` and `npm run test:live:xlink-merge` additionally require an existing synthetic `PI_PLASTIC_TEST_XLINK_REPOSITORY`; the merge suite changes more than 32 linked files and independently verifies both repository histories/ancestry and historical bytes, without ownership-proof queries.

`PI_PLASTIC_LIVE_SCENARIOS=scope-private,text-conflict npm run test:live:merge` verifies exact standalone selection alongside unrelated/private work and genuine native marker refusal. Compound closeout stops after the failed merge; a separately requested standalone checkin reaches Plastic once and is refused by native eligibility. The owned text fixture is deliberately reconciled afterward, with no merge replay or marker bypass.

`npm run test:live:conflict` exercises a genuine binary conflict and requires zero automatic checkins after native merge failure. It deliberately preserves the unresolved synthetic fixture and reports `passed-conflict-state-preserved`; this is not a clean sandbox or completed merge. Obtain an explicit recovery decision before another sandbox mutation. Clear marker listings alone do not establish binary merge completion.
