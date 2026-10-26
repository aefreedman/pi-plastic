# Live workspace merge regressions

[Documentation index](README.md) · [Workspace observations](2026-10-26-workspace-observations.md)

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

## Scenario matrix

`PI_PLASTIC_LIVE_SCENARIOS` selects an exact comma-separated subset. Unknown names fail instead of silently selecting a different suite.

| Scenario | What it establishes |
|---|---|
| `mixed-forward` | Forward-slash Windows workdir; nested paths with spaces; real source/target divergence; auto-merged CO, RP, CP and deletion; both contributors' exact bytes preserved |
| `mixed-native` | Same workflow with native workdir spelling |
| `mixed-relative` | Same workflow with explicit relative workdir and controlled process cwd |
| `scope-private` | Selected standalone checkin leaves unrelated controlled bytes and private work uncommitted; independent history verifies selection |
| `merged-private` | Complete controlled merge scope may be checked in while explicitly excluding a disjoint private sibling |
| `merged-unrelated` | Valid merged rows plus an unrelated controlled edit are retained as observations but explicitly blocked by scope policy before checkin; not mislabeled as a parse failure |
| `no-op` | Already integrated source can be inspected/merged without inventing another changeset |
| `text-conflict` | Real overlapping edits create diff3 markers; closeout and standalone checkin stop; real process trace proves one applying merge, no checkin, replay, force or contributor discard; explicit owned-file reconciliation is tested afterward |
| `large-merge` | 130 source files: either complete verified integration, or an explicit bounded stop with all native pending paths retained—not silent prefix success |
| `unicode-path` | Unicode filename/content: either verified integration or an observable capture/encoding stop, with original path retained in independent UTF-8 XML; no lossy decoding fallback |

The default matrix runs the seven positive/real-conflict scenarios. Capacity, Unicode-path and `merged-unrelated` scope probes run **alone**, because a correctly bounded/encoding/policy stop deliberately retains a pending merge. For example:

```bash
PI_PLASTIC_LIVE_SCENARIOS=large-merge npm run test:live:merge
```

Supply the workspace/mutation/attestation variables too. A negative probe reporting `passed-state-preserved` proves the expected stop, not successful integration or a clean sandbox. Review its evidence and make an explicit recovery decision before another run.

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
