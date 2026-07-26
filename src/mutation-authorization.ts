import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  consumeWorkflowAuthorizationTokenV1,
  issueWorkflowAuthorizationTokenV1,
  type WorkflowAuthorizationTokenDecisionV1,
} from "@aefree/pi-workflow/authorization/v1";
import type { WorkflowAuthorityFlagV1 } from "@aefree/pi-workflow/contracts/v1";

export type PlasticMutationAuthorizationContext = {
  readonly sessionManager: object;
  readonly mode: "tui" | "rpc" | "json" | "print" | string;
  readonly hasUI: boolean;
  readonly authorizationToken?: string;
  readonly confirm?: (title: string, message: string) => Promise<boolean>;
  authorizationProvenance?: Array<Readonly<{
    authoritySource: "authorization_token_consumed" | "direct_user_confirmation";
    action: WorkflowAuthorityFlagV1;
    canonicalTargets: readonly string[];
    consumed: true;
  }>>;
};

export type PlasticCommandAuthorization = Readonly<{
  mutation: boolean;
  classified: boolean;
  action?: WorkflowAuthorityFlagV1;
  target?: string;
  operation: string;
}>;

export const PLASTIC_READ_ONLY_COMMANDS_V1 = Object.freeze(["status", "find", "version", "cat", "patch", "workspace list", "shelveset apply preview"] as const);
export const PLASTIC_MUTATION_COMMANDS_V1 = Object.freeze([
  "update", "add", "checkin", "undo", "remove", "switch", "merge",
  "branch create", "branch delete",
  "shelveset create", "shelveset apply", "shelveset delete",
  "codereview create", "codereview update", "codereview delete",
  "workspace create",
] as const);

const encode = (value: unknown): string => encodeURIComponent(String(value ?? "").trim())
  .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export function canonicalPlasticWorkdirV1(workdir: string): string {
  let canonical: string;
  try { canonical = realpathSync.native(path.resolve(workdir)); }
  catch { canonical = path.resolve(workdir); }
  return canonical.replaceAll("\\", "/");
}

function commandOperation(args: readonly string[]): string {
  const first = String(args[0] ?? "").trim().toLowerCase();
  const second = String(args[1] ?? "").trim().toLowerCase();
  if (first === "branch" && (second === "create" || second === "delete")) return `branch ${second}`;
  if (first === "shelveset" && second === "apply" && args.includes("--preview")) return "shelveset apply preview";
  if (first === "shelveset" && (second === "create" || second === "apply" || second === "delete")) return `shelveset ${second}`;
  if (first === "workspace" && (second === "create" || second === "list")) return `workspace ${second}`;
  if (first === "codereview") {
    if (args.some((arg) => arg === "-d")) return "codereview delete";
    if (args.some((arg) => arg === "-e")) return "codereview update";
    return "codereview create";
  }
  return first;
}

function actionForOperation(operation: string): WorkflowAuthorityFlagV1 {
  if (operation === "checkin") return "commit";
  if (operation.startsWith("codereview ") || operation === "branch create" || operation === "branch delete" || operation === "shelveset create" || operation === "shelveset delete" || operation === "workspace create") return "publish";
  return "vcs_mutation";
}

function semanticEntity(operation: string, args: readonly string[]): string {
  const positional = args.filter((arg, index) => index > 0 && !arg.startsWith("-") && !/^[-/]?c=/i.test(arg));
  switch (operation) {
    case "branch create":
    case "branch delete": return positional.at(-1) ?? "workspace";
    case "switch": return positional[0] ?? "workspace";
    case "merge": return positional[0] ?? "workspace";
    case "shelveset apply":
    case "shelveset delete": return positional.at(-1) ?? "workspace";
    case "codereview update": return args[2] ?? "review";
    case "codereview delete": return createHash("sha256").update(args.slice(2).filter((arg) => !arg.startsWith("-")).sort().join("\0")).digest("hex").slice(0, 20);
    case "codereview create": return args[1] ?? "review";
    case "workspace create": return positional.slice(-2).join("+") || "workspace";
    case "add":
    case "undo":
    case "remove": return positional.length > 0 ? createHash("sha256").update([...positional].sort().join("\0")).digest("hex").slice(0, 20) : "workspace";
    default: return "workspace";
  }
}

export function classifyPlasticCommandAuthorizationV1(args: readonly string[], workdir: string): PlasticCommandAuthorization {
  const operation = commandOperation(args);
  if ((PLASTIC_READ_ONLY_COMMANDS_V1 as readonly string[]).includes(operation)) {
    return Object.freeze({ mutation: false, classified: true, operation });
  }
  const classified = (PLASTIC_MUTATION_COMMANDS_V1 as readonly string[]).includes(operation);
  const canonicalWorkdir = canonicalPlasticWorkdirV1(workdir);
  const action = actionForOperation(operation);
  const target = `plastic:${encode(canonicalWorkdir)}:${operation.replaceAll(" ", ".")}:${encode(semanticEntity(operation, args))}`;
  return Object.freeze({ mutation: true, classified, action, target, operation });
}

export class PlasticMutationAuthorizationError extends Error {
  readonly code: string;
  readonly action: WorkflowAuthorityFlagV1;
  readonly target: string;

  constructor(code: string, action: WorkflowAuthorityFlagV1, target: string, remediation?: string) {
    super(`Plastic mutation blocked (${code}) for action '${action}' and exact target '${target}'.${remediation ? ` ${remediation}` : ""}`);
    this.name = "PlasticMutationAuthorizationError";
    this.code = code;
    this.action = action;
    this.target = target;
  }
}

/** Called at the cm process sink after command and workdir canonicalization. */
export async function authorizePlasticMutationSinkV1(
  context: PlasticMutationAuthorizationContext | undefined,
  command: PlasticCommandAuthorization,
): Promise<void> {
  if (!command.mutation) return;
  const action = command.action!;
  const target = command.target!;
  if (context === undefined || context.sessionManager === null || typeof context.sessionManager !== "object") {
    throw new PlasticMutationAuthorizationError("authorization_context_required", action, target);
  }

  if (context.authorizationToken !== undefined) {
    if (!command.classified) throw new PlasticMutationAuthorizationError("mutation_method_unclassified_confirmation_required", action, target);
    const decision = consumeWorkflowAuthorizationTokenV1(context.sessionManager, context.authorizationToken, action, [target]);
    if (decision.outcome !== "accepted") throw decisionError(decision, action, target);
    (context.authorizationProvenance ??= []).push(Object.freeze({
      authoritySource: "authorization_token_consumed" as const,
      action,
      canonicalTargets: Object.freeze([target]),
      consumed: true as const,
    }));
    return;
  }

  const interactive = context.hasUI && (context.mode === "tui" || context.mode === "rpc") && typeof context.confirm === "function";
  if (!interactive) throw new PlasticMutationAuthorizationError("authorization_token_required", action, target);
  const confirmed = await context.confirm!(
    "Authorize Plastic SCM mutation?",
    `Action: ${action}\nOperation: ${command.operation}\nExact target: ${target}\n\nThis confirmation authorizes one cm mutation process spawn only. A retry requires fresh authorization.`,
  );
  if (!confirmed) throw new PlasticMutationAuthorizationError("authorization_user_denied", action, target);
  const issued = issueWorkflowAuthorizationTokenV1(context.sessionManager, action, [target]);
  const consumed = consumeWorkflowAuthorizationTokenV1(context.sessionManager, issued.authorizationToken, action, [target]);
  if (consumed.outcome !== "accepted") throw decisionError(consumed, action, target);
  (context.authorizationProvenance ??= []).push(Object.freeze({
    authoritySource: "direct_user_confirmation" as const,
    action,
    canonicalTargets: Object.freeze([target]),
    consumed: true as const,
  }));
}

function decisionError(
  decision: Extract<WorkflowAuthorizationTokenDecisionV1, { outcome: "blocked" }>,
  action: WorkflowAuthorityFlagV1,
  target: string,
): PlasticMutationAuthorizationError {
  return new PlasticMutationAuthorizationError(
    decision.code,
    action,
    target,
    decision.code === "authorization_token_replayed"
      ? "The token already authorized one cm process spawn. Because the prior side-effecting attempt may have taken effect, inspect Plastic status, then obtain a fresh token or direct TUI/RPC confirmation before retrying."
      : undefined,
  );
}
