# Branch Management

## Detect Current Branch

```bash
current_branch=$(cm status | head -1 | cut -d@ -f1 | xargs)
```

## Detect Naming Convention

```bash
cm find branches --format="{name}" | head -20
```

Use the detected parent branch from the repository instead of copying a branch name from documentation.

## Create Branch

Preferred tool-first flow:

```text
plastic_branchCreate(branch="<branch-spec>", comment="<branch-description>")
plastic_switchBranch(branch="<branch-spec>")
```

Manual shell fallback:

```bash
cm branch create <branch-spec> -c="<branch-description>"
cm switch --silent --noinput <branch-spec>
```

Agent preference: use runtime `plastic_*` methods first; keep shell commands as manual fallback

Pending-change behavior in unattended runs:

- `pendingChanges="bring"` is only blocked when tracked pending changes exist (Plastic requires interactive prompts).
- If pending changes are private-only, `plastic_switchBranch` performs a direct non-interactive switch and keeps private files local.
- `pendingChanges="shelve"` shelves tracked changes; for private-only pending changes, shelve is skipped and switch proceeds.

## Merge Branches (Non-Interactive)

Preferred tool-first flow:

```text
plastic_merge(source="<source-branch-spec>")
```

Manual shell fallback:

```bash
cm merge <source-branch-spec> --merge --nointeractiveresolution --mergetype=try
```

Optional explicit override (higher clobber risk, use only when required):

```text
plastic_merge(source="<source-branch-spec>", strategy="destination")
plastic_merge(source="<source-branch-spec>", strategy="source")
```

## Naming Guidelines

- Start with `/`.
- Use lowercase and hyphens
- Follow repository conventions
- Check for issue-tracker conventions in branch names like issue ID prefixes
