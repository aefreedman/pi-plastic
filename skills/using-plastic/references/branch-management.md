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

Normal work branches must be children of the current branch. Create `<current-branch>/<new-branch>`, not `/<new-branch>`. A bare `/<new-branch>` is a root/sibling branch and does not inherit the current branch's hierarchy.

Preferred tool-first flow (a leaf name is expanded under the current branch):

```text
plastic_currentBranch() # <current-branch>
plastic_branchCreate(branch="<new-branch>", comment="<branch-description>") # creates <current-branch>/<new-branch>
plastic_switchBranch(branch="<current-branch>/<new-branch>")
```

A full descendant path is also accepted. Creating a root or sibling branch is rare and requires `allowNonDescendant=true`; use that override only when the user explicitly intends the different hierarchy.

Manual shell fallback requires constructing the descendant path explicitly:

```bash
cm branch create "<current-branch>/<new-branch>" -c="<branch-description>"
cm switch --silent --noinput "<current-branch>/<new-branch>"
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

- Prefer a leaf name with `plastic_branchCreate`; the tool expands it beneath the current branch.
- For full paths and manual `cm` commands, start with `/` and include the current branch as the parent.
- Never shorten `<current-branch>/<new-branch>` to `/<new-branch>`; that creates a root/sibling branch.
- Use lowercase and hyphens
- Follow repository conventions
- Check for issue-tracker conventions in branch names like issue ID prefixes
