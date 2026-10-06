# Branch, workspace, and object discovery

[Documentation index](README.md) · [Status](2026-10-06-status.md) · [Safety and receipts](2026-10-06-safety-and-receipts.md)

Use an explicit structured source when you need reusable rows. Native/custom tables remain presentation rather than parsed identity evidence. Query filters describe requested scope—not returned metadata or verified ordering.

## Choose a source

| Tool | Default | Structured source | Row identity / scope |
|---|---|---|---|
| `plastic_currentBranch` | Direct branch resolution | No extra source selector | Exact unqualified branch path / workspace |
| `plastic_branchExists` | Leaf query plus full-path comparison | No extra source selector | Path existence / workspace repository |
| `plastic_branchList` | `source="native"` | `source="names"` | Unqualified branch paths / workspace repository |
| `plastic_workspaceList` | `source="native"` | `source="fields"` | Name/path/GUID / local client inventory, with ASCII prerequisite |
| `plastic_shelvesetList` | `source="native"` | `source="ids"` | Decimal ID and unqualified sh selector / workspace repository |
| `plastic_codeReviewFind` | `source="native"` | `source="ids"` | Decimal ID / workspace repository |

Structured list projections default to 100 rows and cap at 500. The optional CLI `limit` is separate; it does not prove repository totals or exhaustion. The entire captured structured response is validated before projection, including omitted rows.

## currentBranch

`action="current-branch"` returns the exact observed unqualified branch and basis `status`, `compact_status`, or `changeset_lookup`. No repository/server selector is invented.

Resolution follows the existing supported ladder: status; compact status only when normal output lacks a branch; changeset query only when compact output observes one changeset. Failure, cancellation, truncated/ambiguous/lossy output never authorizes another step.

Delimited paths retain spaces. Unsupported embedded selectors fail rather than shorten at whitespace. Core string output remains available; `format` changes presentation only, with legacy JSON's cached version observation outside DTO provenance.

## branchExists

`action="branch-exists"` returns exists, requestedBranch, comparisonBranch, and scope `workspace_repository`.

- The leaf query is not identity: exact full-path comparison prevents `/other/test` from proving `/main/test`.
- Valid empty query output means false in that scope. Malformed/skipped/duplicate/unexpected rows, stderr uncertainty, and failures are errors—not verified false.
- Existing comparison removes `br:` and normalizes backslashes; relative inputs are compared literally, not expanded.
- Qualified input still has `qualifierVerified=false`, even when exists=true. It proves path existence in the workspace repository, not existence in the requested foreign repository/server.
- Core output remains `"true"`/`"false"`; no format argument is added.

### Scalar read bounds

Identities: 4,096 characters; compact DTO: 16,384 UTF-8 bytes. Invalid/lossy/oversized Unicode identities fail rather than clip. U+FFFD and Windows `?` substitutions are rejected. Deterministic UTF-8 transport handles valid Unicode, but general live Windows/OEM round-trip support remains unverified. No XML/encoding fallback is added; legacy raw presentation/capture is outside the DTO cap.

Scalar failures withhold data and use sanitized codes such as command_failed, aborted, capture_incomplete, invalid_identity, malformed_output, invalid_producer_data, output_overflow.

## branchList

`source="names"` uses one `find branch … --nototal --format={name} --encoding=utf-8` response. Returned branches are exact unqualified hierarchical names; no metadata/version query or source fallback follows.

| Control or result | Meaning |
|---|---|
| `nameLike` | Filters the leaf, not full hierarchical identity |
| Parent/query qualifiers | Preserved request; not cross-repository verification |
| `descending` | Ignored without orderBy, preserving existing behavior |
| `includeHidden=true` | Rejected before execution for names; native retains the existing expression |
| Counts | Observed captured rows, returned/omitted projection, excluded=0 |

Names requires slash-rooted nonempty components and exact UTF-8, LF/CRLF, at most one terminal newline. Qualifiers, backslashes, controls, lone surrogates, U+FFFD, Windows `?`, blank/junk rows, duplicates and invalid identities fail the whole response. Paired emoji are retained. CLI collation/order is preserved without a stable tie-breaker.

The hidden-query restriction is based on anomalous installed-client source behavior; it is not repaired by rewriting the query. Installed CM disallows apostrophe/newline/CR in branch leaf names; unsupported query escaping is not substituted.

```js
const dto = await tools.plastic_branchList({source: "names", nameLike: "feature%", maxItems: 20});
text(dto.ok && dto.data.mode === "names"
  ? {branches: dto.data.rows.map(row => row.branch), counts: dto.data.counts}
  : dto.ok ? {rowsUnavailable: true} : dto.error);
```

Native/default preserves tables, predicates, ordering/limit and `(no output)`. Rows/counts are null, read/capture unknown, projection false; native table identities/counts are not parsed. `format="text"|"json"` is presentation, not source.

## workspaceList

**Fields requires independently known ASCII-only original names and paths in the entire selected local client inventory.** ASCII-looking formatter output alone is insufficient: CM can best-fit unsupported originals into printable ASCII or replace them with question marks.

Use `source="fields"` only under that configuration prerequisite. The receipt records the prerequisite and lack of independent original verification; source acceptance is limited to the tested Windows CM 11 configuration.

Fields uses one `workspace list` response with wkname, machine, path and wkid separated by tabs. No encoding/XML flags, registry-read producer, second snapshot or per-workspace lookup.

- Publish exact name/absolute path/GUID spelling. The machine field is parse-checked but not published as verified metadata.
- Scope is local_client_inventory, not the current repository, all users, or machine-wide inventory.
- Paths are producer_absolute syntax, not filesystem/platform verification.
- Counts are observed records, not unique workspaces or inventory exhaustion.
- Exact repeated four-field records remain in order; duplicateRecords covers the whole response. Conflicting reuse of GUID/name/path, including different unpublished machine fields, rejects the read.

Non-ASCII bytes, `?` identity fields, controls/BOM, blank/junk/wrong-field records, nonabsolute paths, invalid GUIDs or overflow fail with no partial reusable rows.

`format` is an arbitrary native CLI template; `output="text"|"json"` selects presentation separately. Meaningful custom format conflicts with fields; empty format keeps its ignored meaning. Native JSON retains its legacy version cache/wrapper and presentation line counts, not canonical workspace counts.

## shelvesetList

`source="ids"` uses one `find shelve … --nototal --format={shelveid} --encoding=utf-8` response.

Rows contain decimal string id and unqualified `sh:<id>` selector. Reuse only in the same workspace-repository context; qualifierVerified=false and no repository/server alias is inferred. Owner/comment/date are requested predicates, not returned metadata or Unicode-rendering guarantees.

Exact repeated IDs remain in order, with full-response duplicate diagnostics. Counts describe observed records, not unique shelvesets, repository totals, or exhaustion.

`format` and `dateFormat` are native CLI templates; `output` selects text/JSON independently. Meaningful templates conflict with ids; empty strings retain ignored behavior. Native rows/counts stay null and read/capture unknown rather than table-derived facts. Native text/error and `(no output)` behavior remain available; JSON contains the noncanonical native envelope without a new metadata query.

## codeReviewFind

`source="ids"` uses one `find review … --nototal --format={id} --encoding=utf-8` response. IDs are decimal strings, not JS numbers; no GUID, invented prefix, qualification, target/title/status/owner/assignee is recovered. Reuse only within workspace_repository scope; qualifierVerified=false.

Existing filters, escaping, sort fields date/modifieddate/status, ascending/descending, CLI limit and aliases remain. Descending without an order field retains ignored behavior. Query fields record intent, not verified metadata or sort correctness.

Meaningful native `format`/`dateFormat` conflicts with ids; empty strings retain ignored behavior. `output` is independent presentation. Native JSON retains its fenced wrapper/cached first-version lookup and presentation-only resultCount; those are not canonical ID/count evidence. Canonical IDs JSON uses the same DTO without that metadata command.

```js
const dto = await tools.plastic_codeReviewFind({source: "ids", assignee: "me", maxItems: 20});
text(dto.ok && dto.data.mode === "ids"
  ? {ids: dto.data.rows.map(row => row.id), counts: dto.data.counts}
  : dto.ok ? {rowsUnavailable: true} : dto.error);
```

## List grammar and bounds

Structured sources never infer empty rows from a failed command. Genuine accepted empty queries produce []/0; malformed/oversized sources return errors without reusable partial identities.

| Bound | names / fields / ids sources |
|---|---|
| Query strings/native templates and path/name identities | 4,096 UTF-16 code units |
| Decimal ID strings | 20 digits; canonical nonnegative grammar |
| Stdout / stderr | 1 MiB /64 KiB |
| Source records | 20,000 |
| Process timeout | 30 seconds; operation collector escalation applies |
| Returned rows | 100 default /500 max |
| Compact DTO | 131,072 UTF-8 bytes |
| Public error message | 256 characters max |

IDs accept LF/CRLF and one terminal newline without trimming. Foreign/header/blank/negative/fractional/leading-zero/non-ASCII/overlong records fail, including omitted rows. Exact repeats remain for IDs/fields; branch-name duplicates fail. Nonempty stderr, invalid bytes, cancellation, timeout and capture failure reject canonical source admission. Synchronous bounded parsing has boundary abort checks, not a hard JS deadline.

Native/custom routes retain legacy raw-presentation/capture limits; the structured table bounds above do not retroactively bound them. [Foreign hooks/RPC limits](2026-10-06-safety-and-receipts.md#evidence-and-transport-limits) also apply.

## Validation scope

Branch-name original/raw/registered equality was live-verified for spaces and several Unicode forms on Windows CM 11.0.16.10371, from root and subdirectory. Workspace fields requires its ASCII prerequisite; scalar Windows Unicode is not generally established.

Shelf/review canonical-ID source live validation covered clean empty queries. Later creation/update/deletion fixtures and external title queries do **not** establish native populated-list equality for these tools. Deterministic tests cover positive rows, grammar, precision, bounds, projection and SDK consumers. No universal platform/client/populated-inventory proof is implied.
