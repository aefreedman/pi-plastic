# Contributing

## Keep the adapter thin

Plastic owns VCS behavior. Pi Plastic makes native commands discoverable, callable, and readable in Pi.

- Prefer one native command with explicit arguments. Let `cm` validate targets, options, permissions, and state. Don't add hidden probes, retries, fallbacks, or workflow rules to a command wrapper.
- Reuse the existing execution and rendering helpers. Keep calls noninteractive, bound retained output, and report native completion separately from observed effects. Parse stable fields only when they help the caller act; otherwise return the native output.
- Treat code, tool descriptions, schemas, and tests as the reference. If a new behavior needs a long explanation, simplify it first. Keep the skill for tool choice, sequencing, and hazards agents cannot infer from a signature. Keep the README for installation and discovery.
- Preserve existing public contracts unless deliberately changing them. Put user-visible changes under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md); don't bump the version for ordinary changes.

## Validate from the package root

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Keep default tests offline and credential-free. If a change affects real `cm` invocation or interpretation, run the narrowest relevant [opt-in live test](docs/2026-10-06-development.md#live-validation) in a clean, authorized disposable sandbox. Report what ran and what state or cleanup was verified, or say that live validation is pending.

Run `npm pack --dry-run` when changing what ships. Never commit credentials, private repository data, or raw captures. Report vulnerabilities through [SECURITY.md](SECURITY.md).
