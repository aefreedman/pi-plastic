# PlasticSCM Workflow for Code Review

This file contains Plastic-specific operations for code review setup and context collection.

**Load the `using-plastic` skill** for Plastic operations.

Agent workflow preference: use `plastic_*` tools first (`plastic_status`, `plastic_switchBranch`, `plastic_diff`, etc.); keep `cm ...` snippets as manual fallback.

Note: examples target current Plastic CLI syntax; legacy variants may differ.

---

## Step 1: Determine Review Target

<task_list>

- [ ] Determine review type: Code review ID (123), branch name, changeset ID (cs:456), or empty (current branch)
- [ ] Check current branch: `cm status | head -1 | cut -d@ -f1 | xargs`
- [ ] If code review ID provided: Get review target/title with `cm find review "where id=123" --format="{target} {title}"`
- [ ] Create or reuse review workspace for isolation
- [ ] Switch to review branch in review workspace
- [ ] Get list of changed files: `cm diff br:branch-name --format="{status} {path}"`

Ensure that the code is ready for analysis in review workspace. ONLY then proceed to the next step.

</task_list>

---

## Step 2: Review Workspace Strategy

```bash
main_workspace=$(basename "$PWD")

# Check if review-1 exists (default: reuse)
if [ -d "../${main_workspace}-review-1" ]; then
  echo "📁 Reusing review workspace: ${main_workspace}-review-1"
  cd "../${main_workspace}-review-1"
  
  # Switch to review branch (shelve if needed)
  if ! cm switch "$review_branch" 2>/dev/null; then
    echo "⚠️ Workspace has pending changes. Shelving..."
    review_shelf=$(cm shelveset create -c="Auto-shelve before review switch" --summaryformat)
    cm switch "$review_branch"
  fi
else
  # Create new review-1
  echo "📁 Creating review workspace: ${main_workspace}-review-1"
  repo_spec=$(cm status --wkconfig | grep "^Repository:" | cut -d: -f2- | xargs)
  cm workspace create "${main_workspace}-review-1" "../${main_workspace}-review-1" "$repo_spec"
  cd "../${main_workspace}-review-1"
  cm switch "$review_branch"
fi

echo "✅ Review workspace ready"
echo "   Main workspace: ../$main_workspace"
echo "   Review workspace: ../${main_workspace}-review-1"
```

---

## Step 3: Collect Review Context

Before launching review agents, gather sufficient scoped context about the changes. Do not perform broad repository research here; agents should focus on changed files and directly related local patterns.

```bash
# Get branch/changeset metadata and changed files
if [ -n "$CODE_REVIEW_ID" ]; then
  # Using code review ID (123)
  REVIEW_TARGET=$(cm find review "where id=$CODE_REVIEW_ID" --format="{target}" --nototal 2>/dev/null)
  REVIEW_TITLE=$(cm find review "where id=$CODE_REVIEW_ID" --format="{title}" --nototal 2>/dev/null || echo "Code Review $CODE_REVIEW_ID")
  REVIEW_BODY=""
  CHANGED_FILES=$(cm diff "$REVIEW_TARGET" --format="{path}{newline}" | sed 's/^/- /')
elif [ -n "$CHANGESET_ID" ]; then
  # Using changeset ID (cs:456)
  REVIEW_TITLE=$(cm find changeset "where changesetid=$CHANGESET_ID" --format="{comment}" --nototal)
  REVIEW_BODY=$(cm diff "cs:$CHANGESET_ID" --format="{status} {path}{newline}")
  CHANGED_FILES=$(cm diff "cs:$CHANGESET_ID" --format="{path}{newline}" | sed 's/^/- /')
elif [ -n "$BRANCH_NAME" ]; then
  # Using branch name
  REVIEW_TITLE="Branch: $BRANCH_NAME"
  REVIEW_BODY=$(cm find changeset "where branch='$BRANCH_NAME'" --format="{comment}" --nototal | head -5)
  CHANGED_FILES=$(cm diff "br:$BRANCH_NAME" --format="{path}{newline}" | sed 's/^/- /')
else
  # Using current branch
  CURRENT_BRANCH=$(cm status | head -1 | cut -d@ -f1 | xargs)
  REVIEW_TITLE="Branch: $CURRENT_BRANCH"
  REVIEW_BODY=$(cm find changeset "where branch='$CURRENT_BRANCH'" --format="{comment}" --nototal | head -5)
  CHANGED_FILES=$(cm diff "br:$CURRENT_BRANCH" --format="{path}{newline}" | sed 's/^/- /')
fi

# Extract focus areas from title and body
FOCUS_AREAS=$(echo "$REVIEW_TITLE $REVIEW_BODY" | grep -oE '\b(fix|bug|feature|refactor|performance|security|optimization|migration|upgrade|new)\b' | sort -u | tr '\n' ', ' | sed 's/,$//')

# Count files for context
FILE_COUNT=$(echo "$CHANGED_FILES" | grep -c '^- ')

echo "📊 Review Context:"
echo "   Title: $REVIEW_TITLE"
echo "   Files Changed: $FILE_COUNT"
echo "   Focus: $FOCUS_AREAS"
```

**Context Variables Ready for Agents:**

After running the appropriate section above, you will have:
- `$CHANGED_FILES` - Newline-separated list of file paths (with `- ` prefix)
- `$REVIEW_TITLE` - Title/description of changes
- `$FOCUS_AREAS` - Comma-separated keywords extracted from title/body
- `$FILE_COUNT` - Number of changed files

These variables should be passed to agents in their prompts.

---

## Commands Reference

### PlasticSCM Commands

```bash
# Check current branch
cm status | head -1 | cut -d@ -f1 | xargs

# View code review details
cm find review "where id=123" --format="{target}"
cm find review "where id=123" --format="{title}"

# Get changed files
cm diff br:branch-name --format="{path}{newline}"
cm diff cs:456 --format="{path}{newline}"

# Find changeset details
cm find changeset "where changesetid=456" --format="{comment}" --nototal
cm find changeset "where branch='branch-name'" --format="{comment}" --nototal

# Workspace management
cm status --wkconfig
cm workspace create "workspace-name" "../workspace-name" "repo-spec"
cm switch branch-name
cm shelveset create -c="message"
```

### Review Workspace Patterns

**Naming convention:**
- Main workspace: `project-name`
- Review workspace: `project-name-review-1`

**Location:**
- Review workspace is sibling to main workspace: `../project-name-review-1`

**Reuse strategy:**
- Check if review workspace exists
- If exists: Switch to target branch (shelve if needed)
- If not exists: Create new review workspace
