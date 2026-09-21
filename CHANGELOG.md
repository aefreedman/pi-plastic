# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning for public package releases.

## [0.7.4] - 2026-09-21

### Changed

- Update Pi development dependencies and validation baseline to 0.87.0.

## [0.7.3] - 2026-09-20

### Changed

- Update the Pi development dependencies and dynamic tool-loading eval contract to the 0.86.1 baseline while retaining explicit schema registration and sandbox authorization gates.

## [0.7.2] - 2026-09-19

### Fixed

- Stop pending-diff Xlink ownership discovery before querying the workspace root, allowing parent-repository base resolution while preserving linked-repository qualification and refusal on unresolved descendant ownership.
- Accept both `rep` and `repository` selector spellings when resolving workspace repository identity for pending diffs and shared selector consumers.

## [0.7.1] - 2026-09-17

### Changed

- Remove co-author attribution instructions and examples from conventional commit guidance.
- Remove the automatic co-author footer from default merge check-in messages.

## [0.7.0] - 2026-09-16

### Fixed

- Infer tool arguments from the schemas in `src/tool-definition.ts`, retaining required fields, optional fields, arrays, and literal enums instead of implicit `any` parameters.
- Use TypeBox schema guards and array-based unions in the adapter, and narrow Bash tool events directly in both safety guards.
- Add a pinned strict typecheck before the test suite, covering production sources, extensions, and compile-only argument-inference regressions.

### Changed

- Present Plastic tools and capability search with compact action headers, operation targets, and structured result summaries in Pi's existing tool boxes.
- Keep previews, blocked checkins, cancelled switches, uncertain server effects, unavailable comparisons, and output omissions visible; retain full returned evidence and colored diff hunks on expansion.
- Use Pi's wrapping components and configured expansion hint instead of manual character truncation and a fixed shortcut. Preserve original JSON numeric text and mask common credential assignments in display output.
- Add an offline tool preview and behavioral renderer tests covering outcomes, exact evidence, redaction, keybindings, registration, and narrow terminals.

## [0.6.1] - 2026-09-14

### Fixed

- Clarify that `cm cat --file` writes to and can overwrite its destination, including when stdout is redirected. Route ordinary baseline reviews through typed diff tools, require new external temporary destinations for necessary manual exports, and distinguish changeset numbers from file revision IDs.

## [0.6.0] - 2026-09-14

### Added

- Add `plastic_mergeBranches` for one bounded, workspace-free server-side merge between explicitly same-repository/server qualified branches. The command-only preflight never contacts Plastic; completed results require one emitted root-mount target changeset and retain unverified merge-link/xlink effects and uncertain no-op/conflict effects.

### Changed

- Pin the test runner as local devDependency `tsx@4.23.5` and make all package test, live-test, and eval scripts use that local executable instead of an opportunistic `npx` download.
- Update README's pinned GitHub installation examples to `v0.6.0`.

### Fixed

- Make `plastic_mergeBranches` JSON formatting side-effect free, enforce exact bounded machine-readable record framing/schema, and bound both local capability and merge process lifetimes without retrying uncertain dispatches.
- Stop workspace merge closeout before target-side mutation when its required switch is canceled for pending changes; the blocked result now includes typed pending context and `checkedIn: false`.
- Preserve qualified parent-lookup repository/server scope while matching documented local branch-name fields, and report bounded `cm find` failures instead of silently treating them as a missing parent; root and missing branches now remain distinguishable.

## [0.5.8] - 2026-09-15

### Fixed

- Resolve pending-diff workspace containment and Xlink ownership by filesystem identity when a workspace is accessed through a real filesystem alias, while retaining the caller's lexical path for Plastic commands and displayed paths. Missing deleted or moved ownership ancestors still fail closed.
- Retry only npm registry E404 availability checks for a bounded period after trusted publishing; a mismatched, malformed, or unauthorized release identity still fails immediately.

## [0.5.7] - 2026-09-14

### Fixed

- Bind automatic pending-file diff bases to the owning workspace or Xlink repository/server before materialization, preventing colliding revision IDs from another repository from producing plausible but unrelated diffs. Unresolved ownership is reported as unavailable.

## [0.5.6] - 2026-08-27

### Fixed

- Warn once per interactive Pi runtime when a configured `PI_PLASTIC_PATCH_EXECUTABLE` cannot launch or Windows lacks its required patch backend setting. Warnings redact configured paths; `plastic_patch` retains its existing tool-time validation.

## [0.5.5] - 2026-08-14

### Changed

- Made `plastic_status(machineReadable=true, format="json")` return compact parsed pending-item records, aggregate counts, and bounded-item metadata, with package-owned field separation and revision IDs. It returns at most 100 items by default (configurable up to 500); raw, unbounded Plastic output is omitted by default and available with `includeRaw=true` only for diagnostics.

## [0.5.4] - 2026-08-13

### Fixed

- Recognize both `smartbranch` and `br` branch forms in Plastic workspace selectors, including quoted values produced by different checkout workflows.
- Use a valid local selector as the footer's authoritative branch source instead of launching an unnecessary `cm status` process; malformed or missing branch selectors retain the bounded CLI fallback.

## [0.5.3] - 2026-08-09

### Changed

- Clarified executable routing: macOS bare `diff` is PATH-dependent and may be GNU Diffutils or Apple BSD `diff`; text-diff selection does not auto-select `gdiff`. Plastic 11 macOS validation confirmed that Apple BSD `/usr/bin/diff` supports text diffs but rejects `cm patch`'s `--binary` argument, so `plastic_patch` now identifies that contract failure and directs callers to the separate GNU Diffutils-compatible patch executable policy.

### Fixed

- Made historical and workspace text diffs Unicode-safe for the configured Windows backend: package-owned ASCII materializations are the only operands passed to `diff`, while returned unified headers retain stable logical Unicode labels.
- Report an added empty pending file as `added-empty` with explicit text/JSON/workspace semantics instead of generic unchanged.
- Clean package-owned `cm cat --file` outputs after retrieval failures, including failure-created zero-byte files; public guidance now treats `cm cat --raw` as unsupported and names typed retrieval or `cm cat --file` as the byte-preserving fallback.
- Documented patch moved-item encoding as backend-determined (move-aware or delete/add) rather than claiming unverified runtime behavior.
- Hardened `plastic_patch` on Windows: it now uses the dedicated `PI_PLASTIC_PATCH_EXECUTABLE` policy (or an explicit `toolPath`) instead of silently reusing the incompatible GnuWin32 text-diff backend, qualifies unqualified branch selectors against the exact current workspace repository, and rejects ambiguous selectors before `cm patch`.
- Made requested patch output transactional: existing paths are rejected before generation; package-owned sibling staging is validated and atomically published only on success, with failed and zero-byte staging artifacts removed.
- Reject branch-switch and merge-closeout success when the workspace is not actually on the requested target branch, including checks after target update, before merge checkin, and after checkin.
- Clarify that Plastic merge checkins belong to the branch loaded in the workspace and cannot be integrated by switching branches afterward like a Git fast-forward.

## [0.5.2] - 2026-08-05

### Fixed

- Hardened the Bash GUI-diff guard for Plastic's `differences` alias, quoted subcommands, common CMD and PowerShell wrappers, `call`/`start`, `Start-Process`, CMD caret escaping, and direct `!`/`!!` shell commands; the internal process guard now rejects the alias too.
- Added runtime-handler coverage and documented that user-scope installation is required to protect delegated Pi processes whose working directory does not load the originating project's package settings.

## [0.5.1] - 2026-08-05

### Changed

- Clarified that preflight is situational rather than routine and that status, focused tests, and direct reads should precede intentional diff output.
- Reduced agent-facing diff defaults, added caller-controlled body bounds and complete JSON response bounds, required selected paths or explicit `allPending=true` for workspace diffs (including direct-call guards), and limited generic diff discovery to one focused tool.

## [0.5.0] - 2026-08-05

### Added

- Added dynamically loadable `plastic_workspaceDiff` for bounded pending review: one machine-readable status pass, per-file text/binary/unavailable outcomes, selected-path and private-file policy, and intentional file/output limits.

### Changed

- Kept GNU/POSIX `diff` as the only text-diff backend, improved `PI_PLASTIC_DIFF_EXECUTABLE`/bare-PATH diagnostics (including Windows-like missing-diff guidance), and removed unused Git diff fallback code.
- Made workspace `plastic_diffFile` use machine-readable pending status for private/new, added, changed, moved, and deleted comparisons; status revision IDs materialize safe bases and `--nodata` base failures now explain recovery.
- Updated diff routing guidance: changed listing uses `plastic_status`, one file uses `plastic_diffFile`, pending review uses `plastic_workspaceDiff`, and explicit historical pairs use `plastic_diffRevisions`.

- Replaced the optional `@aefree/pi-repo-search` integration with `@aefree/pi-file-discovery`. Plastic ignore/cloak data is now an advisory file-discovery filter: only roots with readable ignore/cloak files emit `filterDecision: "applied"` records with a nearest-workspace `filterBoundary`; no-op roots are omitted and unavailable or malformed filter data degrades to generic discovery as routine execution hygiene.
- Register the optional Plastic filter through the package-qualified global capability-registry rendezvous instead of importing `pi-file-discovery` from Plastic's separate module root. Registration remains session-scoped, transactional, and safe against stale shutdown tokens.
- Excluded development-only tests and behavioral evals from published npm artifacts.
- Publish verified GitHub releases to npm through resumable OIDC trusted-publishing automation, and canonicalized the package repository URL for GitHub identity matching.

## [0.4.0] - 2026-08-01

### Added

- Added bounded portable `plastic_diffFile`/`plastic_diffRevisions` output metadata, explicit binary results, temporary historical-content cleanup, Unity-YAML-as-text coverage, revision validation, and Windows GNU `diff` regression coverage.

- Added session-scoped generic repository-search policy. The policy safely discovers bounded `ignore.conf`/`cloaked.conf` chains.
- Added actual package-root/version owner discovery at the extension boundary and packed-copy owner-conflict coverage.
- Added direct mutation execution coverage proving one exact `cm` process attempt with no approval context and no implicit retry.

- Added a composable `plastic-branch` footer status with nearest-workspace discovery, selector fallback, bounded `cm` confirmation, and debounced same-workspace refresh.
- Added credential-free workspace, selector/status parser, footer composition, and lifecycle cleanup coverage using sanitized fixtures.
- Added an opt-in, local-only branch-creation test for contributor-authenticated disposable Plastic repositories.

### Changed

- Made `@aefree/pi-repo-search` an optional peer: Plastic ignore/cloak policy registration is enabled when the package is installed, while core Plastic tools and skills load normally without it.

- Made `plastic_diffFile(path=...)` default to the workspace Plastic base, route changed-file questions to `plastic_status`, and document supported advanced revision forms without agent-authored `cm cat` temporary-file recipes.

- Updated the Pi development baseline to 0.83.0.

- Removed the `vcs.plastic` workflow provider, its marker/readiness/preflight/guidance integration, and the unused optional `@aefree/pi-workflow` dependency. Repository-search policy remains independently registered and Plastic tools retain operation-specific validation.
- Stopped registering or dynamically advertising `plastic_workspaceCreate` until workspace creation has a paired, safe cleanup capability.
- Plastic repository policy outputs now declare the canonical marker-owned `policyOwnedRoot` boundary used by repo-search physical ignore-file containment.
- Canonical contract packages are normal semver dependencies rather than bundled local links, preventing sibling/`node_modules` path leakage in packed tarballs.
- Shared Plastic status branch parsing with `plastic_currentBranch` while preserving its `cm`-authoritative source policy.
- Made `plastic_branchCreate` support an explicit parent branch independent of the loaded workspace branch, default relative names to the current branch when omitted, and reject accidental top-level branches unless `allowRootBranch=true` is explicitly supplied.
- Removed package-owned token and UI-confirmation approval from Plastic mutations. Direct calls now proceed through the existing command, workspace-readiness, exact-target, path-containment, and process-safety checks to one `cm` process attempt without implicit retry.

## [0.3.0] - 2026-07-25

### Added

- Added `plastic_tool_search`, a bounded package-owned dynamic loader with explicit Plastic aliases, tags, and selected-tool safety guidance.
- Added balanced, loader-only, and all-active initial tool-loading modes through `PI_PLASTIC_TOOL_LOADING_MODE`, plus active-branch restoration of valid historical loader additions.
- Added harness coverage for dynamic tool composition, search, additive activation, restoration, and deferred prompt-metadata behavior.
- Added a package-local dynamic tool-loading behavioral eval with fresh Pi JSON subprocesses, bounded configured cases, implicit discovery coverage, exact smallest-sufficient activation checks, preflight-only mutation guarding, sandbox attestations, provider-schema capture hygiene, and ignored sanitized result summaries.
- Added an opt-in, read-only live smoke test for dedicated Plastic sandbox workspaces.
- Added a compatibility audit that prevents JSON-schema constrained sampling from being enabled on schemas that OpenAI strict tools would reject.
- Added cross-platform Windows, macOS, and Linux validation plus a manually dispatched, tag-verified GitHub Release workflow.
- Added Dependabot configuration, contribution and security policies, and repository-wide text/ignore conventions.

### Changed

- Declared Pi 0.82 and TypeBox development dependencies so the expanded test suite installs reproducibly while keeping runtime peers optional.
- Declared the supported Node.js engine, expanded package metadata, added an explicit tarball allowlist and reproducible development lockfile, and documented pinned HTTPS and SSH installs.

### Fixed

- Allow eval validation on compatible Pi 0.82 patch releases instead of rejecting every version except 0.82.0.
- Resolve relative Pi extension provenance paths against their canonical extension base directory so standard relative `--extension` loading retains dynamic activation.
- Fail safe when canonical Pi `sourceInfo` provenance or effective loader ownership is unavailable: preserve the active set exactly and never activate or defer an unproven `plastic_*` name.
- Fixed full-path branch existence checks by querying Plastic's leaf-name field and validating the returned full branch path.

## [0.2.4] - 2026-07-24

### Changed

- Marked Pi-bundled core dependencies as optional peers so Pi git installs do not create redundant per-package `node_modules` directories.

## [0.2.3] - 2026-07-10

### Changed

- Migrated Pi extension imports and peer dependencies to the `@earendil-works` package scope, and removed the unused `pi-ai` peer dependency.

### Fixed

- Normalize Windows-style absolute and relative checkin paths with Windows path semantics even when validation runs on another operating system.

## [0.2.2] - 2026-07-09

### Fixed

- Preserve case distinctions on case-sensitive Darwin/APFS volumes while still matching paths case-insensitively on detected case-insensitive volumes and Windows, without inferring a mounted volume's policy from its parent filesystem.
- Make spawned Plastic command cancellation escalate based on terminal process settlement, with prompt listener and timer cleanup.
- Report actionable diagnostics when the Plastic or Git executable cannot be launched.

### Added

- Support `PI_PLASTIC_CM_EXECUTABLE` and `PI_PLASTIC_GIT_EXECUTABLE` executable-path overrides.
- Add macOS CI coverage for tests and package validation.

## [0.2.1] - 2026-06-27

### Changed

- Changed `plastic_mergeToBranch` so an omitted target resolves to the source branch's Plastic parent branch instead of assuming `/dev`.

## [0.2.0] - 2026-06-27

### Added

- Added `plastic_mergeToBranch`, a safe closeout helper that switches to a target branch, optionally updates, merges a source branch non-interactively, verifies merge state, and checks in the merge result.
- Documented the closeout merge helper in the README and `using-plastic` skill.

## [0.1.0] - 2026-04-27

### Added

- Initial Plastic SCM / Unity Version Control package with status, branch, merge, checkin, shelveset, patch, diff-safe, and code-review tools.
