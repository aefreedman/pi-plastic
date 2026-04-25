# Troubleshooting

## Branch Already Exists

```bash
cm find branch "where name='/main/feature-name'"
```

## Cannot Switch (Pending Changes)

```bash
cm shelveset create --all -c="Auto-save before switch"
cm switch --silent --noinput /main/other-branch
```

- In unattended mode, `pendingChanges="bring"` is blocked only when tracked pending changes exist.
- Private-only pending changes do not require interactive bring; `plastic_switchBranch` now performs a direct switch.
- `pendingChanges="shelve"` may report `There are no changes in the workspace` when pending items are private-only;
  the tool recovers by skipping shelve and switching directly.

Agent preference: use runtime `plastic_*` methods first; keep shell commands as manual fallback.

## Code Review Creation Failed

- Use GUI or document changeset in plan/issue tracker.

## Reviewer Not Assigned

- Reviewer assignment is required for code review workflow.
- Preferred: gather branch/status via `plastic_status()` first, then assign reviewer in review edit flow.
- Shell fallback:

```bash
cm codereview -e <review-id> --reviewer="reviewer-name"
```

- If the reviewer flag differs in your server, use `cm codereview --help` and apply the equivalent reviewer option.

## GUI Opens When Using cm diff

- `cm diff` is blocked in Pi because it can launch GUI windows and hang the CLI.
- Use text-only alternatives:
  - `plastic_diffFile(path="Assets/Scripts/PlayerController.cs", revision="cs:123")`
  - `plastic_diffRevisions(leftRevision="Assets/Scripts/PlayerController.cs#cs:122", rightRevision="Assets/Scripts/PlayerController.cs#cs:123")`

## GUI/Prompt Opens During Merge

- Do not run interactive `cm merge --merge` in Pi.
- Preferred:

```text
plastic_merge(source="br:/main/feature-name")
```

- Shell fallback must be non-interactive and use safe auto-resolution:

```bash
cm merge br:/main/feature-name --merge --nointeractiveresolution --mergetype=try
```

- Explicit override (only when intentional):

```text
plastic_merge(source="br:/main/feature-name", strategy="destination")
plastic_merge(source="br:/main/feature-name", strategy="source")
```

- If Plastic reports a delete/change directory conflict and you intentionally want to accept the source-side deletion, use:

```text
plastic_resolveDeleteChangeConflict(paths=["Assets/Scripts/LegacyThing.cs"], keepOnDisk=true)
```

- Then rerun `plastic_merge(...)`.
- Even when `plastic_merge(...)` reports success, run `plastic_status()` before checkin. Merge output is not authoritative if Plastic still reports merge state.

## Merge Checkin Says Merge Is Still In Progress

- Symptom:
  - `plastic_merge(...)` reports `FILE_CONFLICT` paths or checkin later fails with a merge-in-progress error.
  - The files have been reviewed/resolved and compile/tests pass.
  - `plastic_status()` still shows pending merge metadata.
- Treat `plastic_status()` merge-state hints as the source of truth. Pending merge links are expected until checkin; explicit merge-in-progress hints are blockers.
- Recovery flow:
  1. Run `plastic_status()` and inspect merge-state details plus any `FILE_CONFLICT` paths reported by `plastic_merge(...)`.
  2. Resolve/review the listed files manually and run compile/tests as appropriate.
  3. Run `plastic_finalizeMerge(source="br:/source-branch", strategy="destination")` to finalize Plastic merge metadata while preserving the reviewed destination/manual result. Use `strategy="source"` only when accepting source is intentional.
  4. Run `plastic_status()` again.
  5. Retry `plastic_checkin(...)` after merge-in-progress hints are gone.
- If you are unsure whether the reviewed workspace result will be preserved, create a shelveset before finalizing.

## Invalid cm diff --summary Usage

- Do not use `cm diff --summary`; this form is invalid.
- Also avoid all other `cm diff` forms in Pi.
- Use the same text-only alternatives listed above.

## Deleted Files Missing From Checkin

- Run `cm status --all` and confirm deleted items are listed before checkin.
- Use `plastic_checkin(preflight=true, paths=[...])` first; the tool can auto-rewrite moved/deleted file scopes to parent directories.
- If a path-scoped checkin is rejected as "not changed", rerun with `applyChanged=true` and a parent-directory scope.
- Re-run `cm status --all` just before checkin to validate scope.

## Checkin says "No changes" but files were expected

- `includeAll=true` does not include private items automatically.
- `plastic_checkin` now pre-checks machine-readable status and can auto-add safe private files in scope,
  then retry checkin once when Plastic returns `There are no changes in the workspace`.
- If only sensitive private paths are found (for example `.env*`, key material, `.npmrc`, credentials/secrets JSON),
  auto-add is blocked and the tool returns an actionable error requiring explicit add/include choice.
- Check JSON metadata fields (`decisionPath`, `prePendingSummary`, `postPendingSummary`, `autoAddedPrivatePaths`,
  `blockedPrivateAutoAddPaths`) to understand what unattended recovery path was used.
