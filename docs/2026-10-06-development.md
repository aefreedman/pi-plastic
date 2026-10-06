# Development and structured API

[Documentation index](README.md) · [Receipt semantics](2026-10-06-safety-and-receipts.md)

For contributor policy, see [CONTRIBUTING](https://github.com/aefreedman/pi-plastic/blob/main/CONTRIBUTING.md). This page explains current source ownership, validation, and consumer limitations—not a one-time release procedure.

## Checkout setup

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:host:status
npm run eval:tool-loading -- --dry-run
npm pack --dry-run
```

Run commands from the manifest root. `npm test` starts with `npm run typecheck`: strict no-emit coverage includes index/src/extensions and compile-only schema-inference contracts. Runtime tests/evals use tsx.

The current pinned development/eval SDK and TUI baseline is **1.0.2**, as declared in package.json; older Pi releases are not a supported matrix. Historical fixture/evidence version strings are not alternate runtime targets. Host-provided framework packages remain peers, not bundled runtime dependencies.

Default tests are credential-free. They cover schemas/semantic guards, registration/loading, aliases, paths/snapshots, lifecycles/retirement, rendering, Bash guards, documentation/navigation, ownership and constrained-sampling classification. The SDK-host harness uses real file loading/finalization/direct/codemode/nested consumers and JSON execution events, with a deterministic local provider and synthetic CLI—no network/backend-effect acceptance.

## Structured API and transport

All 27 core tools have closed output schemas and direct native producer execution. The capability loader is deliberately schema-less. Core exports remain string-returning views; selected failures reject so compound callers cannot proceed on presentation text.

Producers own request snapshots, source admission, bounded projection and same-observation presentation. Native details vary by route: legacy read presentation can remain in rawResult, while mutation/diff receipts use empty details. Don't parse strings to reconstruct canonical facts.

### Consumer caveats

- Host policy/preabort can reject before a producer DTO exists; handle host-native rejection as well as DTO ok.
- Optional null may be normalized to omission before delivery, and invalid enums may be rejected by the SDK before the producer. No universal raw-submitted-value fidelity is promised.
- Foreign result hooks own replacements; content-only changes can remove structured output and cause text fallback. The producer doesn't restore it or enforce post-hook bounds.
- Ordinary transcript messages don't automatically persist the full DTO; general RPC/provider fidelity is not claimed.
- Identity, capture, request/argv/outcome/effect consistency matters beyond closed JSON shape. Keep adversarial semantic tests when changing schemas.

The [family references](README.md#look-up-a-tool) describe the canonical fields/bounds; [receipt semantics](2026-10-06-safety-and-receipts.md) explains chaining decisions.

## Source map

| Area | Owner |
|---|---|
| Explicit core exports | src/plastic-core.ts; operation modules under src/operations |
| Shared workspace discovery/branch parsing | src/plastic-workspace.ts |
| CLI execution/capture/context | src/execution |
| Source parsing/admission and domain contracts | src/domain |
| Pi registry/parameters/structured adapters | src/pi; index.ts is the entry shim |
| Text/JSON presentation | src/presentation |
| Compact/expanded tool rendering | src/plastic-renderers.ts |
| Footer lifecycle | extensions/plastic-branch-status.ts |
| Bash safety guards | Declared extensions and their focused tests |
| Task workflow guidance | skills/using-plastic and its on-demand references |
| Public consumer manual | docs/README.md and dated topic pages |

Keep stable public tool names/output shapes unless a deliberate breaking change is documented. Do not weaken guards, mutate dependencies/versions incidentally, or centralize another package's policy here.

## Live validation

Live CM runs require an authorized, dedicated disposable sandbox and the contributor's own authentication. Never add credentials, organization/server coordinates, original private files or raw provider payloads to public fixtures/docs.

Read-only smoke, from an intentionally clean sandbox with /main and no merge in progress:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/dedicated/sandbox npm run test:live
```

For explicit branch-creation mutation validation:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/dedicated/sandbox \
PI_PLASTIC_ALLOW_MUTATION_TESTS=true \
npm run test:live:branch-create
```

The branch test creates uniquely named hierarchical branches, checks explicit-parent/root guards, does not switch the workspace and removes its temporary branches under its cleanup contract. Do not run broad mutation suites merely to add evidence; inspect exact scope first.

For behavior changes, report the narrow actual live test and resulting-state/cleanup evidence without private coordinates. If unavailable, mark live validation pending. Documentation-only/internal changes can mark live validation not applicable with a reason. Source-backed platform/client limits remain in the family references.

## Tool-loading eval

The package-owned behavioral eval is not a skill eval. Fresh SDK 1.0.2 JSON subprocesses compare all-active/balanced/loader-only mode, smallest-sufficient activations and sanitized provider-schema measurements.

Dry-run validates configuration without live provider trials. Actual trials require an explicitly attested dedicated Plastic sandbox and an approved model. Destructive calls are blocked unless supported preflight previews; raw payload captures are deleted by default.

Read the repository [eval guide](https://github.com/aefreedman/pi-plastic/blob/main/evals/tool-loading/README.md) for model restrictions, cases, metrics and result hygiene. Tests/eval harness files are intentionally repository-only rather than packed consumer dependencies.

## Constrained sampling

The package does not opt in to provider-side strict sampling. Public schemas include optional fields (at least workdir); OpenAI strict function schemas require closed objects and every declared property required. Pi forwards schemas without converting optional fields.

`strict="prefer"` would therefore need either invalid requests or a breaking argument redesign. Tests prevent accidental opt-in until schemas are genuinely compatible. Runtime/TypeBox admission remains authoritative.

Codex grammar capability does not imply strict JSON-schema capability. Grammar sampling is not used because these operations have structured multi-field arguments, not one bounded string language.

## Documentation and packaging checks

Keep README as a landing page, docs as the consumer reference, skill files as progressive workflow guidance, and workspace plans/private evidence outside the package. New topic pages retain date-prefixed filenames; update navigation and links when adding/moving content.

Documentation tests verify relative links/anchors, every core tool route, schema-bearing coverage, concise README, current baseline claims and packed-document closure. Review `npm pack --dry-run` content as well as its file list: no tests/evals/private coordination material is added by splitting the manual.

These are structural and execution checks, not a browser accessibility audit or proof that every agent will choose the right page. No provider-backed doc-reading eval is implied.
