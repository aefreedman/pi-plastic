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

For an opt-in read-only Plastic smoke test:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/dedicated/sandbox npm run test:live
```

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
