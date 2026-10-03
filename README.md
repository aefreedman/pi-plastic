# Pi Plastic

Pi tools, footer status, and skill guidance for Plastic SCM / Unity Version Control workflows.

## Tool presentation

Plastic tools use compact action headers inside Pi's standard tool boxes. Headers show the workspace name and the branch, file, revision pair, or query being acted on; command previews are labeled explicitly. Collapsed results summarize structured status counts, diff availability, patch output, and server-merge outcomes. Blocked checkins, unresolved effects, omitted results, and unavailable comparisons remain visible without expansion. Plain CLI output stays neutral rather than implying a verified mutation.

Expand a result using your configured tool-expansion shortcut to see the workspace, request, colored diff hunks, and complete original returned evidence. The display preserves JSON identifiers and numeric text, masks common credential assignments, and removes terminal control sequences. Rendering does not change tool execution or model-facing output; it is not a general source-code secret scanner.

Run `npm run preview:tools` from a repository checkout for offline examples. The preview uses plain colors and a test expansion binding; Pi supplies the live theme, box, and configured shortcut.

## Structured `plastic_status` output

The registered `plastic_status`, `plastic_currentBranch`, `plastic_branchList`, `plastic_branchExists`, `plastic_workspaceList`, `plastic_shelvesetList`, `plastic_codeReviewFind`, `plastic_diff`, `plastic_mergeBranches`, `plastic_checkin`, `plastic_branchCreate`, and `plastic_switchBranch` tools declare `outputSchema`; other adapters remain generic. Status returns a validated, versioned `structuredContent` envelope (`schemaVersion: 1` for existing routes, `2` for explicitly selected XML, `action: "status"`, `ok`, package/source provenance, `completeness`) independently of `format`. The string-returning core API remains available. Existing read adapters retain presentation in `details.rawResult`; selected diff/mutation receipts use empty details and producer-owned structured output. Compact model-facing `content` intentionally summarizes the DTO rather than copying raw output.

- **XML** (`source="xml"`): opt-in strict UTF-8 observation with `data.mode="xml"`, absolute CLI-observed paths, workspace-wide scope even when `workdir` is a subdirectory, XML-specific diagnostics, and explicit `baseRevisionAvailability="unavailable"`. `Path` is the moved destination and `OldPath` the source. No per-item revisions are fabricated from changeset/size/similarity. `short=true` and `includeRevId=true` are rejected before execution. Core text/JSON is explicitly synthesized from the same single XML snapshot, without extra text/version commands. `includeRaw=true` adds bounded, source-labelled XML only to presentation with a warning: it includes private repository/server/workspace metadata, never the compact native DTO.
- **Machine** (`machineReadable=true` or `source="machine"`): `data.mode="machine"`, `requestedShort`, workspace item observations (`statusCode`, `kind`, `path`, `isDirectory`, optional decimal `revisionId` and moved `sourcePath`), `summaryBasis="parsed_records"`, summary, parse diagnostics, and `itemCount`. `parsed` counts all parsed records; `returned`, `omitted`, `excluded` (identity/schema exclusions), and `overCap` describe projection, not missing workspace records. Summary totals precede projection and are **not verified workspace-wide counts**. The CLI's no-base revision `-1` is absent, not a reusable revision. Malformed revision tokens (including legacy numeric prefixes such as `41.5`) make the read incomplete and withhold the revision, while retaining the parsed row/count; status never substitutes a numeric prefix as a reusable identity. Paths are deliberate CLI-observed workspace identities and may be absolute. Header repository/server identities, internal normalized paths, cwd and raw output are excluded. Machine mode does not observe standard merge state.
- **Standard** (default): `data.mode="standard"`, `requestedShort`, `summaryBasis="short_output_classification"`, summary (including `other`), and `mergeHints` with `basis="text_hints"`. These are short-output classifications and text-derived merge hints, not machine-verified conflict counts. Read completeness is `unknown`. Both existing status commands must succeed; there is no fallback or retry.
- `completeness.read` is `complete`, `incomplete`, or `unknown`; `capture` is `complete` or `unknown`; `projection` is a boolean. In machine mode, unsupported/malformed records and ambiguous legacy moves yield successful **partial reads**, never a complete clean workspace. Successful machine stderr makes capture/read unknown without publishing stderr. Recognized blank/header records are not pending items. `short` describes requested scope, so even a complete read is not a claim about omitted CLI scope. Parse diagnostics are evidence counters, not mutually exclusive buckets: a parsed record can also be unsupported or malformed.
- Rows default to 100 and cap at 500 even for text presentation. Paths cap at 4096 characters, revision IDs at 128, and status codes at 64. Identity-bearing fields are excluded, never clipped. In machine mode, replacement characters (U+FFFD) in paths indicate possible decoding loss: such rows remain in parsed totals but are excluded from returned identities and make the read incomplete. This conservatively also excludes literal replacement-character filenames; CLI capture cannot distinguish them. On Windows, paths/source paths containing `?` are also excluded and make the read incomplete: Windows filenames cannot contain it, and local cm machine output substitutes it for unrepresentable characters before capture. POSIX `?` filenames remain supported. UTF-8 subprocess decoding preserves multibyte sequences across chunk boundaries, but does not infer or convert other encodings. Local Windows cm machine output was observed using OEM 437 bytes (for example `ü` as `81`, not UTF-8 `c3 bc`) and substituting Japanese/emoji with `?`. `--encoding=utf-8` succeeded without changing machine-output bytes; the option is documented for XML, which preserved these fixture names. No XML fallback or general Windows Unicode round-trip support is claimed.
- The compact DTO caps at 131072 UTF-8 bytes and fails closed on overflow. Existing machine/standard raw presentation (`includeRaw` and `details.rawResult`) and subprocess capture are **not** bounded by this DTO limit; XML has its separate transport/presentation bounds described below. Text calls do not add version lookups; existing JSON presentation may perform a cached `cm version` lookup, which is not DTO provenance.
- Producer failures return native `isError: true` with `ok:false` and a bounded sanitized `error.code/message`: `command_failed`, `aborted`, `capture_incomplete`, `invalid_producer_data`, or `output_overflow`. Unsupported CLI status is `command_failed`, never inferred from text or retried in another mode. Timeouts/truncation fail closed. Scripts must inspect `ok` and also handle host-native rejection (for example policy blocking).

Codemode and other `ctx.executeTool` consumers can use the final DTO without parsing text. For example, selectively emit changed paths:

```js
const dto = await tools.plastic_status({ source: "xml" });
text(dto.ok ? { read: dto.completeness.read, paths: dto.data.items.filter(i => i.kind === "changed").map(i => i.path) } : dto.error);
```

The optional `source` selector is `text | machine | xml`. Omitted preserves the existing `machineReadable` default/behavior. `text` and `xml` conflict with `machineReadable=true`; `machine` conflicts with explicit `machineReadable=false`. Existing aliases, registration order and status/scalar branch-read schemas remain unchanged. Status XML remains opt-in; checkin/scalar consumers remain unchanged. Consolidated diff uses a separate strict XML/base protocol, not a status-tool transport fallback. Branch-list has its separate explicit names source below.

XML has been live-validated only on Windows cm 11.0.16.10371. Supported record codes are CH, AD, DE, LD, MV and PR, with enTextFile/enDirectory types. Other codes/types, foreign/unknown important structures and duplicates fail closed rather than imply complete empty status. Exact Unicode code points and cm's absolute path spelling are preserved (including its observed lowercase drive letter); no Unicode normalization or encoding guess is used. `@xmldom/xmldom` 0.9.12 parses strict application/xml, throws every warning/error, and rejects DTD/entity declarations before parsing (conservatively including those token strings in comments/CDATA). Literal U+FFFD triggers a parser warning and is unsupported by this strict policy even with exact valid UTF-8; this is not evidence of CLI decoding loss. Numeric references remain subject to the same strict parser policy.

XML limits: stdout/document 1 MiB raw bytes, independent stderr 64 KiB, process timeout 30 seconds, element depth 16, records 20000, path/source path 4096 code units, code 64 and accumulated other scalar text 8192. Returned native rows remain capped at 500 (default 100) and compact DTO size at 131072 UTF-8 bytes. Overflow, invalid UTF-8/declaration/BOM disagreement, malformed XML, nonempty stderr, abort and command failure return sanitized native errors with no partial reusable identities. Whole-document DOM parsing is synchronous; depth/record/string checks run before projection but after DOM allocation, and cancellation is checked at parse boundaries, not midparse. The raw-byte bound limits that phase; process timeout is not a hard JS parser deadline.

Real Pi 1.0.0 host tests cover file loading, finalization, codemode receipts, a nested non-codemode consumer and JSON-serializable SDK execution events with a deterministic local provider and no network. Ordinary tool-result transcript messages do not automatically persist the full DTO. No RPC behavior is claimed. Foreign result hooks own their changes: content-only replacement can remove structured output and trigger host text fallback. The producer does not restore data or enforce bounds after foreign hooks.

Validation: `npm test` includes deterministic adapter/schema tests; `npm run test:host:status` runs the standalone real-host test.

## Structured branch-read output

`plastic_currentBranch` and `plastic_branchExists` return validated `schemaVersion: 1` envelopes with discriminated `action`, `ok`, the same external Plastic/package provenance as status, and `completeness`. Successful reads have `read="complete"`, `capture="complete"`, `projection=true` **within the stated scope**, not a cross-repository or workspace-history guarantee. Failures withhold `data`, set native `isError: true`, and return bounded sanitized `error.code/message` (`command_failed`, `aborted`, `capture_incomplete`, `invalid_identity`, `malformed_output`, `invalid_producer_data`, `output_overflow`). No raw CLI diagnostics, cwd, loader state or transport internals enter the DTO.

- **Current branch:** `action="current-branch"`, `data.branch` is the exact observed unqualified branch path, `scope="workspace"`, and `basis` is `status`, `compact_status`, or `changeset_lookup`. No repository/server selector is invented. One observation feeds both DTO and existing core string/expanded presentation. Resolution runs `status`, then `status --compact` only when normal output lacks a branch, then the existing changeset query only when compact output observes one changeset. Failed, cancelled, truncated, ambiguous or lossy observations never trigger another command. Explicit delimited paths preserve spaces; unsupported embedded selectors are rejected rather than shortened at whitespace. Mutation workflows retain their existing resolver. `format` changes presentation only; text adds no metadata lookup and JSON retains its cached CLI-version lookup outside DTO provenance.
- **Existence:** `action="branch-exists"`, `data.exists` is a boolean, with exact deliberate `requestedBranch`, normalized unqualified `comparisonBranch`, and `scope="workspace_repository"`. The existing leaf-name query plus exact full-path comparison is retained: `/other/test` cannot prove `/main/test`. Empty validated query output is false; malformed/skipped/duplicate/unexpected rows, successful stderr uncertainty, and capture/command failures are errors, never verified false. `br:` prefixes and backslash normalization retain existing comparison semantics; relative inputs are compared literally, not expanded. Repository/server qualifiers (including custom server selectors) remain deliberately outside query verification: qualified input reports `qualifierVerified:false`, **even when `exists:true`**. This means path existence in the workspace repository, NOT existence in the requested qualified repository. No new repository query is performed. Core string output remains `"true"`/`"false"`; no format argument is added.
- Every original/comparison/observed identity is bounded to 4096 characters. The compact DTO caps at 16384 UTF-8 bytes. Invalid, oversized, unpaired-surrogate or lossy identities fail closed, never clip. U+FFFD and Windows `?` substitutions are rejected. Valid fake UTF-8 transports round-trip Unicode, including chunk boundaries; general live Windows/OEM Unicode support remains unresolved, and no XML/encoding fallback is added. Raw presentation and subprocess capture are outside DTO bounds. Foreign hooks and RPC have the same limitations described for status.

```js
const current = await tools.plastic_currentBranch({});
if (!current.ok) { text(current.error); }
else {
  const result = await tools.plastic_branchExists({ branch: current.data.branch });
  text(result.ok ? { scope: result.data.scope, exists: result.data.exists } : result.error);
}
```

`npm run test:host:status` also covers both branch tools in a real file-loaded Pi host with finalizer, codemode and nested consumers, including boolean false and native failure receipts, using only a deterministic local provider.

## Structured branch-list output

`plastic_branchList` returns a validated closed `schemaVersion:1`, `action:"branch-list"` success/error envelope with external Plastic/package provenance. `source:"native"|"names"` is optional and defaults to **native**; `format:"text"|"json"` changes presentation only, not the DTO. One query supplies both presentation and DTO; neither route adds version/metadata queries or alternate-source fallback.

- **Native/default:** preserves the existing core table string, query predicates/order/limit and `(no output)` sentinel. `data.mode="native"`, `basis="find_branch_native"`, `rows=null`, `counts=null`, `countBasis="unavailable"`, `read="unknown"`, `capture="unknown"`, `projection=false`. Native table identities/counts are never parsed. Its legacy raw presentation/capture is not bounded by the compact DTO or row limits. The registered adapter classifies actual command/capture/abort flags without parsing CLI error text.
- **Names:** deliberately uses `find branch … --nototal --format={name} --encoding=utf-8`. `data.mode="names"`, `basis="find_branch_name_utf8"`, and `rows=[{branch:…}]` contain exact unqualified hierarchical identities. `counts.observed` covers the full valid captured query response before projection; `returned` and `omitted` describe projection, `excluded=0`, and `observed=returned+omitted`. Valid reads/captures are complete within query scope; projection is complete only with zero omissions. Genuine empty has `rows=[]` and zero counts, not native nulls. Malformed/duplicate/oversized/lossy rows anywhere in the response fail the whole observation, including rows beyond the projection cap.
- Both modes expose `scope="workspace_repository"`, `qualifierVerified:false`, requested `query` and `limits`. No repository/server qualifier is invented for rows. Requested qualified parent input is preserved, not claimed cross-repository validation. `nameLike` filters the branch **leaf**; CLI collation and returned order are preserved without a stable tie-breaker. Empty optional strings remain ignored predicates but are preserved in requested query fields. `descending` has no effect without `orderBy`.
- `limit` is an optional safe-integer CLI query cap, independent of `maxItems` (default 100/max 500 projection). No query limit is automatically inserted. Counts never imply repository totals, exhaustion or verified absence beyond the selected query.
- `includeHidden=true` is rejected **before execution only for names**, as `unsupported_query`: the installed CLI returned anomalous zero rows for the legacy hidden-true-or-false expression despite visible matches. Native retains that exact old expression; no hidden-policy fix or extra query is attempted.
- Query strings and identities are runtime-bounded to 4096 UTF-16 code units, never clipped/normalized. Names require a leading slash and nonempty components; qualifiers, backslashes, controls, lone surrogates, U+FFFD and Windows `?` are unsupported. Paired emoji are retained. Names accepts strict fatal UTF-8, CRLF/LF and one terminal newline; no trimming, interior blank rows, native-table parsing or already-decoded stream attestation.
- Names captures at most 1 MiB stdout bytes, independently 64 KiB stderr, 20000 records and a 30-second subprocess timeout (termination escalates after 5 seconds by default). Nonempty stderr, invalid UTF-8, spawn/nonzero failure, cancellation, timeout or truncated capture yield sanitized native `isError:true`, `ok:false` with no reusable partial data. The entire compact DTO caps at 131072 UTF-8 bytes; overflow fails rather than clipping identities/reducing rows. Public error code/message is bounded (message<=256); capture/command/workdir metadata is not in DTO. Codes: `command_failed`, `aborted`, `capture_incomplete`, `malformed_output`, `invalid_identity`, `unsupported_query`, `invalid_producer_data`, `output_overflow`.
- Names text is synthesized from returned rows plus explicit omissions, not unbounded raw capture; JSON is the same validated envelope. Details do not automatically duplicate the DTO, though explicitly requested JSON presentation contains it. Native raw details preserve legacy behavior. Foreign hooks own subsequent changes; no post-hook enforcement or RPC behavior is claimed.

```js
const dto = await tools.plastic_branchList({source:"names", nameLike:"feature%", maxItems:20});
text(dto.ok && dto.data.mode === "names"
  ? {branches:dto.data.rows.map(r => r.branch), counts:dto.data.counts}
  : dto.ok ? {rowsUnavailable:true} : dto.error);
```

Exact original/raw/registered-DTO equality for spaces, Latin, combining marks, Japanese and emoji was live-verified on Windows cm 11.0.16.10371, from workspace root and subdirectory. Other platforms/versions and native legacy Unicode are unclaimed. Installed cm forbids apostrophe/newline/CR in branch leaf names; unsupported query escaping is not rewritten. Existing status/currentBranch/branchExists Unicode policies are unchanged. `npm test` includes deterministic branch-list tests; `npm run test:host:status` also covers direct/finalizer/codemode/selective/nested consumers, SDK events and native failures with zero network. The opt-in read-only live test requires external caller-owned expectations via `PI_PLASTIC_BRANCH_LIST_LIVE_EXPECTATIONS`; no private workspace coordinates are package fixtures.

## Workspace-list structured output

`plastic_workspaceList` is the fifth schema-bearing tool: a closed versioned `action:"workspace-list"` native/fields/error envelope. Optional `source:"native"|"fields"` defaults to **native**. `format` remains an arbitrary native CLI template (not a presentation enum); `output:"text"|"json"` independently selects presentation. Default/native text, custom templates and the legacy native JSON wrapper/version cache remain unchanged. Native DTO rows/counts are null, read/capture unknown and projection false; legacy presentation line counts are not workspace counts.

**Fields requires independently known ASCII-only original workspace names AND paths in the entire selected local client inventory.** Do not use it for inventories containing unsupported Unicode identities. The formatter can replace non-ASCII with question marks **or best-fit it into printable ASCII**: an ASCII-looking response is not proof that originals were ASCII. This prerequisite is a configuration limitation, not per-call original verification, UTF-8 transport certification or universal Unicode support. Capability fields expressly record the prerequisite, no independent original verification and formatter-loss caveat. Current source acceptance covers only the tested Windows cm 11.0.16.10371 configuration.

Fields uses one `workspace list --format={wkname}{tab}{machine}{tab}{path}{tab}{wkid}` response; no XML/encoding flags, fallback, registry-reading producer, second snapshot, version call or per-workspace lookup. Meaningful custom `format` conflicts before execution; empty format retains its ignored legacy meaning. Name/absolute path/GUID spelling is preserved; the machine column is checked for parse safety but is not published as verified metadata. Scope is `local_client_inventory`, not current repository, all users or machine-wide inventory; paths are `producer_absolute` (drive/UNC or slash-root syntax, without platform/filesystem verification).

`maxItems` defaults to 100, maximum 500, and projects only after validating the entire captured response. Counts describe **observed CLI records, not unique workspaces, registry entries, inventory totals or exhaustion**. Exact repeated four-field records are preserved in order and counted; `diagnostics.duplicateRecords` counts repeats across the full response, including omitted rows. Conflicting reuse of GUID/name/path (including changed unpublished machine fields) fails the whole read. Observed/returned/omitted counts account for projection, excluded is always zero. An accepted empty response yields []/0 under the same prerequisite; failed, malformed or foreign output never establishes emptiness.

Non-ASCII bytes, question marks in identity-bearing fields, controls, BOM, blank/junk records, wrong field counts, nonabsolute paths, invalid GUIDs, identity overflow and conflicting records fail closed, with sanitized native `isError:true`/`ok:false`, never partial reusable rows. Names/paths are bounded to 4096 UTF-16 units; native templates to 4096 (tabs/newlines and Unicode templates remain supported, but NUL/lone surrogates are rejected). Fields stdout 1 MiB, stderr 64 KiB, timeout 30 seconds, records 20000, DTO rows 500 and compact envelope 131072 UTF-8 bytes. Native presentation/raw capture retains legacy bounds, not these fields guarantees. Parser validation is synchronous and bounded with abort boundary checks, not a hard JavaScript execution deadline.

```js
const dto = await tools.plastic_workspaceList({source:"fields", maxItems:20});
if (dto.ok && dto.data.mode === "fields") text(dto.data.rows.map(r => ({name:r.name,path:r.path,guid:r.guid})));
```

Text/JSON use the same observation and DTO; canonical JSON adds no metadata command. Deterministic transport/schema/core and real file-loaded Pi 1.0.0 host tests cover direct/codemode/selective/nested consumers, errors, preabort, policy hooks and SDK-event serialization with no network/provider charges. RPC and foreign post-hook enforcement remain unclaimed.

## Shelveset-list structured output

`plastic_shelvesetList` is the sixth schema-bearing tool, with a closed versioned `action:"shelveset-list"` native/ids/error envelope. `source:"native"|"ids"` defaults to native. Existing owner/comment/date predicates, CLI limit, custom `format`/`dateFormat`, core native table/error behavior and `(no output)` sentinel remain intact. `output:"text"|"json"` is a separate presentation selector; it never repurposes the CLI templates or adds a version/metadata query.

IDs uses exactly one `find shelve … --nototal --format={shelveid} --encoding=utf-8` response. Rows contain the observed bounded decimal `id` as a **string** (no JavaScript numeric precision loss) and its documented unqualified `sh:<id>` selector. These selectors are reusable only in the same workspace-repository context; no repository/server qualification is inferred (`scope="workspace_repository"`, `qualifierVerified:false`). Owner/comment/date values are requested filters, not returned metadata. No Unicode comment/date/owner rendering guarantee is implied by this numeric-ID source.

Meaningful custom `format` or `dateFormat` conflicts with ids before dispatch; empty strings retain their ignored legacy meaning. Native/custom DTOs have null rows/counts and unknown read/capture, rather than table-derived IDs. Native JSON presentation contains that noncanonical envelope; native text remains the original string. No hidden second query, fallback or metadata recovery is performed.

`maxItems` defaults to 100/max 500 and projects after full-response validation. CLI `limit` is independent and does not imply repository totals or exhaustion. Counts describe observed query records, not unique shelvesets; exact repeated IDs remain in order with full-response `diagnostics.duplicateRecords`. An accepted empty query yields []/0; failed, malformed or oversized output is an error with no partial reusable rows. The parser accepts canonical nonnegative decimal strings (at most 20 digits), LF/CRLF and one terminal newline, without trimming. Foreign/header/blank/negative/fractional/leading-zero/non-ASCII records, including those beyond projection, fail closed.

Bounds: query strings/native templates 4096 UTF-16 code units, IDs stdout 1 MiB/stderr 64 KiB/timeout 30 seconds/records 20000, rows 500, compact envelope 131072 UTF-8 bytes and sanitized errors <=256 characters. Native raw presentation retains legacy bounds. Cancellation/stream/spawn/stderr/capture failures return native `isError:true` and `ok:false`; synchronous bounded parsing has boundary abort checks, not a hard JavaScript execution deadline. Foreign post-hook enforcement and RPC are unclaimed.

```js
const dto = await tools.plastic_shelvesetList({source:"ids", owner:"me", maxItems:20});
text(dto.ok && dto.data.mode === "ids" ? dto.data.rows.map(r => r.shelveset) : dto.ok ? {rowsUnavailable:true} : dto.error);
```

The installed Windows cm 11.0.16.10371 help documents `shelveid`, workspace-repository default scope, templates and UTF-8 encoding. Read-only registered live checks verified clean empty queries, one query per call and unchanged selector/status; the test sandbox currently contains no shelvesets. **Populated live source/original equality has not been verified.** Positive rows, precision, grammar, projection, schema and transport are covered by deterministic tests and actual file-loaded Pi 1.0.0 host consumers without provider/network charges. No shelvesets were created/applied/deleted for validation.

## Code-review-find structured output

`plastic_codeReviewFind` is the seventh schema-bearing tool, with closed versioned `action:"code-review-find"` native/ids/error output. Additive `source:"native"|"ids"` defaults to native, and `maxItems` defaults to 100/max 500. Existing status/assignee/owner/target/target-type/title predicates and escaping, ordering (date/modifieddate/status, ascending/descending), CLI limit, aliases, native templates and `output:"text"|"json"` remain intact. Descending without an order field retains its ignored legacy meaning.

IDs uses one `find review … --nototal --format={id} --encoding=utf-8` response. Rows contain only the observed canonical nonnegative decimal `id` **string**, bounded to 20 digits without JS numeric precision loss. The CLI documents these as numeric review identifiers; use only in the same workspace-repository context. No invented prefix, repository/server qualification, GUID, target identity, title, status, owner or assignee is recovered (`scope="workspace_repository"`, `qualifierVerified:false`). Query fields describe requested filters/order, not returned review metadata or proof of sort correctness. Numeric output implies no general Unicode metadata rendering guarantee.

Meaningful custom `format`/`dateFormat` conflicts with IDs before dispatch; empty strings preserve ignored legacy behavior. Native/default/custom text and fenced legacy JSON (`toolVersion`, cached `cliVersion`, command/rawOutput/presentation-only resultCount) stay unchanged. Its existing first-version lookup/cache is retained only for native JSON, not canonical IDs. Native producer DTO rows/counts are null and read/capture unknown; the legacy JSON's line count is not canonical identity/count evidence. Canonical JSON instead presents the same normalized DTO supplied to direct/codemode/nested consumers.

All captured rows are validated before projection, including omitted ones. Exact repeats remain in order with full-response duplicate diagnostics. Counts describe observed query records, not unique reviews or repository totals/exhaustion; CLI limit and projection are independent. Clean empty queries yield []/0; failed/malformed/oversized sources return native `isError:true` plus `ok:false`, never partial reusable IDs or a false clean-empty response. No hidden fallback, metadata recovery or review mutation is performed.

Bounds: query strings/native templates 4096 UTF-16 code units, IDs stdout 1 MiB/stderr 64 KiB/timeout 30 seconds/records 20000, rows 500, compact UTF-8 envelope 131072 bytes, sanitized errors <=256 characters. Strict decimal grammar accepts LF/CRLF and one terminal newline without trimming, rejecting foreign/blank/leading-zero/negative/fractional/overlong/non-ASCII records. Native raw presentation keeps legacy bounds; synchronous bounded parsing has boundary abort checks rather than a hard JavaScript execution deadline. RPC and foreign post-hook enforcement are unclaimed.

```js
const dto = await tools.plastic_codeReviewFind({source:"ids", assignee:"me", orderBy:"date", descending:true, maxItems:20});
text(dto.ok && dto.data.mode === "ids" ? dto.data.rows.map(r => r.id) : dto.ok ? {rowsUnavailable:true} : dto.error);
```

Windows cm 11.0.16.10371 help documents review ID, filters/sort fields, workspace-repository default scope, templates and encoding. Six registered read-only live probes (four IDs/two native JSON) verified genuine empty queries, one list command each, retained native version lookup/cache and unchanged selector/status. **Populated live review IDs/original equality remain unverified:** the sandbox has no reviews; positive identities, bounds and transport/consumer cases are deterministic fixtures. Actual file-loaded Pi 1.0.0 host checks use no provider/network charges. No reviews were created/updated/deleted for testing.

## Consolidated diff structured output

One `plastic_diff` replaces the specialized diff tools without aliases or old-name redirects. Require an explicit closed mode:

- `mode:"file"`: `path`, optional `revision`. Omit revision for a hash-verified loaded base versus a bounded local snapshot. Explicit revision bypasses status/base queries.
- `mode:"revisions"`: `leftRevision` and `rightRevision`. Two sequential owned exports. Requested selectors retain null resolved identities; no immutable, same-file, atomic selection or independent qualifier verification is claimed.
- `mode:"workspace"`: nonempty `paths` (at most 20) **or** `allPending:true`. Only all-pending accepts `includePrivate`. `maxFiles` is 1–20, default 3 all-pending/20 scoped. Directory scopes match pending descendants; directory rows are explicitly skipped. A moved source or destination selects the same single observation.

All modes return one closed versioned `action:"diff"` envelope, independent of text/JSON format. Comparison data records kind, pending kind, side origin, selector/path, observed loaded identity when available, bytes/binary flags, backend/capture evidence and normalized excerpt counts. Workspace results retain per-file failures with `ok:false` and native `isError:true`, plus parsed/eligible/selected/attempted/completed/failed/skipped/unattempted/limited/returned/omitted counts, private exclusions and unmatched paths. Inspect read/projection completeness before concluding a review is complete.

Loaded bases use strict UTF-8 status, fileinfo and ls observations: a genuine qualified file revision ID with observed repository/server, agreement with loaded fileinfo metadata, and exported bytes matching its MD5/SHA1 hash. Controlled deletions deliberately query the frozen loaded root tree; local moves use observed OldPath metadata. No changeset is converted to a revision, no bare-ID ownership guess or failed-query fallback is used, and metadata queries are for correctness rather than decoration. Added and explicitly selected private files use synthetic empty bases; added-empty is distinct from unchanged. Unsupported/nodata/ownership sources fail instead of becoming empty sides. Mixed-Xlink ownership remains unverified.

Historical exports use new owned temporary destinations outside the workspace. Local snapshots require physical workspace containment, regular non-symlink files, bounded descriptor reads and stable observable identity/size/timestamps/namespace. Captured bytes are independent of later edits, **not an atomic filesystem/repository snapshot**. Cleanup completes before success. Each side is limited to 4 MiB retained/read bytes, not a hard cat disk-transfer quota. Commands capture at most 1 MiB stdout/64 KiB stderr with 30-second timeout initiation plus escalation.

Text requires one configured GNU/POSIX `diff -u`: normal exit 0 with empty output or exit 1 with complete fatal-UTF-8, structurally consistent unified hunks. NUL/invalid-UTF-8 input uses internal byte equality. Signal/null terminals, stderr, timeout, malformed/partial streams, failed exports, oversized files and cleanup failures return sanitized errors. No backend switch/retry. English GNU no-final-newline markers are supported; unverified variants fail closed.

File/revisions excerpts default to 8000 characters (500–20000); workspace defaults to 3000 (500–8000). Normalized UTF-16 source/marker/omission counts use surrogate-safe projection. Excerpts are not guaranteed applyable patches. The compact envelope caps at 131072 UTF-8 bytes; workspace projection may omit whole outcomes with explicit counts, never clip identities. Presentation caps at 24000 characters and JSON stays valid, possibly directing callers to structuredContent instead of duplicating it. Foreign hooks own later changes; RPC/post-hook enforcement is unclaimed.

```js
const dto = await tools.plastic_diff({mode:"file", path:"Assets/Example.txt", maxChars:3000});
text(dto.ok ? {status:dto.data.status, excerpt:dto.data.excerpt?.text} : dto.error);
const pending = await tools.plastic_diff({mode:"workspace", paths:["Assets/Example.txt"]});
text({ok:pending.ok, completeness:pending.completeness, data:pending.data});
```

Focused tests cover all modes, Unicode moves, deleted-tree bases, empty/binary additions, scopes and partial failures. Live source evidence is bounded to Windows cm 11.0.16.10371 and local GNU 2.8.7/3.12; other platforms/backends and mixed-Xlink/nodata ownership remain unverified. Raw GUI `cm diff` and `cm differences` remain blocked.

## Workspace-free server merge receipts

`plastic_mergeBranches` is the ninth schema-bearing tool: a closed v1 `action:"merge-branches"` receipt with discriminated preflight/completed/no-op/unsupported/conflict/uncertain/failed outcomes. Core text/fenced JSON and registered text/JSON derive from one producer observation. Registered failures set native `isError:true`; details do not duplicate raw diagnostics or the DTO.

Supply fully qualified, distinct source/target branches in the same exact requested repository/server, and a nonempty message (each at most 4096 UTF-16 units). Supported unambiguous syntax is `br:/branch@repository@server`, with no @ inside branch/repository; server may be a literal host or include its full @cloud/@unity suffix. Unknown fields, workdir, controls and malformed Unicode fail before commands. Requested server names and genuine emitted server aliases are kept separately; their equivalence is **unverified**, not guessed.

Preflight renders argv intent only: zero help/version/merge/status commands and no remote analysis. Application performs one local help syntax check and at most one noninteractive server merge. Completed means a complete valid normal-exit response emitted exactly one matching branch/repository/root-mount changeset; its exact decimal ID and complete emitted server qualifier are retained. It does not prove target-head exclusivity, source merge-link identity, alias equivalence, rollback or Xlink effects. ALREADY_CONNECTED supports a no-op classification with `effect:"not-proven"`, not independently verified unchanged state.

The selected byte collector bounds stdout/stderr to 64 KiB/16 KiB, with fatal UTF-8, genuine nullable exit/start/terminal facts, 3-second help and 30-second merge timeout initiation plus bounded termination escalation. Help also retains its 16384 decoded-unit gate; merge uses source-byte bounds. Full captured framing/records are classified before at-most-100 reference projection, with observed/returned/omitted counts; unknown/contradictory/malformed/overlimit evidence cannot become success. DTO/presentation caps are 131072 UTF-8 bytes/24000 units. No raw stderr, version decoration, implicit postflight query, retry, XML fallback, console encoding change or workspace mutation is added.

After timeout/cancellation/capture or producer failure with possible start, the receipt remains uncertain: it must not imply no effect or safe replay. Strict byte/schema/lifecycle/static tests and real Pi direct/codemode/nested/event consumers cover this boundary. Actual source/registered acceptance is Windows cm 11.0.16.10371; other platforms/configurations, RPC and post-foreign-hook enforcement remain unclaimed.

## Plastic branch footer status

When Pi starts inside a Plastic workspace, this package adds a themed `Plastic <branch>` status to Pi's built-in footer. It discovers the nearest enclosing `.plastic/plastic.workspace` and reads either the selector's `smartbranch` or `br` form as the credential-free branch source. A bounded `cm status` call is used only when the selector has no valid branch. Selector changes and successful same-workspace `plastic_*` tools refresh the status; sibling workspaces are ignored.

The extension owns only the `plastic-branch` status key. It does not replace Pi's footer or suppress Pi's Git branch display, so Git and Plastic information can appear together in nested workspaces. If the Plastic marker exists but neither the selector nor `cm` yields a branch, the footer shows `Plastic branch unavailable`. Non-Plastic directories show no Plastic status.

## File-discovery filter

When `@aefree/pi-file-discovery` is also loaded, Pi session startup registers the independent advisory `plastic.ignore-files` file-discovery filter through the package-qualified capability-registry rendezvous key. The packages may have separate module roots; Plastic does not import file-discovery from its own root. It discovers readable `ignore.conf` and `cloaked.conf` only from the nearest Plastic workspace to each requested root, then supplies them as ripgrep ignore files without replacing native ripgrep/Git-ignore behavior. A root is emitted only when it has at least one readable ignore/cloak file; each emitted root declares `filterDecision: "applied"`, decision code `plastic_ignore_files_applied`, and that workspace as its `filterBoundary`. No-op Plastic roots are omitted from mixed requests, and a request with no effective ignore/cloak records is `not_applicable`. The integration is optional: without `pi-file-discovery`, all Plastic tools and skills still load and no filter registry is created. Missing, malformed, or unavailable Plastic filter data degrades to generic discovery; `pi-file-discovery` owns that execution hygiene and disclosure behavior. It does not register workflow guidance or perform Plastic CLI readiness checks; owning `plastic_*` tools validate their own workspace and CLI requirements.


## Mutation execution

Directly invoked mutating `plastic_*` tools do not require approval tokens or package-owned UI confirmation. After the tool's existing argument, command, workspace-readiness, exact-target, and path-containment checks pass, each command attempt proceeds to its intended `cm` spawn. The process layer makes one attempt and does not retry implicitly; inspect Plastic status before manually retrying an ambiguous side-effecting failure.

Removing the approval layer does not relax Plastic safety guards. Command allowlists, exact mutation targets, workspace/path containment, non-interactive process selection, blocked `cm diff`, safe merge flags, and operation-specific preflight behavior remain authoritative. Compound tools may intentionally execute multiple validated command steps.

## Switch-branch receipts

`plastic_switchBranch` is the twelfth schema-bearing tool. Its closed v1 native receipt (`action: "switch-branch"`) distinguishes preflight, already-loaded, canceled, blocked, switched, command-completed-unverified, failed and uncertain outcomes. Ordered bounded step records retain earlier shelveset/switch command completion and possible effects after later failures. No shelveset ID, rollback, file preservation, alias equivalence or Xlink result is invented. Text/JSON views share one observation; neither adds a version query. Core calls remain string views but reject non-preflight failures, including policy cancellation, so compound consumers cannot continue after an unsuccessful switch.

Direct standard-status loaded branch and strict complete pending evidence are required on the observed Windows cm11.0.16.10371 source. Compact changeset ownership is not a loaded branch; malformed/lossy/skipped pending rows cannot mean clean. Targets must be bounded hierarchical branch selectors, optionally completely qualified; dispatch preserves the original target. Already-loaded comparison requires exact branch name and, when requested, exact repository/server spelling. Different server aliases are not inferred equivalent. A completed switch with failed/mismatched post-observation or unverified qualification returns a native error retaining command completion, not verified switched.

Pending policy is preserved: tracked bring is blocked; private-only defaulted cancel/bring/shelve switches directly without a shelveset; explicit cancel with pending is canceled. Tracked shelve uses shelveset create then silent/noinput switch. Recovery is permitted only after the observed complete exit1 empty-stdout workspace-specific no-changes error and an admitted recovery read proving no tracked pending. Failed recovery stops, never substitutes empty. Failed shelving remains uncertain preservation even after recovery and a verified loaded target. No automatic retry, undo, shelveset apply/delete, update/checkin or switch-back follows.

Preflight performs two sequential local reads, not server switchability/conflict proof. Direct application uses four commands; shelving five, eligible recovery at most six. Observations are not atomic. Pending capture caps at1 MiB stdout/64 KiB stderr and20000 records; other source commands64 KiB/16 KiB; six step records and131072-byte compact DTO. Identities cap4096 UTF-16 units and are never clipped; standard header admits only the observed head grammar. Each selected command has the same finite30+5+5-second nominal retirement budget as checkin/branch-create; forced retirement is not process-stop or rollback proof. Other collectors/platforms/configurations remain unchanged/unclaimed.

## Checkin and branch-create receipts

`plastic_checkin` and `plastic_branchCreate` are the tenth and eleventh schema-bearing tools (27 core registrations plus loader). Both return closed v1 producer-owned receipts, native `isError`, empty details and bounded presentation from the same observation. Core calls still return strings; text/JSON checkin presentation never adds an observation. No new mode, alias or verification query is introduced.

Checkin admits the observed Windows cm11.0.16.10371 STATUS/pending and nonce-framed CI_START/STAGE/CO/AD/DE/MV/CHANGESET grammar. It preserves original Unicode, decimal-string changeset IDs, explicit `br:` and the complete emitted server tail. One admitted root changeset on successful complete capture establishes `changeset-created`; exit zero or empty output alone does not. Scope exhaustion, branch head, alias equivalence, merge-link identity and Xlink effects remain unverified. Unknown/malformed/full-tail records, incomplete capture and invalid UTF-8 fail admission before projection.

`preflight=true` reads pending scope once but performs no mutation; it is not server-merge's zero-command preview. Eligible complete admitted native failures may retain legacy path fallback or sensitive-filtered private add/retry behavior. Timeout, abort, launch/capture uncertainty and unadmitted evidence never authorize retry. Per-step attempted/started/terminal/capture/effect facts retain successful earlier adds/checkins after later failure. Failed recovery/post reads remain null, never clean; even genuinely empty pending after failed checkin does not establish completion. `updateAfter` remains blocked before dispatch.

Branch-create rejects qualifier-bearing relative names/parents before commands rather than silently dropping repository/server scope. Use an explicit parent when standard status cannot directly observe the loaded branch; compact cs-only status and changeset-owner lookup cannot resolve it. Full hierarchical qualified targets stay verbatim. Top-level creation still requires `allowRootBranch=true`. Successful complete exit-zero capture, including empty stdout, proves only `command-completed`, with `effect="not-proven"` and `observedCreatedIdentity=null`; repository/domain creation is unverified and no workspace switch is requested. There is no branch-create preflight.

Both selected collectors retain at most 65536 stdout / 16384 stderr bytes per command, fatal UTF-8 with original BOM retained, and bounded abort/timeout cleanup. The selected command deadline is 30 seconds; termination retains 5 seconds TERM→KILL grace plus at most 5 seconds further drain before forced retirement (at most 40 seconds from a deadline-bound dispatch, or 10 seconds after an earlier abort/capture-failure termination request). Retirement preserves genuine observed start/terminal/exit facts but is not proof the child stopped, rolled back or can be safely retried. It marks capture incomplete, retires own active handlers/timers/pipes and keeps only state-free late-error sinks on retired emitters. Non-preflight core checkin rejects every failed receipt so legacy closeout cannot mistake presentation for success; registered execution still returns native structured errors. Identities are at most 4096 code units and aggregate receipts 131072 UTF-8 bytes. Checkin has at most eight steps, 500 admitted source records per observation, one aggregate 100-reference projection budget with explicit omissions, and 24000-byte presentation. Branch-create keeps whole references rather than trimming; argv and envelope overflow fail closed. This is an observed Windows source profile, not an all-platform or universal original-byte fidelity claim.

Current deterministic validation uses local Pi SDK/tui 1.0.1 and its required TypeBox 1.3.27. `npm run test:host:status` includes real file-loaded direct/codemode/nested consumers, JSON SDK events, native errors, policy and foreign-result hooks, selective context, actual command counts, uncertainty/bounds and compound effects for both tools, using a local deterministic provider and synthetic Node CLI only. Host preabort/policy can short-circuit before a producer receipt; foreign hooks can remove it. Earlier 1.0.0 validation and parent Windows source probes remain historical evidence, **not registered live acceptance** for these tools. No RPC, paid-provider, post-hook enforcement, alias/head/Xlink/link verification or cross-platform acceptance is claimed.

## Tools

- `plastic_tool_search` (dynamic capability search and loader)
- `plastic_status`
- `plastic_update`
- `plastic_add`
- `plastic_checkin`
- `plastic_undo`
- `plastic_resolveDeleteChangeConflict`
- `plastic_diff`
- `plastic_patch`
- `plastic_branchCreate`
- `plastic_switchBranch`
- `plastic_merge`
- `plastic_mergeBranches`
- `plastic_mergeToBranch`
- `plastic_finalizeMerge`
- `plastic_currentBranch`
- `plastic_branchList`
- `plastic_branchExists`
- `plastic_branchDelete`
- `plastic_shelvesetCreate`
- `plastic_shelvesetApply`
- `plastic_shelvesetDelete`
- `plastic_shelvesetList`
- `plastic_codeReviewCreate`
- `plastic_codeReviewUpdate`
- `plastic_codeReviewDelete`
- `plastic_codeReviewFind`
- `plastic_workspaceList`

## Dynamic tool loading

The package exposes 27 public `plastic_*` tools. `plastic_workspaceCreate` is intentionally not registered or discoverable until the package provides a paired, safe workspace-cleanup capability. `plastic_tool_search` is a package-owned loader that searches the explicit Plastic capability catalog, reports bounded matches and safety guidance, and additively enables selected tools for the next model request.

The default **balanced** session set keeps `plastic_tool_search`, `plastic_status`, and `plastic_currentBranch` active. The other Plastic tools remain registered but inactive until selected; built-in and other-extension tools are not removed. Previous loader additions on the active session branch are restored on startup, resume, fork, and reload.

For controlled comparisons, set `PI_PLASTIC_TOOL_LOADING_MODE` before starting Pi:

```bash
PI_PLASTIC_TOOL_LOADING_MODE=balanced    # default production candidate
PI_PLASTIC_TOOL_LOADING_MODE=loader-only # maximum initial schema reduction
PI_PLASTIC_TOOL_LOADING_MODE=all-active  # all 27 currently exposed tools; loader omitted
```

Pi uses canonical `sourceInfo` provenance to identify this package's effective tools before deferring, restoring, or activating them. If canonical provenance or ownership of the effective loader cannot be proven, `pi-plastic` fails safe: it preserves the complete current active set exactly, does not defer, remove, or activate any `plastic_*` name, and an effective package loader can only report known tools that are already active rather than activating inactive names. On sourceInfo-capable Pi instances, providers without native deferred definitions still receive the complete current active set after a loader call. Reload or restart Pi after source edits; source files are not watched automatically.

## Safety behavior

The Bash guards run only in Pi processes that actually load this package. A project-local install does not protect a delegated child process whose working directory resolves different project settings. Install `pi-plastic` at user scope (the default `pi install`, without `-l`) when subagents and sessions in arbitrary workspaces must inherit the guards. Restart existing Pi processes after installation or source changes.

- `plastic_branchCreate` supports an explicit parent branch independent of the loaded workspace branch, defaults relative names only to a directly observed loaded branch when no parent is supplied (never a changeset owner), and rejects top-level paths unless `allowRootBranch=true` is explicit.
- `plastic_diff` requires explicit file/revisions/workspace mode and bounded scope. Status remains the changed-path listing tool; do not diff routinely. Raw GUI cm diff/differences remain blocked; patch generation remains separate.
- `plastic_status(machineReadable=true, format="json")` returns parsed `items`, aggregate `summary`, and `itemCount` (`total`, `returned`, `omitted`) rather than requiring agents to parse Plastic rows. It returns at most 100 items by default; set `maxItems` (up to 500) when more are intentional. `includeRaw=true` adds the original unbounded Plastic output for diagnostics, so omit it for normal agent use to conserve context tokens.
- Local diff snapshots require physical containment and regular non-symlink files. Unresolved loaded ownership and unsupported linked-tree observations fail closed; mixed-Xlink support is not claimed.
- Preflight is not routine confirmation. Use it for ambiguous or broad mutation scope, moved/deleted path rewriting, compound operations, or explicit preview requests; otherwise rely on exact targets and the tools' runtime guards.
- `plastic_patch` generates review patches with `cm patch`, including `clean` and `integration` filters for branch review workflows. It does not expose patch apply. Unqualified `br:/...` selectors are qualified only with the current workspace selector's exact repository; otherwise pass `br:/<branch>@<repository>@<server>`.
- Bash safety rails block `cm diff` and unsafe interactive `cm merge --merge` usage.
- Merge tooling surfaces Plastic `FILE_CONFLICT` records and merge-state metadata from `cm status`.
- `plastic_mergeBranches` is a separate workspace-free server-side route. It requires fully repository/server-qualified source and target branches in the same exact repository/server and a nonempty message. Its optional preflight only renders the command; it does not analyze remote conflicts. A completed result proves one emitted root-mount target changeset for this dispatch, not source merge-link identity, exclusive target-head ownership, server capability beyond the dispatch, rollback, or xlink effects. No-op and conflict records do not independently prove that no server effect occurred. The route has no workspace fallback, retries, target-head unification, xlink policy, shelve mode, or conflict-policy override; undetected server-side xlink effects remain possible.
- `plastic_mergeToBranch` performs the common safe closeout flow: resolve the source branch's parent as the default target, switch to the target branch, optionally update, merge a source branch non-interactively, verify merge state, and check in the merge result. It verifies the loaded target before merge/checkin and rejects final-branch mismatches; Plastic checkins stay on the branch where they were created, so switching afterward is not a Git-style integration.
- `plastic_finalizeMerge` supports reviewed/manual-resolution flows where Plastic still needs merge metadata finalized before checkin.

## Patch generation examples

```text
plastic_patch(source="<branch-spec>", integration=true)
plastic_patch(source="<branch-spec>", clean=true, integration=true, output="<patch-file>")
plastic_patch(source="<left-spec>", destination="<right-spec>")
plastic_patch(source="<branch-spec>", toolPath="<path-to-diff-tool>")
```

If `output` is omitted, the package returns patch content. If `output` is provided, it must be a new path: the package generates into a package-owned sibling staging file, validates it, and atomically publishes it without overwriting an existing path. Plastic/server patch output may encode a moved item either as a move or as delete/add records; `pi-plastic` does not claim a representation without a live backend fixture. Inspect patches before sharing them because they can contain source code, binary content, local paths, or secrets that were present in the changed files.

## Included skill

- `using-plastic` - PlasticSCM branch, workspace, merge, shelveset, checkin, and code-review workflow guidance

## Install

Install the latest stable npm release at user scope so the safety guards also load for delegated child processes in other workspaces:

```bash
pi install npm:@aefree/pi-plastic
```

Install a pinned GitHub release over HTTPS:

```bash
pi install git:github.com/aefreedman/pi-plastic@v0.7.6
```

Equivalent SSH install:

```bash
pi install git:git@github.com/aefreedman/pi-plastic@v0.7.6
```

To intentionally track the moving default branch instead of a release tag:

```bash
pi install https://github.com/aefreedman/pi-plastic
```

Local development install:

```bash
pi install <path-to-pi-plastic>
```

Project-local install:

```bash
pi install -l <path-to-pi-plastic>
```

Project-local installation protects only Pi processes that load those project settings. It is insufficient as a global Bash safety rail when a subagent launches with another working directory.

## Requirements

- Node.js 22.19.0 or newer
- Latest stable Pi; the current development and eval baseline is Pi 1.0.1
- Plastic SCM / Unity Version Control CLI (`cm`) available on `PATH`, or `PI_PLASTIC_CM_EXECUTABLE` set to its full executable path
- A GNU/POSIX-compatible text `diff` available on `PATH`, or `PI_PLASTIC_DIFF_EXECUTABLE` set to its full executable path (including paths containing spaces), for text-only diff tools. Pi invokes that resolved executable as-is and does not discover Git Bash paths automatically. On macOS, bare `diff` is PATH-dependent: it may be GNU Diffutils (often installed as `diff` ahead of system paths) or Apple’s BSD `/usr/bin/diff`; the package does not substitute one for the other. Configure the intended text executable explicitly when that distinction matters.
- Patch generation has a separate executable policy: `toolPath` is the one-call highest-priority override, followed by `PI_PLASTIC_PATCH_EXECUTABLE`. On Windows, set one to a verified patch-capable non-GUI executable such as Git's `diff.exe`; the package deliberately does not reuse `PI_PLASTIC_DIFF_EXECUTABLE`/GnuWin32 as a patch default. macOS validation with Plastic 11 found that Apple BSD `/usr/bin/diff` supports text-only diffs but rejects the `--binary` argument supplied by `cm patch`; configure a verified GNU Diffutils-compatible executable explicitly for `plastic_patch`. The non-Windows fallback to `PI_PLASTIC_DIFF_EXECUTABLE` or bare `diff` remains only for environments whose resolved executable satisfies that patch contract. In an interactive Pi session, an invalid configured patch override or missing Windows patch setting produces one package capability warning per Pi runtime; the warning omits configured paths, and `plastic_patch` retains its tool-time validation.
- A configured Plastic workspace for workspace-scoped operations. Text diffs require an ASCII-safe temporary directory; if the configured backend cannot accept Unicode paths, set `TEMP` and `TMP` to a writable ASCII-only location.
- `pi-file-discovery` is an optional independently loaded integration. When its `discover_candidate_files` tool is active, it receives the advisory Plastic ignore/cloak filter through the shared global capability protocol; when absent, `pi-plastic` loads without file-discovery filtering. The tarball does not embed linked sibling workspaces or `node_modules` paths.

## Testing

```bash
npm test
```

`npm test` first runs `npm run typecheck` with pinned TypeScript and Node 22 types. The strict, no-emit check covers `index.ts`, `src/`, every extension, and compile-only schema-inference contracts under `tests/types/`. Runtime tests and eval harnesses execute through `tsx`.

The default suite is credential-free and covers tool validation, schema conversion, path-resolution regressions, extension registration, rendering, OpenAI strict-schema compatibility classification, and bash guard behavior.

Run the opt-in read-only live smoke test against a dedicated clean sandbox workspace:

```bash
PI_PLASTIC_TEST_WORKSPACE=/absolute/path/to/sandbox npm run test:live
```

The live test requires `/main`, no pending changes, and no merge in progress. It does not mutate the repository. Mutation tools should still be rehearsed manually in a disposable sandbox before relying on them in a new environment.

### Dynamic tool-loading eval

The package-local behavioral eval uses fresh Pi 1.0.1 JSON subprocesses against an explicitly attested dedicated Plastic sandbox and is not a skill eval. It compares all-active, balanced, and loader-only mode behavior, checks exact smallest-sufficient loader activations, blocks destructive calls unless they are supported `preflight: true` previews, captures tool calls and sanitized provider-schema measurements, and deletes raw provider payload captures by default.

```bash
npm run eval:tool-loading -- --dry-run
PI_PLASTIC_EVAL_SANDBOX=/absolute/path/to/sandbox PI_PLASTIC_EVAL_ALLOW=dedicated-sandbox npm run eval:tool-loading -- --model openai-codex/gpt-5.6-luna --condition balanced
```

See [`evals/tool-loading/README.md`](evals/tool-loading/README.md) for approved model restrictions, cases, measurements, and result hygiene.

## Constrained sampling compatibility

Pi supports provider-side constrained sampling for tools. `pi-plastic` does not currently opt in: every public Plastic schema includes optional fields (at minimum `workdir`), while OpenAI strict function schemas require closed objects and all declared properties to be required. Pi forwards the registered schema without converting those optional fields.

Enabling `strict: "prefer"` now would therefore either produce invalid strict OpenAI requests or require a breaking redesign of the ordinary tool arguments. The test suite audits all registered tools and prevents accidental opt-in until a schema is genuinely strict-compatible. Existing TypeBox validation and Plastic runtime safety checks remain authoritative.

OpenAI Codex models may advertise grammar tools without advertising strict JSON-schema tools. Grammar sampling is not used here because Plastic operations have structured multi-field arguments rather than a single bounded string language.

## Implementation notes

- The core implementation lives in `src/plastic-core.ts`.
- Shared workspace discovery and branch parsing live in `src/plastic-workspace.ts`.
- `extensions/plastic-branch-status.ts` owns the additive footer status and its session-scoped refresh lifecycle.
- `index.ts` is the Pi tool registration layer.
- `src/plastic-renderers.ts` owns compact calls, result summaries, and expanded evidence.
- Output shapes are intentionally stable for prompt and workflow compatibility.

## License

MIT. See `LICENSE`.
