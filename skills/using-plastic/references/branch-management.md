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

Normal work branches must be children of an intended parent branch. Create `<parent-branch>/<new-branch>`, not `/<new-branch>`. The parent may differ from the branch loaded in the workspace; Plastic bases the new branch on the parent's latest changeset by default.

Preferred tool-first flow:

```text
plastic_branchCreate(
  branch="<new-branch>",
  parent="<parent-branch>",
  comment="<branch-description>",
) # creates <parent-branch>/<new-branch>
plastic_switchBranch(branch="<parent-branch>/<new-branch>") # only when work should continue there
```

Omitting `parent` for a relative name requires directly observed standard-status loaded-branch identity. A changeset owner (including compact cs-only status) is not the loaded parent; provide an explicit parent when it cannot be observed. Qualifier-bearing relative names/parents are rejected rather than stripped; full hierarchical qualified targets stay verbatim. Rare top-level creation requires `allowRootBranch=true` only when explicitly intended.

A successful receipt proves `command-completed` only, with null observed created identity and unverified repository/domain effects, even for empty stdout. It does not switch the workspace or run a hidden verification query. After an uncertain attempt, inspect the receipt and state before retrying; command completion is not independent creation proof.

Manual shell fallback requires constructing the hierarchical path explicitly:

```bash
cm branch create "<parent-branch>/<new-branch>" -c="<branch-description>"
cm switch --silent --noinput "<parent-branch>/<new-branch>"
```

Agent preference: use runtime `plastic_*` methods first; keep shell commands as manual fallback

Pending-change behavior in unattended runs:

- `pendingChanges="bring"` is only blocked when tracked pending changes exist (Plastic requires interactive prompts).
- If pending changes are private-only, `plastic_switchBranch` performs a direct non-interactive switch and keeps private files local.
- `pendingChanges="shelve"` shelves tracked changes; for private-only pending changes, shelve is skipped and switch proceeds.
- Defaulted cancel permits private-only direct switching; explicit cancel blocks switching with any pending items. Native cancellation is not a successful switch; core non-preflight cancellation rejects to stop compound callers.
- Inspect native switch outcome, step effects and target verification. A shelve or switch command completing does not prove preservation, reusable shelveset identity, alias equivalence or rollback. Failed/malformed pending or recovery observations stop; compact changeset ownership is not the loaded branch. Qualification-ambiguous same-name requests are not skipped as already loaded; unverified post-qualification returns an error after retaining possible effects. Preflight is sequential local inspection only, not server-verified switchability.

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

- Prefer a leaf name plus an explicit `parent` with `plastic_branchCreate`.
- The parent branch may differ from the branch currently loaded in the workspace.
- For full paths and manual `cm` commands, start with `/` and include the intended parent branch.
- Never shorten `<parent-branch>/<new-branch>` to `/<new-branch>`; that creates a top-level branch.
- Use lowercase and hyphens
- Follow repository conventions
- Check for issue-tracker conventions in branch names like issue ID prefixes
