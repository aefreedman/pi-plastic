# Object-comment fixture provenance

`object-comments-native.json` selects exactly eight records from the native evidence lane's `native-selected-evidence-v1` bundle for CM 11.0.16.10512: branch/label `replace`, `clear`, `file`, and both `help-*-editcomment` captures. Selected stream base64, byte counts, SHA256 and sanitized argv are unchanged. The surrounding JSON was reformatted, not the protocol streams. Tests verify every selected byte count/hash and fatal UTF-8 decoding.

Upstream explicit literal substitutions: identity → `reviewer@example.invalid`; repository → `synthetic-repository`; server organization → `synthetic-org@unity`; evidence directory → `C:/synthetic-evidence`; workspace → `C:\synthetic-workspace`; failed-experiment MSYS path → `C:/synthetic-git/README.md`. The bundle retains the upstream transformation inventory even when a selected record did not require a substitution. No private original path/account/server values are included. Original-byte hashes are attestations, not recoverable original streams. No line-ending normalization, XML reserialization or invented command output.

`object-comments-input.txt` reproduces the public synthetic evidence input exactly: UTF-8 without BOM and with final LF. File edits natively completed with empty stdout/stderr; the component does not read the file or verify stored comments. Independent experimental readback is not a producer guarantee.

All additional cases in `plastic-object-comments-output.test.ts` are explicitly synthetic derivatives for validation, byte-bound and injected process lifecycle behavior, not claimed native captures. No test runs live SCM.
