# Code Review Creation

## CLI (Preferred)

```bash
branch=$(cm status | head -1 | cut -d@ -f1 | xargs)
review_id=$(cm codereview "br:${branch}" "Feature: Brief description" --format="{id}")

# Assign reviewer immediately after creating the review
cm codereview -e "$review_id" --reviewer="reviewer-name"

# List reviews for this branch
cm find review "where target='br:${branch}'" --format="{id} {status} {title}"
```

Agent preference: use runtime `plastic_*` methods first for status/branch lookup; keep shell commands as manual fallback.

Reviewer assignment is required in the workflow. If your server uses different reviewer flags, run `cm codereview --help` and use the server-specific reviewer option right after review creation.

Tool-first flow (preferred):

```text
plastic_status()
# Then use cm codereview ... as fallback for review create/assign
```

## CLI Not Available

- Document branch and changeset in plan/issue tracker.
- Or create review via Plastic GUI and assign a reviewer before sharing the review link.
