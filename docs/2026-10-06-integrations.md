# Pi integrations

[Documentation index](README.md) · [Setup](2026-10-06-setup.md) · [Receipt semantics](2026-10-06-safety-and-receipts.md)

These integrations improve presentation and discovery. They don't change the underlying mutation result into a stronger guarantee.

## Tool displays

Compact action headers appear inside Pi's standard tool boxes. They show workspace and the relevant branch/file/revision pair/query; command previews are labelled.

Collapsed results expose structured counts, comparison availability, patch artifacts, merge outcomes, blocked checkins, omitted results and unresolved effects. Plain CLI output stays neutral rather than implying verified mutation.

Expand with the configured Pi tool-expansion shortcut for request/workspace context, colored diff hunks and returned evidence. Rendering preserves JSON identifiers and numeric text, masks common credential assignments and removes terminal control sequences. It does not alter execution/model-facing output or scan arbitrary source for secrets.

In a checkout, `npm run preview:tools` provides offline examples. The preview uses plain colors and a test binding; live Pi supplies the theme, box and configured shortcut.

## Plastic branch footer

Inside a Plastic workspace, Pi adds a themed `Plastic <branch>` footer status. It finds the nearest `.plastic/plastic.workspace` and reads smartbranch/br selector forms as the credential-free source. A bounded `cm status` is used only when the selector lacks a valid branch.

Selector changes and successful same-workspace Plastic tools refresh the status; sibling workspaces are ignored.

| State | Display |
|---|---|
| Observed branch | Plastic branch status |
| Plastic marker but no selector/CM branch | Plastic branch unavailable |
| No Plastic workspace | No Plastic status |

The extension owns only the plastic-branch status key. It does not replace Pi's footer or suppress Git status; both can appear in nested workspaces.

## File-discovery filter

When independently loaded `@aefree/pi-file-discovery` is present, session startup registers the advisory plastic.ignore-files filter through the package-qualified capability-registry rendezvous key. Separate package module roots are supported; Plastic does not import a sibling package instance from its own root.

For each requested root, the filter reads ignore.conf/cloaked.conf only from its nearest Plastic workspace and supplies readable files as ripgrep ignores, without replacing native ripgrep/Git-ignore behavior.

- Effective records declare filterDecision applied, decision code plastic_ignore_files_applied, and the workspace filterBoundary.
- A root is emitted only with at least one readable ignore/cloak file.
- No-op roots are omitted from mixed requests; no effective records means not_applicable.
- Missing/malformed/unavailable data degrades to generic discovery. The discovery package owns execution hygiene/disclosure.
- No workflow guidance or Plastic readiness query is registered by this filter.

Without file discovery, Plastic tools and the skill still load; no filter registry is created. This advisory filter is not an access-control boundary or proof that excluded files are inaccessible.

## Bash guards

The declared diff and merge guard extensions block GUI diff/differences and unsafe interactive merge commands. They apply only in Pi processes that actually load them, not arbitrary shells or children that resolve different project settings.

Use user-scope installation when children in arbitrary workspaces must inherit them. Restart processes after installation/source changes. Mutating Plastic tools still have operation-specific guards and [authorization/receipt requirements](2026-10-06-safety-and-receipts.md#mutation-authorization-and-preflight); presentation/guards are not a universal sandbox.
