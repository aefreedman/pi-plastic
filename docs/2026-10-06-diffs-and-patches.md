# Diffs and patches

[Documentation index](README.md) · [Backend setup](2026-10-06-setup.md#diff-and-patch-backends) · [Safety and receipts](2026-10-06-safety-and-receipts.md)

Use `plastic_diff` for bounded comparison evidence. Use `plastic_patch` to generate a review artifact. Neither opens the GUI diff; patch application is not exposed.

## Choose the output you need

| Need | Tool |
|---|---|
| Loaded/historical base against one local file | diff, file mode |
| Two explicit historical selectors | diff, revisions mode |
| Selected pending paths or a bounded all-pending set | diff, workspace mode |
| A generated branch/spec review patch or an intentional new output file | patch |

Status is the changed-path listing tool; diff only when content evidence is needed. Inspect artifacts before sharing: changed content can contain secrets, local paths, code or binary data. Display masking is not a source-code secret scanner.

## Diff modes

`plastic_diff` requires one explicit closed mode. The former specialized names are removed, not aliases.

| Mode | Required scope | Behavior |
|---|---|---|
| file | path; optional revision | Omitted revision uses a verified loaded base; explicit revision skips status/base queries |
| revisions | leftRevision and rightRevision | Two sequential owned exports; selectors retain unresolved identity unless observed independently |
| workspace | Nonempty paths or allPending=true | Match pending scopes; includePrivate only with allPending |

```text
plastic_diff(mode="file", path="Assets/Example.txt", maxChars=3000)
plastic_diff(mode="revisions", leftRevision="<left file-revision selector>", rightRevision="<right file-revision selector>")
plastic_diff(mode="workspace", paths=["Assets/Example.txt"])
```

Workspace paths cap 20. maxFiles is 1–20, default 3 for all-pending/20 for scoped paths. Directories select pending descendants, while directory rows themselves are skipped. A moved source or destination selects the same observation.

All modes return a closed versioned action diff envelope independent of text/JSON format. Comparison data records pending/comparison kind, origins/selectors/paths, observed loaded identity when available, bytes/binary flags, backend/capture evidence, excerpts and counts.

## Loaded bases and snapshots

Loaded ownership comes from strict UTF-8 status/fileinfo/ls observations: a genuine qualified file revision ID, repository/server agreement, and exported bytes matching loaded metadata's MD5/SHA1 hash.

- Deleted files use the frozen loaded root tree deliberately.
- Local moves use observed OldPath metadata.
- Added and explicitly selected private files use an intentional empty base; added-empty is distinct from unchanged.
- Unavailable/nodata/unsupported ownership fails, never becomes an empty side.
- No changeset number becomes a file revision, bare-ID ownership guess, or failed-query fallback.
- Mixed-Xlink ownership remains unverified.

Historical exports use new owned temporary destinations outside the workspace. `cm cat --file=` writes that destination; it is not an input selector. The tools own their exports/cleanup.

Local snapshots require physical workspace containment, regular non-symlink files, bounded descriptor reads, and stable observable identity/size/timestamps/namespace. Retained bytes are independent of later edits, not an atomic filesystem/repository snapshot. Cleanup completes before success.

## Diff result and failure interpretation

Text comparison requires one configured GNU/POSIX `diff -u`:

- Exit 0 with empty output, or exit 1 with complete fatal-UTF-8 structurally consistent unified hunks, is admitted.
- NUL/invalid-UTF-8 content uses exact internal byte equality.
- Signal/null terminal, stderr, timeout, malformed/partial streams, failed/oversized exports or cleanup failures return sanitized errors.
- English GNU no-final-newline markers are supported; unverified variants fail closed.
- No retry or backend substitution.

Workspace results preserve per-file failures plus parsed/eligible/selected/attempted/completed/failed/skipped/unattempted/limited/returned/omitted counts, private exclusions and unmatched paths. Overall ok can be false while earlier comparisons remain recorded. Inspect read/projection completeness before declaring a review complete.

```js
const dto = await tools.plastic_diff({mode: "workspace", paths: ["Assets/Example.txt"]});
text({ok: dto.ok, completeness: dto.completeness, data: dto.data});
```

This deliberately keeps partial evidence rather than turning failure into an empty comparison.

### Diff bounds

| Bound | Value |
|---|---|
| Each retained/export-read side | 4 MiB; not a hard cat disk-transfer quota |
| Command capture | 1 MiB stdout /64 KiB stderr |
| Process timeout initiation | 30 seconds plus collector escalation |
| File/revisions excerpt | 8,000 characters default; 500–20,000 |
| Workspace excerpt | 3,000 default; 500–8,000 |
| Compact DTO | 131,072 UTF-8 bytes |
| Presentation | 24,000 characters |

Excerpts use surrogate-safe UTF-16 source/marker/omission counts and are not guaranteed applyable patches. Workspace aggregate projection may omit whole outcomes with explicit counts, never clip IDs. JSON remains valid and may direct callers to structuredContent instead of duplicating it.

## Patch generation

`plastic_patch` uses `cm patch` for generation only. Defaults: JSON presentation, clean=false, integration=false; current backend precedence and local-selector qualification remain.

```text
plastic_patch(source="br:/main/owned-feature", integration=true)
plastic_patch(source="br:/main/owned-feature", clean=true, integration=true, output="new-review.patch")
plastic_patch(source="<left spec>", destination="<right spec>")
plastic_patch(source="<branch spec>", toolPath="<verified patch-capable executable>", format="text")
```

`output` is a new artifact path, not the text/JSON presentation selector. `format="text"` is additive presentation. `toolPath` is the highest-priority one-call backend override; consult [setup](2026-10-06-setup.md#diff-and-patch-backends) before selecting a backend.

Unqualified branch selectors are qualified only from the current workspace selector's exact repository/server. Otherwise supply a complete qualified branch. No alias equivalence, immutable/head selection, move encoding, workspace-effect, custom-backend-effect or rollback proof is invented.

The receipt separates:

1. Requested/effective selectors and backend, with a redacted command projection.
2. One generation attempt and capture.
3. Bounded observed artifact bytes, SHA256, UTF-8/character/excerpt evidence where admitted.
4. Atomic no-overwrite publication, separate from observation.
5. Owned cleanup/retention and recovery directory information.

No `--apply`, backend/strategy retry, probe fallback or workspace mutation follows. Server output may represent moves as moves or delete/add; don't assume representation without inspecting the generated artifact.

## Publication and cleanup

With no output path, admitted patch content is returned and owned temp cleanup follows the supported route. An empty omitted-output artifact is legitimate.

Explicit output requires nonempty admitted bytes, then atomic exclusive hard-link publication from owned sibling staging. Existing destinations are never replaced. Failed/incomplete/warning captures cannot publish.

Already observed artifacts/publication remain recorded after later failure. Possibly running/timed-out/aborted processes cause staging/recovery retention when cleanup cannot be justified; retirement does not prove the child stopped. Destination content, aliases and concurrent/global scope are not independently verified by publication alone.

### Patch bounds and preflight

| Bound | Value |
|---|---|
| Stable regular artifact read | 4 MiB |
| Local selector read | 64 KiB |
| Request / controls | 32 KiB UTF-8 /4096 UTF-16 code units |
| DTO | 512 KiB UTF-8 |
| Excerpt | 60,000 characters |
| CM capture | 64 KiB stdout /16 KiB stderr |

UTF-8 character/byte metrics are correlated, including truncated/opaque projections. Input/capture/observation/publication/outcome relationships are validated, not merely JSON shape.

Preflight renders command intent; it may read local selector metadata, but does not stage, probe the backend, or generate a patch. It is not conflict analysis or artifact existence proof.

## Validation scope

Comparison source evidence is bounded to Windows CM 11.0.16.10371 and the tested GNU diff backends; macOS text-only/backend incompatibility evidence is documented in setup. Other client/platform/backends, mixed-Xlink/nodata ownership, foreign post-hooks and RPC remain unverified. Those limits are not permission to silently switch routes.
