# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning for public package releases.

## Unreleased

### Added

- Added session-scoped generic repository-search policy and specialized `vcs.plastic` workflow provider registration. Marker applicability is distinct from `cm` readiness; the policy safely discovers bounded `ignore.conf`/`cloaked.conf` chains and provider-owned guidance resources.
- Added exact, bounded `LegacyReferenceServiceV1` registrations for the four pi-plastic rows in the compatibility map, backed by byte-exact pinned 0.6.4 payload copies with package/resource provenance and load-order/lifecycle coverage.
- Added actual package-root/version owner discovery at the extension boundary and packed-copy owner-conflict coverage.
- Added exhaustive centralized Plastic mutation-command inventory tests with spawn spies, exact matching success, direct TUI/RPC confirmation, and fail-before-spawn replay/action/target/session/expiry cases.

- Added a composable `plastic-branch` footer status with nearest-workspace discovery, selector fallback, bounded `cm` confirmation, and debounced same-workspace refresh.
- Added credential-free workspace, selector/status parser, footer composition, and lifecycle cleanup coverage using sanitized fixtures.
- Added an opt-in, local-only branch-creation test for contributor-authenticated disposable Plastic repositories.

### Changed

- Plastic workflow preflight now re-detects and verifies the selected canonical workspace and requires a bounded, cancellable `cm status` readiness check; missing CLI, authentication/readiness failures, timeouts, root changes, and oversized output block Plastic without Git fallback.
- Plastic repository policy outputs now declare the canonical marker-owned `policyOwnedRoot` boundary used by repo-search physical ignore-file containment.
- Canonical contract packages are normal semver dependencies rather than bundled local links, preventing sibling/`node_modules` path leakage in packed tarballs.
- Shared Plastic status branch parsing with `plastic_currentBranch` while preserving its `cm`-authoritative source policy.
- Made `plastic_branchCreate` support an explicit parent branch independent of the loaded workspace branch, default relative names to the current branch when omitted, and reject accidental top-level branches unless `allowRootBranch=true` is explicitly supplied.
- All registered Plastic mutation sinks now consume shared `@aefree/pi-workflow` session/action/exact-target tokens immediately before `cm` spawn, or obtain direct exact-target TUI/RPC confirmation. Checkin maps to `commit`, remote metadata to `publish`, and workspace state changes to `vcs_mutation`; no general shell/Git/bash enforcement is claimed.
- Mutation authorization is no longer cached across `cm` process spawns. One token or direct confirmation permits one attempt; ambiguous retries require fresh authority and consumed-token retries block before spawn with status-inspection remediation.

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
