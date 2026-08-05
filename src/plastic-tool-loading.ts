import { resolve } from "node:path";

export const PLASTIC_TOOL_LOADING_MODE_ENV = "PI_PLASTIC_TOOL_LOADING_MODE";
export const PLASTIC_TOOL_SEARCH_NAME = "plastic_tool_search";
export const BALANCED_ACTIVE_PLASTIC_TOOL_NAMES = ["plastic_status", "plastic_currentBranch"] as const;
export const MAX_PLASTIC_TOOL_SEARCH_RESULTS = 4;

export type PlasticToolLoadingMode = "balanced" | "loader-only" | "all-active";

export type PlasticSearchCatalogEntry = {
  name: string;
  aliases: readonly string[];
  tags: readonly string[];
  guidance: readonly string[];
};

/**
 * Package-owned executable capability vocabulary. `plastic_diff` deliberately
 * remains outside this catalog: it is registered for compatibility, but is a
 * disabled alias rather than a safe executable diff capability.
 */
export const PLASTIC_SEARCH_CATALOG: readonly PlasticSearchCatalogEntry[] = [
  { name: "plastic_status", aliases: ["status", "pending changes", "working changes", "what changed", "changed files", "list changes"], tags: ["workspace", "inspect", "changes"], guidance: ["Use machineReadable=true to list changed, added, moved, deleted, and private paths without invoking GUI-capable cm diff."] },
  { name: "plastic_update", aliases: ["update", "sync", "pull latest"], tags: ["workspace", "synchronize", "safe"], guidance: ["Review pending changes before updating a workspace."] },
  { name: "plastic_add", aliases: ["add files", "track files", "add item"], tags: ["workspace", "changes", "mutation"], guidance: ["Confirm the intended paths before adding them to source control."] },
  { name: "plastic_checkin", aliases: ["checkin", "check in", "commit changes"], tags: ["changes", "mutation", "changeset"], guidance: ["Inspect the selected paths and checkin message before creating a changeset."] },
  { name: "plastic_undo", aliases: ["undo changes", "revert changes", "discard changes"], tags: ["changes", "mutation", "destructive"], guidance: ["Confirm the exact paths before discarding pending changes."] },
  { name: "plastic_resolveDeleteChangeConflict", aliases: ["resolve delete conflict", "deleted conflict"], tags: ["merge", "conflict", "resolution"], guidance: ["Inspect the conflict and choose whether files should remain on disk before resolving it."] },
  { name: "plastic_patch", aliases: ["patch", "generate patch", "review patch"], tags: ["diff", "patch", "export"], guidance: ["Inspect generated patches before sharing because they can include source, paths, or secrets."] },
  { name: "plastic_diffFile", aliases: ["diff", "diff file", "file diff", "compare one file", "compare file"], tags: ["diff", "file", "workspace", "inspect"], guidance: ["Use only when change-boundary evidence is needed. Pass one exact workspace path, omit revision for its Plastic base, and keep maxChars small unless more output is intentional."] },
  { name: "plastic_workspaceDiff", aliases: ["workspace diff", "pending review", "review pending changes", "review workspace changes", "diff pending files"], tags: ["diff", "workspace", "review", "inspect"], guidance: ["Use only for an intentional multi-file content review, not routine validation. Select exact paths or pass allPending=true explicitly; use plastic_status when only changed paths are needed."] },
  { name: "plastic_diffRevisions", aliases: ["diff revisions", "compare revisions", "revision diff"], tags: ["diff", "revision", "inspect"], guidance: ["Use this only for two explicit file-qualified revision specifications."] },
  { name: "plastic_branchCreate", aliases: ["create branch", "new branch"], tags: ["branch", "mutation", "workflow"], guidance: ["Create normal work branches beneath an intended parent, which may differ from the loaded branch. Use allowRootBranch only for intentional top-level branches."] },
  { name: "plastic_switchBranch", aliases: ["switch branch", "checkout branch", "change branch"], tags: ["branch", "workspace", "mutation"], guidance: ["Check pending changes and choose how to handle them before switching branches."] },
  { name: "plastic_merge", aliases: ["merge branch", "merge changes"], tags: ["merge", "conflict", "workflow"], guidance: ["Inspect merge state and resolve conflicts before checkin."] },
  { name: "plastic_mergeToBranch", aliases: ["merge to branch", "close branch", "merge closeout"], tags: ["merge", "branch", "closeout"], guidance: ["Confirm source and target branches before the non-interactive merge closeout flow."] },
  { name: "plastic_finalizeMerge", aliases: ["finalize merge", "complete merge", "resolve merge"], tags: ["merge", "conflict", "finalize"], guidance: ["Use after reviewed manual conflict resolution when Plastic still needs merge metadata finalized."] },
  { name: "plastic_currentBranch", aliases: ["current branch", "which branch", "branch name"], tags: ["branch", "workspace", "inspect"], guidance: ["Inspect the current branch before branch, merge, or checkin operations."] },
  { name: "plastic_branchList", aliases: ["list branches", "find branch", "branches"], tags: ["branch", "inspect", "query"], guidance: ["Use the returned full branch paths when selecting a branch for another operation."] },
  { name: "plastic_branchExists", aliases: ["branch exists", "check branch", "verify branch"], tags: ["branch", "inspect", "query"], guidance: ["Verify the full branch path before creating, switching, merging, or deleting."] },
  { name: "plastic_branchDelete", aliases: ["delete branch", "remove branch"], tags: ["branch", "mutation", "destructive"], guidance: ["Confirm the full branch path and whether its changesets may be deleted before deleting it."] },
  { name: "plastic_shelvesetCreate", aliases: ["create shelveset", "shelve changes", "stash changes"], tags: ["shelveset", "changes", "mutation"], guidance: ["Inspect selected pending changes and shelveset comments before shelving."] },
  { name: "plastic_shelvesetApply", aliases: ["apply shelveset", "unshelve", "restore shelveset"], tags: ["shelveset", "changes", "mutation"], guidance: ["Check the target workspace and pending changes before applying a shelveset."] },
  { name: "plastic_shelvesetDelete", aliases: ["delete shelveset", "remove shelveset"], tags: ["shelveset", "mutation", "destructive"], guidance: ["Confirm the shelveset identifier before deleting it."] },
  { name: "plastic_shelvesetList", aliases: ["list shelvesets", "find shelveset", "shelvesets"], tags: ["shelveset", "inspect", "query"], guidance: ["Inspect shelveset ownership and comments before applying or deleting one."] },
  { name: "plastic_codeReviewCreate", aliases: ["create code review", "new review"], tags: ["review", "code review", "mutation"], guidance: ["Confirm review targets, title, and reviewers before creating a code review."] },
  { name: "plastic_codeReviewUpdate", aliases: ["update code review", "edit review"], tags: ["review", "code review", "mutation"], guidance: ["Confirm the review ID and requested fields before updating a code review."] },
  { name: "plastic_codeReviewDelete", aliases: ["delete code review", "remove review"], tags: ["review", "code review", "mutation", "destructive"], guidance: ["Confirm review IDs before deleting code reviews."] },
  { name: "plastic_codeReviewFind", aliases: ["find code review", "list reviews", "search reviews"], tags: ["review", "code review", "inspect", "query"], guidance: ["Use filters to identify the intended review before changing or deleting it."] },
  { name: "plastic_workspaceList", aliases: ["list workspaces", "find workspace", "workspaces"], tags: ["workspace", "inspect", "query"], guidance: ["Inspect workspace paths and repository identity before using a workspace in a mutation."] },
] as const;

export const PLASTIC_COMPATIBILITY_TOOL_NAMES = ["plastic_diff"] as const;
export const PLASTIC_SEARCHABLE_TOOL_NAMES = new Set(PLASTIC_SEARCH_CATALOG.map((entry) => entry.name));
export const PLASTIC_TOOL_NAMES = new Set([...PLASTIC_SEARCHABLE_TOOL_NAMES, ...PLASTIC_COMPATIBILITY_TOOL_NAMES]);

export type ToolSourceInfo = {
  path: string;
  source: string;
  scope: string;
  origin: string;
  baseDir?: string;
};

export type PlasticToolInfo = { name?: unknown; sourceInfo?: unknown };
export type PlasticToolOwnership = { ownedToolNames: Set<string>; usesSourceInfo: boolean };

export function getPlasticToolLoadingMode(value = process.env[PLASTIC_TOOL_LOADING_MODE_ENV]): PlasticToolLoadingMode {
  switch (value?.trim().toLowerCase()) {
    case "all-active": return "all-active";
    case "loader-only": return "loader-only";
    default: return "balanced";
  }
}

export function getInitiallyInactivePlasticTools(mode: PlasticToolLoadingMode): Set<string> {
  if (mode === "all-active") return new Set();
  if (mode === "loader-only") return new Set(PLASTIC_TOOL_NAMES);
  return new Set([...PLASTIC_TOOL_NAMES].filter((name) => !BALANCED_ACTIVE_PLASTIC_TOOL_NAMES.includes(name as typeof BALANCED_ACTIVE_PLASTIC_TOOL_NAMES[number])));
}

function asSourceInfo(value: unknown): ToolSourceInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ToolSourceInfo>;
  return typeof candidate.path === "string" && typeof candidate.source === "string" && typeof candidate.scope === "string" && typeof candidate.origin === "string"
    ? candidate as ToolSourceInfo
    : undefined;
}

function normalizeSourcePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function resolveSourcePath(sourceInfo: ToolSourceInfo): string {
  return normalizeSourcePath(resolve(sourceInfo.baseDir ?? process.cwd(), sourceInfo.path));
}

function hasSourcePath(tool: PlasticToolInfo, expectedSourcePath: string): boolean {
  const sourceInfo = asSourceInfo(tool.sourceInfo);
  return Boolean(sourceInfo && resolveSourcePath(sourceInfo) === normalizeSourcePath(resolve(expectedSourcePath)));
}

/**
 * Pi 0.82 exposes effective tool provenance. Compare effective definitions to
 * this module's own import path, so even a foreign first-registration-wins
 * collision on the public loader name cannot become an ownership anchor.
 * Without that proof, callers preserve the active set unchanged.
 */
export function getEffectivePlasticToolOwnership(allTools: readonly PlasticToolInfo[], expectedSourcePath: string): PlasticToolOwnership {
  const effectiveLoader = allTools.find((tool) => tool.name === PLASTIC_TOOL_SEARCH_NAME);
  if (!effectiveLoader || !hasSourcePath(effectiveLoader, expectedSourcePath)) {
    return { ownedToolNames: new Set(), usesSourceInfo: false };
  }

  return {
    ownedToolNames: new Set(allTools
      .filter((tool) => typeof tool.name === "string" && PLASTIC_TOOL_NAMES.has(tool.name))
      .filter((tool) => hasSourcePath(tool, expectedSourcePath))
      .map((tool) => tool.name as string)),
    usesSourceInfo: true,
  };
}

export type PlasticToolSearchInput = { query?: unknown; toolNames?: unknown; limit?: unknown };
export type PlasticToolSearchMatch = PlasticSearchCatalogEntry & { description?: string; score: number };

const SEARCH_STOP_WORDS = new Set(["a", "an", "available", "existing", "for", "my", "of", "the", "this", "to"]);
const SEARCH_DOMAIN_TERMS = new Set(["branch", "changeset", "diff", "merge", "patch", "review", "shelveset", "workspace"]);
const MUTATION_INTENT_TERMS = new Set(["add", "apply", "checkin", "create", "delete", "discard", "edit", "finalize", "merge", "remove", "resolve", "switch", "undo", "update"]);

function normalizeSearchToken(token: string): string {
  if (token.length > 4 && /(?:ch|sh|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(normalizeSearchToken).filter((token) => !SEARCH_STOP_WORDS.has(token)))];
}

function exactRequestedNames(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((name): name is string => typeof name === "string").map((name) => name.trim().toLowerCase()).filter(Boolean));
}

export function getUnknownExactPlasticToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const knownNames = new Set([...PLASTIC_TOOL_NAMES].map((name) => name.toLowerCase()));
  return [...new Set(value.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map((name) => name.trim())
    .filter((name) => !knownNames.has(name.toLowerCase())))];
}

function normalizeLimit(value: unknown, requestedNames: ReadonlySet<string>): number {
  if (typeof value === "number" && Number.isInteger(value)) return Math.max(1, Math.min(MAX_PLASTIC_TOOL_SEARCH_RESULTS, value));
  return requestedNames.size > 0 ? MAX_PLASTIC_TOOL_SEARCH_RESULTS : 1;
}

function safetyPriority(entry: PlasticSearchCatalogEntry): number {
  if (entry.tags.includes("query")) return 0;
  if (entry.tags.includes("inspect")) return 1;
  if (entry.tags.includes("mutation")) return 3;
  return 2;
}

/** Search the executable catalog with deterministic scoring and safe bare-domain ordering. */
export function searchPlasticTools(input: PlasticToolSearchInput, descriptions: ReadonlyMap<string, string> = new Map()): PlasticToolSearchMatch[] {
  const requestedNames = exactRequestedNames(input.toolNames);
  const terms = typeof input.query === "string" ? tokenize(input.query) : [];
  const limit = normalizeLimit(input.limit, requestedNames);
  const domainTerms = terms.filter((term) => SEARCH_DOMAIN_TERMS.has(term));
  const primaryDomainTerm = domainTerms[0];
  const mutationIntent = terms.some((term) => MUTATION_INTENT_TERMS.has(term));
  const preferReadOnly = domainTerms.length > 0 && !mutationIntent;

  return PLASTIC_SEARCH_CATALOG.map((entry, index) => {
    const description = descriptions.get(entry.name);
    const nameTokens = new Set(tokenize(entry.name));
    const aliases = entry.aliases.map(tokenize);
    const tags = entry.tags.map(tokenize);
    const descriptionTokens = new Set(tokenize(description ?? ""));
    const exact = requestedNames.has(entry.name.toLowerCase());
    let score = exact ? 1000 : 0;
    let matchedTerms = 0;
    for (const term of terms) {
      const nameMatch = nameTokens.has(term);
      const aliasMatch = aliases.some((alias) => alias.includes(term));
      const tagMatch = tags.some((tag) => tag.includes(term));
      const descriptionMatch = descriptionTokens.has(term);
      if (nameMatch || aliasMatch || tagMatch || descriptionMatch) matchedTerms += 1;
      if (nameMatch) score += 8;
      if (aliasMatch) score += 6;
      if (tagMatch) score += 4;
      if (descriptionMatch) score += 1;
    }
    const domainMatches = primaryDomainTerm && (nameTokens.has(primaryDomainTerm) || aliases.some((alias) => alias.includes(primaryDomainTerm)) || tags.some((tag) => tag.includes(primaryDomainTerm)) || descriptionTokens.has(primaryDomainTerm)) ? 1 : 0;
    return { ...entry, description, score, matchedTerms, domainMatches, index, exact };
  })
    .filter((entry) => entry.exact || entry.score > 0)
    .filter((entry) => entry.exact || domainTerms.length === 0 || entry.domainMatches > 0)
    .filter((entry, _index, entries) => {
      if (entry.exact || terms.length <= 1) return true;
      const bestCoverage = Math.max(...entries.map((candidate) => candidate.matchedTerms));
      return entry.matchedTerms === bestCoverage;
    })
    .filter((entry) => entry.exact || !preferReadOnly || !entry.tags.includes("mutation"))
    .sort((left, right) => right.score - left.score || (preferReadOnly ? safetyPriority(left) - safetyPriority(right) : 0) || left.index - right.index)
    .slice(0, limit)
    .map(({ matchedTerms: _matchedTerms, domainMatches: _domainMatches, index: _index, exact: _exact, ...entry }) => entry);
}

const BROAD_PRODUCT_QUERIES = new Set(["plastic", "plastic scm", "unity version control", "version control", "uvcs", "vcs"]);

/** Empty and product-level requests are discovery prompts, never activation requests. */
export function isPlasticToolBrowseRequest(input: PlasticToolSearchInput): boolean {
  if (exactRequestedNames(input.toolNames).size > 0) return false;
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase().replace(/\s+/g, " ") : "";
  return query.length === 0 || BROAD_PRODUCT_QUERIES.has(query);
}

export const PLASTIC_TOOL_BROWSE_TEXT = "Browse Plastic capabilities without activating tools: workspace status/sync; changes and checkins; text-only diffs and patches; branches and merges; shelvesets; code reviews; and workspaces. Examples: ‘pending changes’, ‘diff file’, ‘list branches’, or ‘find code reviews’.";

export function getRestoredPlasticToolNames(branchEntries: readonly unknown[], effectiveToolNames: ReadonlySet<string> = PLASTIC_TOOL_NAMES): string[] {
  const restored = new Set<string>();
  for (const entry of branchEntries) {
    const candidate = entry as { type?: unknown; message?: { role?: unknown; addedToolNames?: unknown } };
    if (candidate.type !== "message" || candidate.message?.role !== "toolResult" || !Array.isArray(candidate.message.addedToolNames)) continue;
    for (const name of candidate.message.addedToolNames) {
      if (typeof name === "string" && effectiveToolNames.has(name)) restored.add(name);
    }
  }
  return [...PLASTIC_COMPATIBILITY_TOOL_NAMES, ...PLASTIC_SEARCH_CATALOG.map((entry) => entry.name)].filter((name) => restored.has(name));
}
