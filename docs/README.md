# Pi Plastic documentation

[Package overview](../README.md) · [Workflow skill](../skills/using-plastic/SKILL.md)

This is the public manual shipped with the package. Start with a task, then read only the relevant tool family. Topic filenames keep their creation-date prefix; the titles below are the navigation surface.

## Choose a task

| I want to… | Read |
|---|---|
| Install or update the package; configure CM/diff | [Setup](2026-10-06-setup.md) |
| Enable a capability without loading every tool | [Tools and loading](2026-10-06-tools-and-loading.md#loading-modes) |
| Understand what a result proves, or respond to uncertainty | [Safety and receipts](2026-10-06-safety-and-receipts.md) |
| Inspect pending paths and merge hints | [Status](2026-10-06-status.md) |
| Find branches, workspaces, shelvesets, or review IDs | [Discovery](2026-10-06-discovery.md) |
| Add/undo/check in files, switch branches, create/delete a branch | [Workspace operations](2026-10-06-workspace-operations.md) |
| Choose workspace merge versus server merge versus closeout | [Merging](2026-10-06-merging.md#choose-a-route) |
| Review local/historical changes or generate a patch | [Diffs and patches](2026-10-06-diffs-and-patches.md) |
| Save/apply/delete a shelf or manage a review | [Shelvesets and reviews](2026-10-06-shelvesets-and-reviews.md) |
| Understand display, footer, or ignore/cloak behavior | [Integrations](2026-10-06-integrations.md) |
| Run tests, understand schema/transport behavior, or change the package | [Development](2026-10-06-development.md) |

## Look up a tool

Argument descriptions in the loaded tool schema are the source for exact call parameters. The pages below explain semantics, defaults, bounds, and follow-up decisions; they are not alternate parsers or automatic recovery instructions.

| Tool | Reference |
|---|---|
| `plastic_tool_search` | [Tools and loading](2026-10-06-tools-and-loading.md#capability-loader) |
| `plastic_status` | [Status sources](2026-10-06-status.md#choose-a-source) |
| `plastic_currentBranch` | [Current branch](2026-10-06-discovery.md#currentbranch) |
| `plastic_branchExists` | [Branch existence](2026-10-06-discovery.md#branchexists) |
| `plastic_branchList` | [Branch list](2026-10-06-discovery.md#branchlist) |
| `plastic_workspaceList` | [Workspace list](2026-10-06-discovery.md#workspacelist) |
| `plastic_shelvesetList` | [Shelveset IDs](2026-10-06-discovery.md#shelvesetlist) |
| `plastic_codeReviewFind` | [Review IDs](2026-10-06-discovery.md#codereviewfind) |
| `plastic_add` | [Add](2026-10-06-workspace-operations.md#add) |
| `plastic_update` | [Update](2026-10-06-workspace-operations.md#update) |
| `plastic_undo` | [Undo](2026-10-06-workspace-operations.md#undo) |
| `plastic_checkin` | [Checkin](2026-10-06-workspace-operations.md#checkin) |
| `plastic_branchCreate` | [Branch creation](2026-10-06-workspace-operations.md#branchcreate) |
| `plastic_branchDelete` | [Branch deletion](2026-10-06-workspace-operations.md#branchdelete) |
| `plastic_switchBranch` | [Switching](2026-10-06-workspace-operations.md#switchbranch) |
| `plastic_resolveDeleteChangeConflict` | [Delete/change removal](2026-10-06-workspace-operations.md#resolvedeletechangeconflict) |
| `plastic_merge` | [Workspace merge](2026-10-06-merging.md#merge-and-finalizemerge) |
| `plastic_finalizeMerge` | [Finalization](2026-10-06-merging.md#merge-and-finalizemerge) |
| `plastic_mergeBranches` | [Server merge](2026-10-06-merging.md#mergebranches) |
| `plastic_mergeToBranch` | [Closeout](2026-10-06-merging.md#mergetobranch) |
| `plastic_diff` | [Diff modes](2026-10-06-diffs-and-patches.md#diff-modes) |
| `plastic_patch` | [Patch generation](2026-10-06-diffs-and-patches.md#patch-generation) |
| `plastic_shelvesetCreate` | [Shelf creation](2026-10-06-shelvesets-and-reviews.md#shelvesetcreate) |
| `plastic_shelvesetApply` | [Shelf application](2026-10-06-shelvesets-and-reviews.md#shelvesetapply) |
| `plastic_shelvesetDelete` | [Object deletion](2026-10-06-shelvesets-and-reviews.md#object-deletion) |
| `plastic_codeReviewCreate` | [Review creation](2026-10-06-shelvesets-and-reviews.md#codereviewcreate) |
| `plastic_codeReviewUpdate` | [Review update](2026-10-06-shelvesets-and-reviews.md#codereviewupdate) |
| `plastic_codeReviewDelete` | [Object deletion](2026-10-06-shelvesets-and-reviews.md#object-deletion) |

## Reading results as an agent

1. Load the smallest sufficient capability through `plastic_tool_search` when it is inactive.
2. Read the tool schema and only the relevant reference section. Use [the workflow skill](../skills/using-plastic/SKILL.md) when the task calls for operational guidance.
3. Use structured output where available. Inspect `ok`, completeness, scope, effects, and any unattempted stages; don't recover facts by scraping presentation text.
4. Choose further read-only inspection or an authorized resolution when evidence is incomplete. A failed command may have effects; uncertainty is not permission to replay it.

The package does not automatically load this manual into every agent context. The same-package links are readable relative to the installed skill/package, without a separate reference-reader dependency.
