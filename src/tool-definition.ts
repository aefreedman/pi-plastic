export interface SchemaNode<Value = unknown> {
  // Type-only carrier: no runtime field or validation behavior is added.
  readonly valueType?: Value;
  kind: string;
  values?: unknown;
  inner?: unknown;
  metadata?: Record<string, unknown>;
  optional(): SchemaNode<Value> & { readonly optionalField?: true };
  describe(description: string): this;
  min(value: number): this;
  max(value: number): this;
  int(): this;
}

type InferSchema<Node> = Node extends SchemaNode<infer Value> ? Value : Node;
export type InferArguments<Args extends Record<string, SchemaNode>> = {
  [Key in keyof Args as "optionalField" extends keyof Args[Key] ? never : Key]: InferSchema<Args[Key]>;
} & {
  [Key in keyof Args as "optionalField" extends keyof Args[Key] ? Key : never]?: InferSchema<Args[Key]>;
};

type ToolDefinition<Args extends Record<string, SchemaNode>, Result> = {
  description: string;
  args: Args;
  execute: (args: InferArguments<Args>) => Result;
};

function createSchemaNode<Value>(kind: string, values?: unknown, inner?: unknown): SchemaNode<Value> {
  const node: SchemaNode<Value> = {
    kind,
    values,
    inner,
    metadata: {},
    optional() {
      this.metadata = { ...(this.metadata ?? {}), optional: true };
      return this;
    },
    describe(description: string) {
      this.metadata = { ...(this.metadata ?? {}), description };
      return this;
    },
    min(value: number) {
      this.metadata = { ...(this.metadata ?? {}), min: value };
      return this;
    },
    max(value: number) {
      this.metadata = { ...(this.metadata ?? {}), max: value };
      return this;
    },
    int() {
      this.metadata = { ...(this.metadata ?? {}), int: true };
      return this;
    },
  };
  return node;
}

export const tool = Object.assign(
  <Args extends Record<string, SchemaNode>, Result>(definition: ToolDefinition<Args, Result>): ToolDefinition<Args, Result> => definition,
  {
    schema: {
      string: () => createSchemaNode<string>("string"),
      number: () => createSchemaNode<number>("number"),
      boolean: () => createSchemaNode<boolean>("boolean"),
      any: () => createSchemaNode<unknown>("any"),
      enum: <const Values extends readonly unknown[]>(values: Values) => createSchemaNode<Values[number]>("enum", [...values]),
      union: <const Values extends readonly unknown[]>(values: Values) => createSchemaNode<InferSchema<Values[number]>>("union", [...values]),
      array: <Inner>(inner: Inner) => createSchemaNode<InferSchema<Inner>[]>("array", undefined, inner),
    },
  },
);
