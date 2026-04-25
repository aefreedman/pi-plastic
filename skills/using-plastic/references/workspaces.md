# Review Workspaces

## Strategy

- Use a separate review workspace for isolation.
- Reuse `-review-1` by default (Unity workspaces are large).

## Create or Reuse

```bash
main_workspace=$(basename "$PWD")
review_workspace_name="${main_workspace}-review-1"
review_workspace="../${review_workspace_name}"

if [ -d "$review_workspace" ]; then
  cd "$review_workspace"
  cm switch --silent --noinput "$review_branch" || {
    cm shelveset create --all -c="Auto-shelve before review switch"
    cm switch --silent --noinput "$review_branch"
  }
else
  repo_spec=$(cm status --wkconfig | grep "^Repository:" | cut -d: -f2- | xargs)
  cm workspace create "$review_workspace_name" "$review_workspace" "$repo_spec"
  cd "$review_workspace"
  cm switch --silent --noinput "$review_branch"
fi
```

Agent preference: use runtime `plastic_*` methods first for branch/status operations; keep shell commands as manual fallback.

## Cleanup

Only remove review workspaces when disk space is tight or requested.
