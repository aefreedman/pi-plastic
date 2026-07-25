# Dynamic tool-loading pilot results

Date: 2026-07-25  
Package: `@aefree/pi-plastic`  
Pi: 0.82.0  
Model: `openai-codex/gpt-5.6-terra:medium`  
Sandbox: dedicated `plastic-tool-sandbox` repository

## Decision

The Plastic pilot passes its rollout criteria. Keep the balanced initial set as the production default: `plastic_tool_search`, `plastic_status`, and `plastic_currentBranch`.

- Existing 29 public Plastic tools retain their names and behavior; the loader is additive.
- Balanced public metadata is 2,117 serialized characters versus the untouched 21,192-character legacy baseline, a 90.01% reduction.
- Stable live provider payloads contained 1,908 serialized initial tool characters in balanced mode versus 22,120 in the 29-tool legacy all-active mode, a 91.37% reduction.
- A deferred capability added exactly one loader call/provider round trip and no repeated loader call after activation.
- Native OpenAI deferred-loading markers (`tool_search_call` and `tool_search_output`) appeared in every deferred GPT-5.6 case and were absent when no loader call was expected.
- Core outcomes, preflight argument checks, negative controls, and ambiguous branch discovery passed.

## Behavioral evidence

The final expanded diagnostic matrix passed 27/27 trials: nine explicit, implicit, contextual, ambiguous, compound, preflight, and negative cases under all-active, balanced, and loader-only conditions. Five stable status, branch, switch-preflight, checkin-preflight, and compound branch cases passed 45/45 trials over three repetitions per condition. A focused three-trial loader-only regression for contextual branch discovery also passed 3/3 after plural/domain query coverage was added.

Stable-trial measurements:

| Condition | Pass | Initial provider tool chars | Median wall time | Mean wall time | Mean reported total tokens | Mean tool calls |
|---|---:|---:|---:|---:|---:|---:|
| all-active | 15/15 | 22,120 | 8.78 s | 9.39 s | 7,180 | 1.20 |
| balanced | 15/15 | 1,908 | 10.50 s | 10.41 s | 3,295 | 2.00 |
| loader-only | 15/15 | 832 | 10.23 s | 10.84 s | 3,183 | 2.20 |

The balanced median added about 1.73 seconds (19.7%) in these short cases while reducing initial provider tool serialization by 91.37% and mean reported total tokens by about 54%. Mean provider requests were 2.0 all-active, 2.8 balanced, and 3.0 loader-only; deferred cases account for the accepted first-use loader request, while balanced status remained immediate. Results remain separate because cache reads, input tokens, wall time, and provider requests have different cost/latency implications.

The first diagnostic attempt used a 24,000-character JSONL capture bound and terminated normal Pi event streams before their follow-up tool turn. Raising the bounded capture limit to 2 MiB corrected the harness; no package behavior changed for the passing diagnostic and stable runs. Final live runs also required a sandbox marker, an explicit authorization environment value, and an eval-only guard that blocked mutation-capable tools unless the tool supported and received `preflight: true`.

## Session and compatibility evidence

A persisted loader-only session first called `plastic_tool_search` and `plastic_branchList`. Its tool result stored `addedToolNames: ["plastic_branchList"]`. A fresh Pi process resumed that session, restored `plastic_branchList`, called it directly, and made no second loader call.

Package harness coverage also verifies additive activation without Pi 0.82 `sourceInfo`, representing older/fallback active-list behavior. Pi/provider fallback serialization itself is owned by Pi; this package does not claim a live non-GPT-5.6 provider test.

## Sandbox mutation evidence

The dedicated sandbox was used for real branch, changeset, shelveset, review, merge, conflict-signal, and cleanup operations:

- Created and switched to disposable branch `/dynamic-tool-loading-eval-20260725-1538`.
- Added a synthetic fixture and created disposable changeset `cs:4`.
- Created, listed, previewed/applied, undid, and deleted shelveset `sh:2`.
- Created, found, updated, and deleted code review `21`.
- Attempted a merge to `/main`; Plastic reported an evil-twin directory conflict before establishing merge state. Explicit source finalization also stopped on that directory conflict, demonstrating the existing safe failure signal rather than silently checking in.
- Deleted the disposable branch and changeset after the stopped merge.

Final verification found `/main` active, no pending or merge state, and no remaining test branch, shelveset, or review. The private `.pi-plastic-eval-sandbox` attestation marker was removed after the eval; future guarded runs must recreate it deliberately. Workspace creation was not exercised because the package exposes create/list but no paired workspace-delete tool; leaving an account-level test workspace would not improve loader evidence.

## Scope

This result covers the `pi-plastic` pilot only. The recorded seven-case live matrix predates the current two implicit contextual discovery cases, exact smallest-sufficient activation assertion, eval-only preflight mutation guard, and marker/authorization sandbox attestations; no live re-run is implied by those later harness hardenings. Future live runs require `PI_PLASTIC_EVAL_SANDBOX` to contain the documented `.pi-plastic-eval-sandbox` marker and `PI_PLASTIC_EVAL_ALLOW=dedicated-sandbox`. It does not authorize package publishing or version changes, and it does not begin the separate Codecks guidance design or any skill evaluation.
