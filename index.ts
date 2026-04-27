import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import * as core from "./src/plastic-core";

type CoreSchemaNode = {
  kind: string;
  values?: unknown;
  inner?: unknown;
  metadata?: {
    optional?: boolean;
    description?: string;
    min?: number;
    max?: number;
    int?: boolean;
  };
};

type CoreTool = {
  description?: string;
  args?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

type ToolConfig = {
  prepareArguments?: (args: unknown) => Record<string, unknown>;
};

const EMPTY_PARAMETERS = Type.Object({});
const enumSchema = <T extends readonly [string, ...string[]]>(values: T, description: string): TSchema =>
  Type.Union(values.map((value) => Type.Literal(value)) as [TSchema, TSchema, ...TSchema[]], { description });

const OUTPUT_FORMAT_SCHEMA = enumSchema(["text", "json"], "Output format. Defaults to text.");
const PENDING_CHANGES_SCHEMA = enumSchema(["shelve", "bring", "cancel"], "How to handle pending changes when switching branches.");
const MERGE_STRATEGY_SCHEMA = enumSchema(["auto", "source", "destination"], "Conflict resolution strategy.");
const COMPARISON_METHOD_SCHEMA = enumSchema(
  ["ignoreeol", "ignorewhitespaces", "ignoreeolandwhitespaces", "recognizeall"],
  "Comparison method used for diff calculations.",
);
const REVIEW_TARGET_TYPE_SCHEMA = enumSchema(["branch", "changeset"], "Filter by review target type.");
const BRANCH_ORDER_BY_SCHEMA = enumSchema(["date", "branchname"], "Sort field for branch queries.");
const REVIEW_ORDER_BY_SCHEMA = enumSchema(["date", "modifieddate", "status"], "Sort field for review queries.");

const PLASTIC_EXPORTS = [
  "status",
  "update",
  "add",
  "checkin",
  "undo",
  "resolveDeleteChangeConflict",
  "diff",
  "diffRevisions",
  "diffFile",
  "branchCreate",
  "switchBranch",
  "merge",
  "finalizeMerge",
  "currentBranch",
  "branchList",
  "branchExists",
  "branchDelete",
  "shelvesetCreate",
  "shelvesetApply",
  "shelvesetDelete",
  "shelvesetList",
  "codeReviewCreate",
  "codeReviewUpdate",
  "codeReviewDelete",
  "codeReviewFind",
  "workspaceCreate",
  "workspaceList",
] as const;

type PlasticExportName = (typeof PLASTIC_EXPORTS)[number];

const TOOL_CONFIG: Partial<Record<PlasticExportName, ToolConfig>> = {
  status: {
    prepareArguments(args) {
      const input = normalizeOutputFormatAlias(normalizeArgs(args));
      normalizeWorkdirAliases(input);
      assignAlias(input, "includeRevId", ["include_rev_id"]);
      assignAlias(input, "machineReadable", ["machine_readable", "machine"]);
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
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "repositoryPaths", ["repository_paths"]);
      assignAlias(input, "dateFormat", ["date_format"]);
      assignAlias(input, "comparisonMethod", ["comparison_method"]);
      assignAlias(input, "fullPaths", ["full_paths"]);
      return input;
    },
  },
  diffRevisions: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "leftRevision", ["left_revision"]);
      assignAlias(input, "rightRevision", ["right_revision"]);
      return input;
    },
  },
  diffFile: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
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
  workspaceCreate: {
    prepareArguments(args) {
      const input = normalizeArgs(args);
      normalizeWorkdirAliases(input);
      assignAlias(input, "repositorySpec", ["repository_spec"]);
      assignAlias(input, "selectorFile", ["selector_file"]);
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

function toToolName(exportName: string): string {
  return `plastic_${exportName}`;
}

function toText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  return JSON.stringify(result, null, 2);
}

function normalizeArgs(args: unknown): Record<string, unknown> {
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

function getCoreTool(exportName: string): CoreTool {
  const candidate = (core as Record<string, unknown>)[exportName] as CoreTool | undefined;
  if (!candidate || typeof candidate.execute !== "function") {
    throw new Error(`Missing Plastic core tool export '${exportName}'.`);
  }
  return candidate;
}

function isCoreSchemaNode(value: unknown): value is CoreSchemaNode {
  return Boolean(value) && typeof value === "object" && typeof (value as { kind?: unknown }).kind === "string";
}

function applySchemaMetadata(schema: TSchema, node: CoreSchemaNode): TSchema {
  const metadata = node.metadata ?? {};
  const options: Record<string, unknown> = {};

  if (metadata.description) options.description = metadata.description;
  if (metadata.min !== undefined) options.minimum = metadata.min;
  if (metadata.max !== undefined) options.maximum = metadata.max;

  let nextSchema: TSchema = schema;
  if (Object.keys(options).length > 0) {
    if (schema.type === "string") nextSchema = Type.String(options);
    else if (schema.type === "number" || schema.type === "integer") nextSchema = metadata.int ? Type.Integer(options) : Type.Number(options);
    else if (schema.type === "boolean") nextSchema = Type.Boolean(options);
    else if (schema.type === "array") nextSchema = Type.Array((schema as any).items ?? Type.Any(), options);
    else nextSchema = Type.Unsafe({ ...schema, ...options });
  }

  if (metadata.int && nextSchema.type === "number") {
    nextSchema = Type.Integer({ description: options.description as string | undefined, minimum: options.minimum as number | undefined, maximum: options.maximum as number | undefined });
  }

  return metadata.optional ? Type.Optional(nextSchema) : nextSchema;
}

function literalSchema(value: unknown): TSchema {
  if (typeof value === "string") return Type.Literal(value);
  if (typeof value === "number") return Number.isInteger(value) ? Type.Literal(value) : Type.Literal(value);
  if (typeof value === "boolean") return Type.Literal(value);
  return Type.Any();
}

function convertCoreSchema(node: unknown): TSchema {
  if (!isCoreSchemaNode(node)) {
    return literalSchema(node);
  }

  let schema: TSchema;
  switch (node.kind) {
    case "string":
      schema = Type.String();
      break;
    case "number":
      schema = node.metadata?.int ? Type.Integer() : Type.Number();
      break;
    case "boolean":
      schema = Type.Boolean();
      break;
    case "any":
      schema = Type.Any();
      break;
    case "array":
      schema = Type.Array(convertCoreSchema(node.inner));
      break;
    case "enum": {
      const values = Array.isArray(node.values) ? node.values : [];
      if (values.every((value) => typeof value === "string")) {
        const valueSet = values as string[];
        if (arraysEqual(valueSet, ["text", "json"])) {
          schema = OUTPUT_FORMAT_SCHEMA;
        } else if (arraysEqual(valueSet, ["shelve", "bring", "cancel"])) {
          schema = PENDING_CHANGES_SCHEMA;
        } else if (arraysEqual(valueSet, ["auto", "source", "destination"])) {
          schema = MERGE_STRATEGY_SCHEMA;
        } else if (arraysEqual(valueSet, ["ignoreeol", "ignorewhitespaces", "ignoreeolandwhitespaces", "recognizeall"])) {
          schema = COMPARISON_METHOD_SCHEMA;
        } else if (arraysEqual(valueSet, ["branch", "changeset"])) {
          schema = REVIEW_TARGET_TYPE_SCHEMA;
        } else if (arraysEqual(valueSet, ["date", "branchname"])) {
          schema = BRANCH_ORDER_BY_SCHEMA;
        } else if (arraysEqual(valueSet, ["date", "modifieddate", "status"])) {
          schema = REVIEW_ORDER_BY_SCHEMA;
        } else {
          schema = enumSchema(valueSet as [string, ...string[]], metadataDescription(node));
        }
      } else {
        schema = Type.Union(values.map((value) => literalSchema(value)) as [TSchema, TSchema, ...TSchema[]]);
      }
      break;
    }
    case "union": {
      const values = Array.isArray(node.values) ? node.values : [];
      const converted = values.map((value) => convertCoreSchema(value));
      schema = converted.length > 1 ? Type.Union(converted as [TSchema, TSchema, ...TSchema[]]) : (converted[0] ?? Type.Any());
      break;
    }
    default:
      schema = Type.Any();
      break;
  }

  return applySchemaMetadata(schema, node);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function metadataDescription(node: CoreSchemaNode): string {
  return node.metadata?.description ?? "Allowed values.";
}

function buildParameters(args: Record<string, unknown> | undefined): TSchema {
  if (!args || Object.keys(args).length === 0) {
    return EMPTY_PARAMETERS;
  }

  const properties: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(args)) {
    properties[key] = convertCoreSchema(value);
  }
  return Type.Object(properties);
}

export default function plasticTools(pi: ExtensionAPI) {
  for (const exportName of PLASTIC_EXPORTS) {
    const coreTool = getCoreTool(exportName);
    const config = TOOL_CONFIG[exportName] ?? {};
    pi.registerTool({
      name: toToolName(exportName),
      label: toToolName(exportName),
      description: coreTool.description ?? toToolName(exportName),
      parameters: buildParameters(coreTool.args),
      prepareArguments: config.prepareArguments,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const normalizedParams = normalizeArgs(params);
        if (normalizedParams.workdir === undefined && ctx?.cwd) {
          normalizedParams.workdir = ctx.cwd;
        }
        const result = await core.runWithAbortSignal(signal, async () => coreTool.execute(normalizedParams));
        const text = toText(result);
        return {
          content: [{ type: "text", text }],
          details: {
            exportName,
            rawResult: result,
          },
        };
      },
    });
  }
}
