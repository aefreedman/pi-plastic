# Dynamic tool-loading behavioral eval

This package-local eval compares `all-active`, `balanced`, and `loader-only` Plastic tool-loading modes through fresh Pi 0.83 JSON subprocesses. It is intentionally **not** a skill eval: skills, prompt templates, built-in tools, discovered extensions, context files, and sessions are disabled.

## What it measures

- Required Plastic tool calls for status, branch listing, read-only switch/checkin preflight, compound branch list + `/main` verification, no-operation, ambiguous branch discovery, and two implicit contextual discovery prompts (inspect branches; find code reviews) that name neither the loader nor the target public tool.
- Loader behavior: exactly one `plastic_tool_search` only when a required tool is initially deferred; none for all-active, balanced cases whose target is already active, or the negative case. Whenever a loader is expected, the runner requires its activation result to be exactly the case's smallest sufficient deferred target set.
- Tool errors, assistant errors, call/output/time bounds, maximum four activation results, and no destructive activation in negative or ambiguous discovery cases. An eval-only extension blocks every destructive Plastic call unless that tool's registered schema supports `preflight` and the call supplies `preflight: true`.
- JSONL events, assistant usage/cache totals, wall time, initial provider `tools` serialization size, and native `tool_search_call` / `tool_search_output` markers when Pi/provider payloads expose them.

`baseline.json` preserves the legacy 29-tool measurement for comparison. The current all-active mode omits the loader and exposes `28 / 21071` after withholding workspace creation; balanced records `3 / 2133` (89.93% legacy reduction), and loader-only records `1 / 1121` (94.71%). The loader's prompt metadata is 278 characters; the untouched legacy baseline has none.

## Run

A live run requires an explicit approved model and **both** sandbox attestations. `PI_PLASTIC_EVAL_SANDBOX` must resolve to a dedicated workspace containing `.pi-plastic-eval-sandbox` whose complete, exact UTF-8 content is `pi-plastic-eval-sandbox` followed by one LF newline (no other bytes):

```text
pi-plastic-eval-sandbox
```

For example, create the marker with `printf 'pi-plastic-eval-sandbox\n' > /absolute/path/to/sandbox/.pi-plastic-eval-sandbox`. Also set `PI_PLASTIC_EVAL_ALLOW=dedicated-sandbox`; this explicit opt-in prevents accidentally targeting an ordinary workspace. Dry runs validate configuration and do **not** require either attestation.

```bash
PI_PLASTIC_EVAL_SANDBOX=/absolute/path/to/sandbox PI_PLASTIC_EVAL_ALLOW=dedicated-sandbox npm run eval:tool-loading -- --model openai-codex/gpt-5.6-luna
PI_PLASTIC_EVAL_SANDBOX=/absolute/path/to/sandbox PI_PLASTIC_EVAL_ALLOW=dedicated-sandbox npm run eval:tool-loading -- --model openai-codex/gpt-5.6-terra:medium --condition balanced --cases branch-listing,compound-list-branches-verify-main --trials 2
```

Only `openai-codex/gpt-5.6-(luna|terra|sol)` with an optional supported thinking level such as `:medium` is accepted. Trials are sequential and bounded to 1–5. Never target an ordinary production workspace.

Validate the configuration without calling a model:

```bash
npm run eval:tool-loading -- --dry-run
npm run eval:tool-loading -- --help
```

Each trial writes provider payloads only to a unique system-temp capture file, never stdout. The runner deletes raw captures by default. Pass `--keep` only when you explicitly need those sensitive raw payloads. Sanitized timestamped summaries are written to ignored `results/`; use `--include-events` to include event type/tool-name crumbs only.
