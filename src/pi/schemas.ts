import { type TSchema, Type } from "typebox";

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

const EMPTY_PARAMETERS = Type.Object({});
const enumSchema = (values: readonly string[], description: string): TSchema =>
  Type.Union(values.map((value) => Type.Literal(value)), { description });

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

function isCoreSchemaNode(value: unknown): value is CoreSchemaNode {
  return Boolean(value) && typeof value === "object" && typeof (value as { kind?: unknown }).kind === "string";
}

function applySchemaMetadata(schema: TSchema, node: CoreSchemaNode): TSchema {
  const metadata = node.metadata ?? {};
  const options: { description?: string; minimum?: number; maximum?: number } = {};

  if (metadata.description) options.description = metadata.description;
  if (metadata.min !== undefined) options.minimum = metadata.min;
  if (metadata.max !== undefined) options.maximum = metadata.max;

  let nextSchema: TSchema = schema;
  if (Object.keys(options).length > 0) {
    if (Type.IsString(schema)) nextSchema = Type.String(options);
    else if (Type.IsNumber(schema) || Type.IsInteger(schema)) nextSchema = metadata.int ? Type.Integer(options) : Type.Number(options);
    else if (Type.IsBoolean(schema)) nextSchema = Type.Boolean(options);
    else if (Type.IsArray(schema)) nextSchema = Type.Array(schema.items, options);
    else nextSchema = Type.Unsafe({ ...schema, ...options });
  }

  if (metadata.int && Type.IsNumber(nextSchema)) {
    nextSchema = Type.Integer(options);
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
        const valueSet = values;
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
          schema = enumSchema(valueSet, metadataDescription(node));
        }
      } else {
        schema = Type.Union(values.map((value) => literalSchema(value)));
      }
      break;
    }
    case "union": {
      const values = Array.isArray(node.values) ? node.values : [];
      const converted = values.map((value) => convertCoreSchema(value));
      schema = converted.length > 1 ? Type.Union(converted) : (converted[0] ?? Type.Any());
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

export function buildParameters(args: Record<string, unknown> | undefined): TSchema {
  if (!args || Object.keys(args).length === 0) {
    return EMPTY_PARAMETERS;
  }

  const properties: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(args)) {
    properties[key] = convertCoreSchema(value);
  }
  return Type.Object(properties);
}
