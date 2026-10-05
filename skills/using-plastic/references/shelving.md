# Shelving

Prefer runtime `plastic_*` tools. Inspect the intended paths and shelveset spelling before mutation; do not broaden into existing objects or workspace-wide recovery automatically.

## Save work

```text
plastic_shelvesetCreate(paths=["owned.txt"], comment="Working on feature X", summaryFormat=true, output="json")
```

A supported full emitted shelveset scalar can provide created identity evidence; repository scope, workspace exclusivity and rollback remain unverified. Preserve every qualifier. Paths and requested `all`/`dependencies` controls are passed unchanged. Comment and commentsFile are exclusive. Comment-less creation is refused when PLASTICEDITOR is configured; supply a comment rather than overriding the environment.

## Inspect and apply

```text
plastic_shelvesetList()
plastic_shelvesetApply(shelveset="<observed exact shelveset selector>", output="json")
```

Command completion does not prove which items applied or that the workspace is restored/clean. Inspect the receipt and independently scoped workspace observations. `preview=true` really dispatches CM and can still prompt/fail on conflicts; `preflight=true` only renders argv with zero CLI calls and does not analyze conflicts. Do not run both routinely.

A fresh checked-out tracked text change has conflict-free same-base preview/apply evidence on Windows CM11. An earlier added-item preview prompted evil-twin resolution and failed. This does not establish a safe general conflict-resolution policy. Never force a choice, replay an uncertain apply or undo broad workspace scope automatically. Owned parent restoration is a separate authorized action, not producer rollback.

## Delete

```text
plastic_shelvesetDelete(shelveset="<explicitly owned exact selector>", output="json")
```

Delete only when requested. Exit0 does not prove deletion/absence or history restoration; the receipt leaves those effects unverified.

## Manual CLI fallback

```bash
cm shelveset create "owned.txt" -c="Working on feature X" --summaryformat
cm shelveset apply "<observed exact shelveset selector>"
cm shelveset delete "<explicitly owned exact selector>"
```

These are separate mutations, not a default chained workflow. Preserve prior positive effects and failed probes; missing identity or unsafe interaction is a stop signal, not permission to guess a selector or change strategy.
