# Pi Plastic

Plastic SCM / Unity Version Control tools and workflow guidance for [Pi](https://pi.dev).

Use it to inspect a workspace, review changes without opening a GUI, and perform explicitly scoped branch, checkin, merge, shelveset, and code-review operations.

## What you get

- **27 core tools** with producer-owned structured results, plus an on-demand capability loader.
- **Text-only diffs and generated review patches**, with explicit scope and bounded output.
- **Agent-driven server conflict resolution:** inspect conflicts, validate merged files, and submit per-file JSON decisions without a merge UI.
- **Truthful mutation receipts:** command completion, observed identities, partial effects, and uncertainty stay separate.
- **Pi integration:** compact tool displays, a Plastic branch footer, Bash guards, and optional Plastic ignore/cloak filtering for file discovery.
- **The `using-plastic` skill**, with task-specific references loaded only when needed.

## Install

Install the npm release at user scope:

```bash
pi install npm:@aefree/pi-plastic
```

To test the current Git version instead:

```bash
pi install https://github.com/aefreedman/pi-plastic
```

Git main can contain unreleased changes; npm installs the published release. See [setup](docs/2026-10-06-setup.md) for pinned releases, local checkouts, configuration, and updating an existing installation.

### Requirements

- Node.js **22.19.0 or newer** and the latest stable Pi.
- An authenticated Plastic CLI (`cm`) on `PATH`, or an explicit executable override.
- A configured Plastic workspace for workspace-scoped tools.
- A compatible non-GUI `diff` for text comparisons. Patch generation has a **separate backend policy**, particularly on Windows and macOS; see [diff and patch setup](docs/2026-10-06-setup.md#diff-and-patch-backends).

Restart existing Pi processes after installation or source changes. User-scope installation makes the guards available across workspaces; project-local settings alone do not protect child processes launched elsewhere.

## Start with inspection

Open Pi in the intended Plastic workspace and ask it to inspect pending changes. The default balanced mode starts with `plastic_status`, `plastic_currentBranch`, and `plastic_tool_search` active.

These are tool calls inside Pi, not shell commands:

```text
plastic_status(source="xml", maxItems=20)
plastic_tool_search(query="text diff")
plastic_diff(mode="workspace", paths=["Assets/Example.txt"])
```

XML status is opt-in and has Windows CM11 source validation. Pick the status source appropriate to your client using the [status guide](docs/2026-10-06-status.md). Load other capabilities as needed; don't enable all tools or run every preflight as routine ceremony.

## Find the right documentation

| Need | Start here |
|---|---|
| Install, update, or configure executables | [Setup](docs/2026-10-06-setup.md) |
| Find a tool or understand on-demand loading | [Tool catalog and loading](docs/2026-10-06-tools-and-loading.md) |
| Interpret success, partial results, and failures | [Safety and receipts](docs/2026-10-06-safety-and-receipts.md) |
| Inspect status, branches, workspaces, or object IDs | [Status](docs/2026-10-06-status.md) · [Discovery](docs/2026-10-06-discovery.md) |
| Add, undo, switch, check in, or manage branches | [Workspace operations](docs/2026-10-06-workspace-operations.md) |
| Merge or close out a branch | [Merging](docs/2026-10-06-merging.md) |
| Compare changes or generate a patch | [Diffs and patches](docs/2026-10-06-diffs-and-patches.md) |
| Save/apply a shelf or create/update a review | [Shelvesets and reviews](docs/2026-10-06-shelvesets-and-reviews.md) |
| Understand the footer, displays, or file-discovery integration | [Integrations](docs/2026-10-06-integrations.md) |
| Work on the package or consume its structured API | [Development](docs/2026-10-06-development.md) |

The [documentation index](docs/README.md) routes by task and by tool. Agents should read the relevant page or section, not the whole manual. For operational workflows, start with [the skill](skills/using-plastic/SKILL.md).

## Important safety behavior

- Prefer `plastic_*` tools. Raw `cm diff` / `cm differences` and unsafe interactive merge commands are blocked by the loaded Bash guards.
- Mutations do **not** require package-owned approval tokens or UI confirmation. The agent must still have user authorization and inspect the intended scope.
- A completed command is not automatically a verified effect. Read the receipt before chaining calls; after an uncertain mutation, inspect state rather than blindly retrying.
- The tool reports supported facts and unknowns; the agent chooses further investigation or resolution within the user's authorization. No universal rollback, conflict-resolution, or cross-platform guarantee is implied.

## Contributing and license

For a checkout, run `npm ci --ignore-scripts --no-audit --no-fund` and `npm test`. See [development](docs/2026-10-06-development.md), [contributing](https://github.com/aefreedman/pi-plastic/blob/main/CONTRIBUTING.md), and [security reporting](https://github.com/aefreedman/pi-plastic/blob/main/SECURITY.md).

MIT. See [LICENSE](LICENSE).
