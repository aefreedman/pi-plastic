# Code Review Creation

## Tool-first flow

Use `plastic_codeReviewCreate` with an explicitly inspected target and title. Optional `status`, `assignee`, and `repository` retain their CLI meanings. Set an assignee only when the user requests that assignment; creating a review does not authorize assigning another person.

```text
plastic_codeReviewCreate(target="br:/main/owned-feature", title="Feature: Brief description", output="json")
# Inspect the receipt before using its observedCreatedIdentity in a separately authorized update.
plastic_codeReviewUpdate(id="<observed ID>", status="Reviewed", output="json")
```

Default numeric/GUID creation scalars can be emitted identity evidence. Requested repository scope and requested review state remain unverified. An update completing with empty stdout is command completion, not proof that the status changed. No automatic readback, retry, assignment, or review conversation follows.

`output="text"|"json"` controls receipt presentation independently of creation `format`, which is passed to CM unchanged. Custom formatted stdout always remains opaque, even when it contains a numeric ID. Do not chain a substring of custom output into an update; an explicitly planned unique-title query can provide separate identity evidence.

## Manual CLI fallback

Inspect the exact branch/changeset/shelveset selector first. Do not derive it by splitting or trimming human-readable status output.

```bash
cm codereview "br:/main/owned-feature" "Feature: Brief description"
# Only if separately authorized, using an observed ID:
cm codereview -e "<observed ID>" --status="Reviewed"
# Only when an assignment was explicitly requested:
cm codereview -e "<observed ID>" --assignee="<requested user>"
```

Installed CM11 help documents creation formatter `{0}` as ID and `{1}` as GUID. A bounded owned fixture validated `--format="{0}|{1}"`; a named `{id}|{title}` creation formatter failed with `Invalid format string`. Creation formatting and `cm find review` field formatting are different protocols: the tested find query accepts `{id}|{status}|{title}`, but `{guid}` failed. Do not infer support from an inconsistent help example.

```bash
cm codereview "br:/main/owned-feature" "Owned review title" --format="{0}|{1}"
# Separate, explicitly scoped observation; not an automatic creation/update verification:
cm find review "where title='Owned review title'" --format="{id}|{status}|{title}" --nototal
```

Failed commands may have effects; retain receipts and inspect the exact owned fixture before deciding what to do. If CLI access is unavailable, report that limitation or use the GUI only when requested. Do not silently create or assign a replacement review.
