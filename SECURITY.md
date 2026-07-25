# Security Policy

## Supported versions

Security fixes are provided for the latest tagged release. Upgrade to the newest release before reporting an issue that may already be fixed.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, credential exposure, or unsafe command-execution path.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/aefreedman/pi-plastic/security/advisories/new>

Include:

- the affected package version or commit;
- the Pi, Node.js, Git, and Plastic CLI versions;
- the operating system;
- reproduction steps and expected versus observed behavior;
- the affected tool or extension;
- impact and any known mitigations;
- whether credentials, repository content, or remote Plastic objects may have been exposed or changed.

Avoid including real credentials or sensitive repository content. Use a disposable Plastic workspace when a reproduction requires mutation.

You should receive an acknowledgement within seven days. Release timing depends on severity, reproducibility, and coordination needs.

## Scope

Security-sensitive areas include command construction, executable-path overrides, workspace/path targeting, destructive Plastic operations, provider payload capture, dynamic tool ownership, and package-install behavior. General support questions and ordinary bugs belong in the public issue tracker.
