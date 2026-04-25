# Pi Plastic

Pi extension package that ports the proven OpenCode Plastic SCM / Unity Version Control workflows into Pi with minimal behavioral drift.

Current tool set:
- `plastic_status`
- `plastic_update`
- `plastic_add`
- `plastic_checkin`
- `plastic_undo`
- `plastic_diff`
- `plastic_diffRevisions`
- `plastic_diffFile`
- `plastic_branchCreate`
- `plastic_switchBranch`
- `plastic_merge`
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
- `plastic_workspaceCreate`
- `plastic_workspaceList`

Notes:
- The package uses a copy-first port of the OpenCode implementation so the established Plastic workflows, preflights, safety guards, and output contracts are preserved in Pi.
- `plastic_diff` remains a disabled alias by design; use `plastic_diffFile` or `plastic_diffRevisions` for text-only diffs.
- The core implementation lives in `src/opencode-plastic.ts`; `index.ts` is the thin Pi registration layer.
- The package also ships Plastic-specific bash safety rails for blocking `cm diff` and unsafe `cm merge --merge` usage.
- Merge tooling now surfaces Plastic `FILE_CONFLICT` records, reports merge-state metadata from `cm status`, and provides `plastic_finalizeMerge` for the reviewed/manual-resolution case where Plastic still needs merge metadata finalized before checkin.
- The package now also ships the `using-plastic` skill under `skills/using-plastic/` so Plastic workflow guidance travels with the tools.

Testing:
- `npm test` runs the ported Plastic validation suite, the path-resolution regression tests, and the bash `cm diff` guard validation.
- Real smoke validation should be executed against a local Plastic workspace using `status`, `currentBranch`, and `checkin(preflight=true)` before release.

## License

MIT. See `LICENSE`.
