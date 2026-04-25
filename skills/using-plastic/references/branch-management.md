# Branch Management

## Detect Current Branch

```bash
current_branch=$(cm status | head -1 | cut -d@ -f1 | xargs)
```

## Detect Naming Convention

```bash
cm find branches --format="{name}" | head -20
```

Use detected parent (often `/main` or `/dev`).

## Create Branch

Preferred tool-first flow:

```text
plastic_branchCreate(branch="/main/feature-name", comment="Feature description")
plastic_switchBranch(branch="/main/feature-name")
```

Manual shell fallback:

```bash
cm branch create /main/feature-name -c="Feature description"
cm switch --silent --noinput /main/feature-name
```

Agent preference: use runtime `plastic_*` methods first; keep shell commands as manual fallback

Pending-change behavior in unattended runs:

- `pendingChanges="bring"` is only blocked when tracked pending changes exist (Plastic requires interactive prompts).
- If pending changes are private-only, `plastic_switchBranch` performs a direct non-interactive switch and keeps private files local.
- `pendingChanges="shelve"` shelves tracked changes; for private-only pending changes, shelve is skipped and switch proceeds.

## Merge Branches (Non-Interactive)

Preferred tool-first flow:

```text
plastic_merge(source="/main/feature-name")
```

Manual shell fallback:

```bash
cm merge /main/feature-name --merge --nointeractiveresolution --mergetype=try
```

Optional explicit override (higher clobber risk, use only when required):

```text
plastic_merge(source="/main/feature-name", strategy="destination")
plastic_merge(source="/main/feature-name", strategy="source")
```

## Naming Guidelines

- Start with `/`.
- Use lowercase and hyphens
- Follow repository conventions
- Check for issue-tracker conventions in branch names like issue ID prefixes
