# Contributing

Thanks for improving Pi Plastic.

## Prerequisites

- Node.js 22.19.0 or newer
- npm
- Plastic SCM / Unity Version Control CLI for opt-in live validation
- Git for the text-only diff tools

## Setup

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The default suite is credential-free. Keep it that way. Tests that require Plastic access must remain explicitly opt-in and target a dedicated disposable workspace.

## Making changes

- Keep public tool names and output shapes stable unless the change intentionally documents a breaking release.
- Preserve built-in and foreign-extension tools when changing active-tool composition.
- Do not weaken confirmation, preflight, path, process, or mutation safeguards.
- Add focused regression coverage for behavior changes.
- Update README documentation when user-facing behavior changes.
- Keep unreleased user-visible changes under `## Unreleased` in `CHANGELOG.md` during ordinary development.
- Do not bump the package version for every implementation commit. Convert the accumulated Unreleased section into one dated SemVer release only when preparing a release.

## Validation

Run:

```bash
npm test
npm run eval:tool-loading -- --dry-run
npm pack --dry-run
```

Review the tarball list for machine-specific paths, credentials, raw provider payloads, generated results, and unrelated files.

Plastic live tests are intentionally local-only. This project has no shared Plastic Cloud account or CI credentials, and contributors must authenticate `cm` with their own account and use a repository they are authorized to modify. Never add Plastic credentials, tokens, cloud organization details, or private repository data to tests, fixtures, logs, pull requests, or GitHub Actions.

For an opt-in read-only Plastic smoke test:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/dedicated/sandbox npm run test:live
```

For branch-creation behavior, use the opt-in mutation test only against a clean, dedicated disposable repository:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/dedicated/sandbox \
PI_PLASTIC_ALLOW_MUTATION_TESTS=true \
npm run test:live:branch-create
```

The mutation test creates uniquely named hierarchical branches, verifies explicit-parent behavior and the top-level guard, does not switch the workspace, and removes temporary branches in cleanup.

### Behavior completion gate

When a change modifies how a `plastic_*` tool invokes or interprets real Plastic behavior:

1. Add or update credential-free regression coverage for policy, parsing, and command construction.
2. Locally run the narrowest relevant opt-in live test in a clean disposable Plastic repository using the contributor's own authenticated account.
3. Verify the workspace state and temporary-resource cleanup afterward.
4. Report the exact live test and that an authenticated disposable repository was used, without exposing account, organization, server, credential, or private repository details.

GitHub Actions is not expected to run Plastic live tests. If local authenticated validation is unavailable, describe the work as implemented with live validation pending; do not claim the behavior is done or verified. Documentation-only and purely internal changes may mark live validation as not applicable with a reason.

Follow `evals/tool-loading/README.md` before any live model evaluation. Never use an ordinary production workspace for mutation testing.

## Pull requests

Keep pull requests focused. Describe:

- the behavior changed;
- safety or compatibility considerations;
- tests and environments actually run;
- checks intentionally skipped;
- relevant before/after metadata or latency measurements for loader changes.

Do not include secrets, account data, private repository content, or raw provider captures.

## Security reports

Follow [SECURITY.md](SECURITY.md) instead of opening a public issue for vulnerabilities.
