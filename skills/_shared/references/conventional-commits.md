# Conventional Commits

This reference file documents the conventional commit format used across the project.

---

## Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

---

## Types

| Type | Description | Example |
|------|-------------|---------|
| **feat** | New feature | `feat(auth): add OAuth login` |
| **fix** | Bug fix | `fix(cart): calculate tax correctly` |
| **refactor** | Code restructuring (no behavior change) | `refactor(api): extract service layer` |
| **perf** | Performance improvement | `perf(query): optimize user lookup` |
| **test** | Adding or updating tests | `test(auth): add login edge cases` |
| **docs** | Documentation changes | `docs(readme): update installation steps` |
| **style** | Code style changes (formatting, etc.) | `style(lint): fix indentation` |
| **chore** | Build process or auxiliary tool changes | `chore(deps): update to Rails 7.1` |
| **ci** | CI/CD configuration changes | `ci(github): add test workflow` |

---

## Scope

The scope is optional but recommended. It specifies which part of the codebase was affected:

**Examples:**
- `feat(player): add dash mechanic`
- `fix(inventory): prevent negative quantities`
- `refactor(ui): simplify menu navigation`
- `perf(rendering): batch sprite draws`

**Guidelines:**
- Use lowercase
- Be specific but concise
- Match your module/component names
- Omit if change is global

---

## Subject

The subject contains a succinct description of the change:

- **Use imperative mood:** "add" not "added" or "adds"
- **Don't capitalize first letter:** "add feature" not "Add feature"
- **No period at the end:** "fix bug" not "fix bug."
- **Limit to 50 characters**

**Good examples:**
- `feat(auth): add password reset flow`
- `fix(api): handle null responses`
- `refactor(utils): extract string helpers`

**Bad examples:**
- `feat(auth): Added password reset flow` (not imperative)
- `feat(auth): Add Password Reset Flow` (capitalized)
- `feat(auth): add password reset flow.` (period at end)

---

## Body (Optional)

Use the body to explain **what** and **why**, not **how**:

```
feat(player): add dash mechanic

Adds a dash ability to the player character for enhanced mobility.
Dash has 1-second cooldown and consumes 10 stamina.

Closes #42
```

**Guidelines:**
- Wrap at 72 characters
- Separate from subject with blank line
- Focus on context and reasoning
- Link to issues if applicable

---

## Footer (Optional)

Use footer for metadata:

**Breaking changes:**
```
feat(api)!: change authentication endpoint

BREAKING CHANGE: /api/login now requires email instead of username
```

**Issue references:**
```
fix(cart): calculate tax correctly

Fixes #123
Closes #124
Related to #125
```

**Attribution:**
```
feat(dashboard): add analytics widget

Co-Authored-By: <AI Assistant Name (e.g., Codex, Claude, OpenCode)>
```

---

## Attribution Footer

Add a simple attribution line in the footer when needed:

```
feat(feature): implement new capability

[Body explaining the change]

Co-Authored-By: <AI Assistant Name (e.g., Codex, Claude, OpenCode)>
```

---

## Examples

### Simple Feature
```
feat(player): add jump mechanic
```

### Bug Fix with Context
```
fix(inventory): prevent item duplication

Items were duplicating when rapidly clicking the pickup button.
Added debounce logic to prevent double-processing.

Fixes #156
```

### Refactor with Explanation
```
refactor(rendering): extract camera controller

Moved camera logic from PlayerController to dedicated CameraController
for better separation of concerns and reusability.
```

### Performance Improvement
```
perf(physics): optimize collision detection

Changed from O(n²) all-pairs check to spatial hashing.
Reduces frame time by ~15ms with 100+ objects.
```

### Attribution Example
```
feat(multiplayer): add lobby system

Implements matchmaking lobby with room creation, joining, and ready-up.
Uses WebSocket for real-time updates.

Closes #89

Co-Authored-By: <AI Assistant Name (e.g., Codex, Claude, OpenCode)>
```

---

## Usage in Skills

**Reference this file when:**
- Creating commits (Git or Plastic)
- Generating commit messages
- Validating commit format
- Writing PR/code review descriptions

**Load this file:**
```markdown
Load conventional commit format from ../../_shared/references/conventional-commits.md
```

Then format all commits according to this standard.
