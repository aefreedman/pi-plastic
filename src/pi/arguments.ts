import type { PlasticExportName } from "./tool-registry";

type ToolConfig = {
  prepareArguments?: (args: unknown) => Record<string, unknown>;
};

export const TOOL_CONFIG: Partial<Record<PlasticExportName, ToolConfig>> = {
  status: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "includeRevId", ["include_rev_id"]);
      assignAlias(input, "machineReadable", ["machine_readable", "machine"]);
      assignAlias(input, "maxItems", ["max_items"]);
      assignAlias(input, "includeRaw", ["include_raw"]);
      return input;
    },
  },
  update: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      return input;
    },
  },
  add: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      promoteSinglePath(input);
      assignAlias(input, "paths", ["items"]);
      return input;
    },
  },
  checkin: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "message", ["comment", "comments"]);
      promoteSinglePath(input);
      assignAlias(input, "paths", ["items", "files"]);
      assignAlias(input, "applyChanged", ["apply_changed"]);
      assignAlias(input, "includePrivate", ["include_private"]);
      assignAlias(input, "includeAll", ["include_all"]);
      assignAlias(input, "updateAfter", ["update_after"]);
      return input;
    },
  },
  undo: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      promoteSinglePath(input);
      assignAlias(input, "paths", ["items"]);
      // Consumed aliases must not become unsupported extra options in the selected producer.
      for (const key of ["cwd", "workingDirectory", "working_directory", "path", "file", "items"]) delete input[key];
      return input;
    },
  },
  resolveDeleteChangeConflict: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      promoteSinglePath(input);
      assignAlias(input, "paths", ["items", "files"]);
      assignAlias(input, "keepOnDisk", ["keep_on_disk", "keepOnDisk", "nodisk"]);
      return input;
    },
  },
  diff: {
    prepareArguments(args) {
      const input=normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      return input;
    },
  },
  patch: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "output", ["output_file", "outputFile"]);
      assignAlias(input, "toolPath", ["tool_path", "tool"]);
      return input;
    },
  },
  branchCreate: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "commentsFile", ["comments_file"]);
      return input;
    },
  },
  switchBranch: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "pendingChanges", ["pending_changes"]);
      return input;
    },
  },
  merge: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "cherrypicking", ["cherry_picking", "cherryPicking"]);
      return input;
    },
  },
  mergeBranches: {
    prepareArguments(args) {
      return normalizeOutputFormatAlias(normalizeArgs(args));
    },
  },
  mergeToBranch: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "source", ["sourceBranch", "source_branch", "branch"]);
      assignAlias(input, "target", ["targetBranch", "target_branch", "destination", "destinationBranch", "destination_branch"]);
      assignAlias(input, "cardRef", ["card", "cardCode", "card_code", "codecksCard", "codecks_card"]);
      assignAlias(input, "updateTarget", ["update_target", "update"]);
      assignAlias(input, "includePrivate", ["include_private"]);
      return input;
    },
  },
  finalizeMerge: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "source", ["mergeSource", "merge_source"]);
      return input;
    },
  },
  currentBranch: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      return input;
    },
  },
  branchList: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "nameLike", ["name_like"]);
      assignAlias(input, "includeHidden", ["include_hidden"]);
      assignAlias(input, "orderBy", ["order_by"]);
      return input;
    },
  },
  branchExists: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      return input;
    },
  },
  branchDelete: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "deleteChangesets", ["delete_changesets"]);
      return input;
    },
  },
  shelvesetCreate: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      promoteSinglePath(input);
      assignAlias(input, "paths", ["items"]);
      assignAlias(input, "commentsFile", ["comments_file"]);
      assignAlias(input, "summaryFormat", ["summary_format"]);
      return input;
    },
  },
  shelvesetApply: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "changePaths", ["change_paths"]);
      assignAlias(input, "dontCheckout", ["dont_checkout"]);
      assignAlias(input, "comparisonMethod", ["comparison_method"]);
      return input;
    },
  },
  shelvesetDelete: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      return input;
    },
  },
  shelvesetList: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "commentLike", ["comment_like"]);
      assignAlias(input, "dateFrom", ["date_from"]);
      assignAlias(input, "dateFormat", ["date_format"]);
      return input;
    },
  },
  codeReviewCreate: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "reviewId", ["id"]);
      return input;
    },
  },
  codeReviewUpdate: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "reviewId", ["review_id"]);
      if (input.reviewId !== undefined && input.id === undefined) input.id = input.reviewId;
      return input;
    },
  },
  codeReviewDelete: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      if (input.id !== undefined && input.ids === undefined) input.ids = [String(input.id)];
      assignAlias(input, "ids", ["review_ids"]);
      return input;
    },
  },
  codeReviewFind: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "targetType", ["target_type"]);
      assignAlias(input, "titleLike", ["title_like"]);
      assignAlias(input, "orderBy", ["order_by"]);
      assignAlias(input, "dateFormat", ["date_format"]);
      assignAlias(input, "output", ["output_format", "response_format"]);
      return input;
    },
  },
  workspaceList: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "output", ["output_format", "response_format"]);
      return input;
    },
  },
};

export function normalizeArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? { ...(args as Record<string, unknown>) } : {};
}

function assignAlias(target: Record<string, unknown>, key: string, aliases: string[]): void {
  if (target[key] !== undefined) return;
  for (const alias of aliases) {
    if (target[alias] !== undefined) {
      target[key] = target[alias];
      return;
    }
  }
}

function normalizeWorkdirAliases(input: Record<string, unknown>): void {
  assignAlias(input, "workdir", ["cwd", "workingDirectory", "working_directory"]);
}

function normalizeOutputFormatAlias(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.format === "string" && input.format.trim().toLowerCase() === "markdown") {
    input.format = "text";
  }
  if (typeof input.output === "string" && input.output.trim().toLowerCase() === "markdown") {
    input.output = "text";
  }
  return input;
}

function promoteSinglePath(input: Record<string, unknown>): void {
  if (input.paths !== undefined) return;
  const singlePath = input.path ?? input.file;
  if (typeof singlePath === "string" && singlePath.trim().length > 0) {
    input.paths = [singlePath];
  }
}
