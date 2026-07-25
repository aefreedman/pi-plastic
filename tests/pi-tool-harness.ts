import { fileURLToPath } from "node:url";

export type ToolSourceInfo = {
  path: string;
  source: string;
  scope: string;
  origin: string;
  baseDir?: string;
};

export type RegisteredTool = {
  name: string;
  label?: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  sourceInfo?: ToolSourceInfo;
  parameters?: unknown;
  constrainedSampling?: false | {
    type: "json_schema";
    strict: "prefer" | "require";
  } | {
    type: "grammar";
    variants: {
      openai_lark?: string;
      openai_regex?: string;
    };
  };
  prepareArguments?: (args: unknown) => Record<string, unknown>;
  execute: (...args: any[]) => Promise<any> | any;
};

type SessionStartHandler = (event: unknown, ctx: { sessionManager: { getBranch: () => unknown[] } }) => Promise<void> | void;

const DEFAULT_EXTENSION_SOURCE: ToolSourceInfo = {
  path: fileURLToPath(new URL("../index.ts", import.meta.url)),
  source: "extension",
  scope: "project",
  origin: "package",
};

export class PiToolHarness {
  readonly registry = new Map<string, RegisteredTool>();
  readonly setActiveToolsCalls: string[][] = [];
  private readonly sessionStartHandlers: SessionStartHandler[] = [];
  private readonly sourceInfoAvailable: boolean;
  private readonly extensionSourceInfo: ToolSourceInfo;
  private activeTools: string[];
  private branchEntries: unknown[];

  constructor(options: {
    activeTools?: string[];
    branchEntries?: unknown[];
    foreignTools?: RegisteredTool[];
    sourceInfoAvailable?: boolean;
    extensionSourceInfo?: ToolSourceInfo;
  } = {}) {
    this.activeTools = [...(options.activeTools ?? [])];
    this.branchEntries = [...(options.branchEntries ?? [])];
    // Default to Pi 0.82 behavior; individual compatibility tests explicitly
    // opt out to model older runtimes without canonical sourceInfo.
    this.sourceInfoAvailable = options.sourceInfoAvailable ?? true;
    this.extensionSourceInfo = options.extensionSourceInfo ?? DEFAULT_EXTENSION_SOURCE;
    for (const tool of options.foreignTools ?? []) this.registry.set(tool.name, { ...tool });
  }

  readonly api = {
    registerTool: (tool: RegisteredTool) => {
      // Pi keeps the first effective definition for a colliding extension name.
      if (!this.registry.has(tool.name)) {
        this.registry.set(tool.name, this.sourceInfoAvailable ? { ...tool, sourceInfo: this.extensionSourceInfo } : { ...tool });
      }
    },
    on: (event: string, handler: SessionStartHandler) => {
      if (event === "session_start") this.sessionStartHandlers.push(handler);
    },
    getActiveTools: () => [...this.activeTools],
    getAllTools: () => [...this.registry.values()],
    setActiveTools: (names: string[]) => {
      this.activeTools = [...new Set(names)];
      this.setActiveToolsCalls.push([...this.activeTools]);
    },
  };

  async load(modulePath = "../index.ts"): Promise<void> {
    const extensionModule = await import(modulePath);
    const extension = extensionModule.default as ((pi: any) => void) | undefined;
    if (typeof extension !== "function") throw new Error(`Extension module '${modulePath}' has no default function export.`);
    extension(this.api);
  }

  async startSession(branchEntries = this.branchEntries): Promise<void> {
    this.branchEntries = [...branchEntries];
    const ctx = { sessionManager: { getBranch: () => [...this.branchEntries] } };
    for (const handler of this.sessionStartHandlers) await handler({ reason: "startup" }, ctx);
  }

  getActiveTools(): string[] {
    return [...this.activeTools];
  }
}

export async function loadRegisteredTools(modulePath = "../index.ts"): Promise<Map<string, RegisteredTool>> {
  const harness = new PiToolHarness();
  await harness.load(modulePath);
  return harness.registry;
}

export async function invokeRegisteredTool(name: string, args: Record<string, unknown>, cwd = process.cwd(), modulePath = "../index.ts"): Promise<string> {
  const tools = await loadRegisteredTools(modulePath);
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool '${name}' is not registered.`);
  const result = await tool.execute("test-tool-call", args, undefined, undefined, { cwd });
  const textParts = Array.isArray(result?.content) ? result.content.filter((entry: any) => entry?.type === "text") : [];
  return textParts.map((entry: any) => String(entry.text ?? "")).join("\n");
}
