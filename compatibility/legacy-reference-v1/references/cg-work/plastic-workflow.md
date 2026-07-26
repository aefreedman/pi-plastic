# PlasticSCM Workflow for Work Execution

This file contains Plastic-specific operations for setting up, executing, and shipping work.

## Workflow Scope (Mandatory)

- Use this file only when detected VCS is Plastic.
- If detected VCS is Git, stop this workflow and load ./git-workflow.md.
- Do not execute Git commit/push/PR instructions while following this Plastic workflow.
- Once this workflow is active, Plastic branch/checkin policy in this file is authoritative.
- Ignore Git-only commit safety directives and conflicting cross-VCS write policy while this workflow is active.

## Active Workflow Lock (Mandatory)

- Set `ACTIVE_VCS_WORKFLOW=plastic` for the current run.
- Do not load or apply instructions from `git-workflow.md` after this lock is set.
- If instructions conflict, follow this file for branch-type checkin behavior.

**Load the `using-plastic` skill** for Plastic operations.

Agent workflow preference: use `plastic_*` tools first (`plastic_status`, `plastic_branchCreate`, `plastic_switchBranch`, `plastic_checkin`, `plastic_mergeToBranch`, etc.); keep `cm ...` snippets as manual fallback.

Note: examples target current Plastic CLI syntax; legacy variants may differ.


## Usage

**Execution order:**
1. Setup: Detect conventions, create feature branch
2. Execute: Make incremental checkins as logical units complete
3. Final: Create final checkin with attribution
4. Ship: Create code review (CLI or GUI) and merge finished branch to the target branch when requested

**Key differences from Git:**
- No worktrees (use shelving instead)
- Changes auto-sync on checkin (no push needed)
- Code review creation may require GUI

---

## Closeout Merge Helper

When the user asks to merge a finished feature branch into `/dev` or another target branch, prefer `plastic_mergeToBranch` when available. It performs the safe target-switch, optional update, non-interactive merge, merge-state check, and merge checkin flow in one guarded operation. Use manual `plastic_switchBranch` / `plastic_update` / `plastic_merge` / `plastic_status` / `plastic_checkin` only if the helper is unavailable or the workflow needs custom intervention.

---

## Step 1: Setup Plastic Environment

### Detect Branch Naming Convention

```bash
# Get current branch
current_branch=$(cm status | head -1 | cut -d@ -f1 | xargs)
echo "Current branch: $current_branch"

if [[ "$current_branch" =~ ^/[^/]+$ ]]; then
  branch_type="top-level"
else
  branch_type="sub-branch"
fi

echo "Branch type: $branch_type"

# Analyze existing branches to learn convention
echo "Analyzing repository branch structure..."
cm find branches --format="{name}" | head -20

# Determine parent branch pattern
if [[ "$current_branch" =~ ^/main/.* ]]; then
  parent="/main"
  echo "Detected convention: child branches of /main"
elif [[ "$current_branch" =~ ^/dev/.* ]]; then
  parent="/dev"
  echo "Detected convention: child branches of /dev"
elif cm find branches | grep -q "^/main/"; then
  parent="/main"
  echo "Detected convention: repository uses /main hierarchy"
else
  parent="$current_branch"
  echo "Detected convention: top-level branches; creating child sub-branches from current branch"
fi
```

---

### Create Feature Branch

```bash
# Update workspace to latest
cm update

# Create branch following detected convention
if [ -n "$parent" ]; then
  suggested_name="${parent}/feature-name"
else
  suggested_name="/task/feature-name"
fi

echo "💡 Suggested branch: $suggested_name"
echo "   (following repository convention)"

# Create and switch
cm branch create $suggested_name -c="Feature description"
cm switch $suggested_name

echo "✅ Working on branch: $suggested_name"
```

**Branch naming guidelines:**
- Follow detected repository conventions
- Use lowercase with hyphens: `/main/player-dash-mechanic`
- No spaces or special characters
- Examples: `/main/dash-mechanic`, `/main/fix-collision`, `/dev/new-feature`

---

### Parallel Work (No Worktrees in Plastic)

Plastic doesn't have Git worktrees. Use shelving instead for tracked pending changes. Before shelving, inspect `cm status --all`; private files are not included in shelves unless they are added first. If the only pending work is a new private file that should move with the branch, add it intentionally or switch branches with the explicit pending-change strategy supported by the `plastic_switchBranch` tool.

```bash
# Save current tracked work before switching branches
cm status --all
feature_x_shelf=$(cm shelveset create -c="Working on feature X" --summaryformat)

# Switch to another branch
cm switch /main/other-feature

# Work on other feature...

# Return to original branch
cm switch /main/feature-x

# Restore work
cm shelveset apply "$feature_x_shelf"
```

---

## Step 2: Incremental Checkins During Execution

After completing each task, evaluate whether to create an incremental checkin.

### Checkin Permission by Branch Type

- Top-level branches (`^/[^/]+$`): create checkins only when the user explicitly instructs.
- Sub-branches (for example, `/main/feat-*`, `/dev/task-*`, `/main/bugfix-*`): create atomic checkins by default.
- On sub-branches created by the agent in the current run, prefer one logical change per checkin and avoid mixing unrelated changes.

### Checkin Decision Table

| Checkin when... | Don't checkin when... |
|-----------------|----------------------|
| Logical unit complete (model, service, component) | Small part of a larger unit |
| Tests pass + meaningful progress | Tests failing |
| About to switch contexts (gameplay → UI/tools) | Purely scaffolding with no behavior |
| About to attempt risky/uncertain changes | Would need a "WIP" message |

**Heuristic:** "Can I write a checkin message that describes a complete, valuable change? If yes, checkin. If the message would be 'WIP' or 'partial X', wait."

### Incremental Checkin Workflow

```bash
# 1. Verify tests pass (Unity Test Framework or project's test command)

# 2. Verify pending changes, including deletions
cm status --all

# 2. Add specific files related to this logical unit
cm add Assets/Scripts/PlayerController.cs Assets/Scripts/DashAbility.cs

# 3. If there are deleted items, confirm they are listed before checkin
#    (Deleted entries should appear in cm status --all output)

# 4. Checkin with conventional message (no attribution for incremental checkins)
cm checkin -c="feat(player): add dash input handling"
```

For tool-first workflows, prefer `plastic_status()` before each checkin to verify deleted items are included in pending changes.

**Load conventional commit format from:** ../_shared/conventional-commits.md

**Examples:**
```bash
cm checkin -c="feat(player): add dash input handling"
cm checkin -c="feat(player): implement dash cooldown system"
cm checkin -c="test(player): add dash ability tests"
```

**Note:** Incremental checkins use clean conventional messages **without** attribution. The final checkin (Phase 4) includes full attribution.

---

### Handling Pending Changes

```bash
# Check what's pending
cm status --all

# If you need to switch branches but have pending changes
switch_shelf=$(cm shelveset create -c="Auto-save before branch switch" --summaryformat)
cm switch /main/other-branch

# Later, restore
cm switch /main/original-branch
cm shelveset apply "$switch_shelf"
```

---

## Step 3: Final Checkin

After all work is complete and quality checks pass:

- If still on a top-level branch and no explicit checkin instruction was given, stop before checkin and report a ready-to-checkin summary.

```bash
# Check what's pending
cm status --all

# Review metadata safely (do not use cm diff --summary; it is invalid)
cm diff br:/main/feature-name --format="{status} {path}{newline}"

# For detailed review, use file-level diff with explicit format/revision tools

# Add all changes
cm add .

# Verify deleted items are still present in pending changes
cm status --all

# Checkin with attribution
cm checkin -c="feat(player): implement dash mechanic

Adds dash ability with cooldown, stamina cost, and input handling.
Includes animation integration and particle effects.

Closes #42

Co-Authored-By: <AI Assistant Name>"
```

**Load commit format from:** ../_shared/conventional-commits.md

**Note:** Changes in Plastic are automatically synced to server on checkin (no separate push needed).

Deletion safety rule: when checkin scope is limited to specific paths, make sure deleted paths are also included in the checkin command; otherwise run full-scope checkin after validating with `cm status --all`.

---

## Step 4: Create Code Review

Get branch/changeset info, create code review, and assign reviewer:

```bash
# Get current branch and changeset
branch=$(cm status | head -1 | cut -d@ -f1 | xargs)
changeset=$(cm status --changeset)

echo "Branch: $branch"
echo "Changeset: $changeset"

# Try to create code review via CLI
review_id=$(cm codereview "br:$branch" "Feature: [Description]" --format="{id}" 2>/dev/null)
if [ -n "$review_id" ]; then
  # Assign reviewer right away (required)
  cm codereview -e "$review_id" --reviewer="reviewer-name"
  
  echo "✅ Code review created successfully"
  echo "✅ Reviewer assigned: reviewer-name"
else
  echo "📝 Code review creation not available via CLI"
  echo "   Branch: $branch"
  echo "   Changeset: $changeset"
  echo ""
  echo "   Document changeset in workflow tracker:"
  echo "   - Add to docs/plans/ or docs/solutions/"
  echo "   - Link changeset ID in issue tracker"
  echo ""
  echo "   Or create manually via Plastic GUI:"
  echo "   Team → Create Code Review → Select branch: $branch"
fi
```

Tool-first preference in this step: use `plastic_status` for branch/status context and `plastic_diff`/`plastic_diffFile` for diff context, then run `cm codereview ...` as fallback for review creation/assignment.

**Load code review template from:** `assets/code-review-template.md`

**Note:** Plastic changes are already on server (synced during checkin). Code review creation is optional - changeset is tracked either way.

---

## Commands Reference

### Branch Operations
```bash
# Check current branch
cm status | head -1 | cut -d@ -f1 | xargs

# List branches
cm find branches --format="{name}"

# Create branch
cm branch create /main/feature-name -c="Description"

# Switch branch
cm switch /main/feature-name

# Delete branch
cm branch delete /main/feature-name
```

### Checkin Operations
```bash
# Add files
cm add Assets/Scripts/PlayerController.cs

# Add all changes
cm add .

# Check status
cm status --all

# Review pending changes safely (no --summary)
cm diff br:/main/feature-name --format="{status} {path}{newline}"

# Checkin with message
cm checkin -c="message"

# Checkin specific files
cm checkin -c="message" Assets/Scripts/PlayerController.cs

# Checkin specific files including deletions
cm checkin -c="message" Assets/Scripts/NewFile.cs Assets/Scripts/DeletedFile.cs
```

### Shelving Operations
```bash
# Create shelveset
shelf_spec=$(cm shelveset create -c="Description" --summaryformat)

# List shelves
cm find shelve "where owner='me'" --format="{shelveid} {date} {comment}"

# Apply shelveset (restore)
cm shelveset apply "$shelf_spec"

# Delete shelve
cm shelveset delete "$shelf_spec"
```

### Code Review Operations
```bash
# Create code review (current syntax)
cm codereview "br:/main/feature" "Title"

# Create and capture review id
cm codereview "br:/main/feature" "Title" --format="{id}"

# Assign reviewer after creation
cm codereview -e 123 --reviewer="reviewer-name"

# Discover/list code reviews
cm find review "where status='Under review'" --format="{id} {status} {title}"

# Edit code review
cm codereview -e 123 --status="Reviewed"
```

---

## Error Handling

### Branch Already Exists

```bash
if cm find branches | grep -q "^$branch_name\$"; then
  echo "⚠️ Branch '$branch_name' already exists"
  echo "Options:"
  echo "  1. Switch to existing branch: cm switch $branch_name"
  echo "  2. Delete and recreate: cm branch delete $branch_name && cm branch create $branch_name"
  echo "  3. Use different name"
fi
```

### Pending Changes on Switch

```bash
if ! cm switch $target_branch 2>/dev/null; then
  echo "⚠️ Cannot switch - you have pending changes"
  echo ""
  echo "Options:"
  echo "  1. Checkin changes: cm add . && cm checkin -c='message'"
  echo "  2. Shelve changes: cm shelveset create -c='Auto-save' --summaryformat"
  echo "  3. Undo changes: cm undo (CAUTION)"
  echo ""
  echo "Recommended: Use shelveset to preserve your work"
  auto_shelf=$(cm shelveset create -c="Auto-save before switch" --summaryformat)
  cm switch $target_branch
fi
```

Agent preference: use the Plastic switch tool first; keep shell examples as manual fallback.

### Checkin Failed

```bash
if ! cm checkin -c="message"; then
  echo "⚠️ Checkin failed"
  echo ""
  echo "Possible reasons:"
  echo "  - No changes to checkin: cm status --all"
  echo "  - Files not added: cm add <files>"
  echo "  - Checkin validation rules: Check Plastic server rules"
  echo ""
  echo "View pending changes: cm status --all"
fi
```

### Code Review Creation Failed

```bash
if ! cm codereview "br:$branch" "Title" ...; then
  echo "⚠️ Code review creation failed"
  echo ""
  echo "Code review may not be available via CLI for your Plastic setup"
  echo ""
  echo "Alternative workflows:"
  echo "  1. Use Plastic GUI: Team → Create Code Review"
  echo "  2. Document changeset in plan: docs/plans/"
  echo "  3. Link changeset in issue tracker"
  echo ""
  echo "Your changes are already on the server (changeset: $changeset)"
fi
```

---

## Unity Cloud Integration

If using Unity Version Control (Plastic Cloud):

**Auto-sync:** Changes are automatically synced to cloud on checkin. No separate push needed.

**Collaboration:**
- Team members see your changes immediately after checkin
- Code reviews are created in Unity Cloud dashboard
- Branch protection rules enforced server-side

**Status check:**
```bash
# Verify sync status
cm status --wkconfig

# Check repository info
cm showconfig
```

---
