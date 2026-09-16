import { stripVTControlCharacters } from "node:util";
import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

type Args = Record<string, unknown>;
type RenderTheme = Pick<Theme, "fg" | "bold">;
type Context = { args?: unknown; cwd?: string; isError?: boolean; lastComponent?: unknown };
type Result = { content?: Array<{ type: string; text?: string }>; details?: unknown };
type Options = { expanded?: boolean; isPartial?: boolean };
type Tone = "success" | "warning" | "error" | "toolOutput";
type Summary = { label: string; tone: Tone; notices: string[]; rows: string[] };
const separator = " \u00b7 ";

const titles: Record<string, string> = {
  status: "Status", currentBranch: "Current branch", update: "Update", add: "Add", checkin: "Check in", undo: "Undo",
  resolveDeleteChangeConflict: "Resolve deletion", diff: "Diff (disabled)", patch: "Review patch", diffRevisions: "Revision diff",
  diffFile: "File diff", workspaceDiff: "Workspace diff", branchCreate: "Create branch", switchBranch: "Switch branch",
  merge: "Merge", mergeBranches: "Server merge", mergeToBranch: "Merge and check in", finalizeMerge: "Finalize merge",
  branchList: "Branches", branchExists: "Branch exists", branchDelete: "Delete branch", shelvesetCreate: "Create shelveset",
  shelvesetApply: "Apply shelveset", shelvesetDelete: "Delete shelveset", shelvesetList: "Shelvesets",
  codeReviewCreate: "Create review", codeReviewUpdate: "Update review", codeReviewDelete: "Delete reviews",
  codeReviewFind: "Find reviews", workspaceList: "Workspaces", tool_search: "Find tools",
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function scalar(value: unknown): string {
  // Parsed numbers must not turn rounded revision/changeset IDs into plausible evidence.
  return typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
}
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function safe(value: string): string {
  return stripVTControlCharacters(value).replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
    .replace(/("(?:token|secret|password|api[_-]?key)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
    .replace(/\b(token|secret|password|api[_-]?key)\s*([:=])\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;)}\]]+)/gi, "$1$2[redacted]");
}
function compact(value: string, width = 180): string {
  return truncateToWidth(safe(value).replace(/\s+/g, " ").trim(), width);
}
function body(result: Result): string {
  return (result.content ?? []).filter(entry => entry.type === "text").map(entry => entry.text ?? "").join("\n");
}
function reuse(context: Context | undefined, text: string): Text {
  const component = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  component.setText(text);
  return component;
}
function list(value: unknown): string {
  const items = strings(value);
  return items.slice(0, 2).map(item => compact(item, 85)).join(", ") + (items.length > 2 ? ` (+${items.length - 2} more)` : "");
}
function target(name: string, args: Args): string {
  if (name === "tool_search") return list(args.toolNames) || scalar(args.query) || "Browse capabilities";
  if (name === "diffRevisions") return `${scalar(args.leftRevision) || "..."} -> ${scalar(args.rightRevision) || "..."}`;
  if (name === "mergeBranches" || name === "mergeToBranch") return `${scalar(args.source) || "..."} -> ${scalar(args.target) || "parent branch"}`;
  if (name === "patch" || name === "diff") return [scalar(args.source), scalar(args.destination)].filter(Boolean).join(" -> ");
  if (name === "diffFile") return [scalar(args.path), args.revision ? `vs ${scalar(args.revision)}` : "vs workspace base"].join(" ");
  return scalar(args.branch) || scalar(args.source) || scalar(args.path) || list(args.paths) || scalar(args.shelveset)
    || list(args.ids) || scalar(args.id) || scalar(args.target) || scalar(args.nameLike) || scalar(args.titleLike)
    || (args.allPending === true ? "All pending files" : "");
}

export function renderPlasticCall(name: string, input: unknown, theme: RenderTheme, context?: Context): Text {
  const args = record(input);
  const workdir = scalar(args.workdir) || context?.cwd || "";
  const workspace = name === "mergeBranches" ? "server" : workdir.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  let text = theme.fg("toolTitle", theme.bold(`Plastic${separator}${titles[name] ?? name}`));
  if (workspace && name !== "tool_search") text += theme.fg("dim", `  ${compact(workspace, 60)}`);
  if (args.preflight === true) text += theme.fg("warning", `${separator}preview`);
  const subtitle = target(name, args);
  if (subtitle) text += `\n${theme.fg("accent", compact(subtitle))}`;
  return reuse(context, text);
}

function payload(result: Result, raw: string): Record<string, unknown> {
  const rawResult = record(result.details).rawResult;
  if (rawResult !== null && typeof rawResult === "object") return record(rawResult);
  // Only decode the package's whole JSON envelope, never a JSON fragment in CLI or diff output.
  const source = typeof rawResult === "string" ? rawResult : raw;
  const json = source.match(/^## [^\r\n]+\r?\n\r?\n```json\r?\n([\s\S]*)\r?\n```\s*$/)?.[1] ?? source;
  try { return record(JSON.parse(json)); }
  catch (error) { if (error instanceof SyntaxError) return {}; throw error; }
}

function pending(summary: Record<string, unknown>): string {
  const total = count(summary.totalPending);
  if (total === undefined) return "Status returned";
  const parts = [total === 0 ? "0 pending records" : `${total} pending`];
  for (const key of ["changed", "added", "moved", "deleted", "private", "other"]) {
    const amount = count(summary[key]);
    if (amount) parts.push(`${amount} ${key}`);
  }
  return parts.join(separator);
}

function summarize(name: string, result: Result, raw: string, context?: Context): Summary {
  const envelope = payload(result, raw);
  const data = record(envelope.data);
  const action = scalar(envelope.action);
  const notices = strings(envelope.warnings);
  const summary: Summary = { label: "Result returned", tone: "toolOutput", notices, rows: [] };
  const textLines = raw.split(/\r?\n/).filter(line => line.trim());
  const preview = record(context?.args).preflight === true || action.endsWith("-preflight") || envelope.outcome === "preflight";
  if (context?.isError) {
    summary.label = "Failed";
    summary.tone = "error";
    summary.rows = textLines.slice(0, 3);
    return summary;
  }
  if (preview) {
    const wouldRun = typeof data.wouldRun === "boolean" ? data.wouldRun : /^- Would run: no$/m.test(raw) ? false : /^- Would run: yes$/m.test(raw) ? true : undefined;
    summary.label = wouldRun === false ? "Preview: would not run" : wouldRun === true ? "Preview: would run" : "Preview returned";
    summary.tone = "warning";
    summary.rows = action ? [scalar(data.reason) || scalar(data.errorCode), scalar(data.strategy)].filter(Boolean) : textLines.filter(line => /^- (?:Reason|Strategy|Command):/.test(line));
  } else if (name === "mergeBranches" && typeof envelope.outcome === "string") {
    summary.label = `Server merge: ${envelope.outcome}`;
    summary.tone = envelope.outcome === "completed" ? "success" : "warning";
    const changeset = scalar(record(data.createdChangeset).id);
    if (changeset) summary.label += `${separator}cs:${changeset}`;
    if (data.mergeLinkIdentity === "unverified" || data.xlinkEffects === "unverified") notices.push("Merge-link identity and Xlink effects remain unverified.");
    if (data.effect === "uncertain" || data.effect === "not-proven") notices.unshift("Effects not proven; inspect server state before any retry.");
    if (data.timedOut === true) notices.unshift("Command timed out; effects uncertain.");
    if (data.aborted === true) notices.unshift("Command cancelled; effects uncertain.");
  } else if (data.checkedIn === false || record(data.switchOutcome).kind === "canceled" || data.kind === "canceled" || data.strategy === "cancel-with-pending") {
    summary.label = data.checkedIn === false ? "Checkin not performed" : "Switch cancelled";
    summary.tone = "warning";
    const reason = scalar(record(data.switchOutcome).reason) || scalar(data.reason);
    if (reason) notices.unshift(reason);
  } else if (envelope.ok === false) {
    summary.label = "Operation not successful";
    summary.tone = "error";
  } else if (name === "status" && count(record(data.summary).totalPending) !== undefined) {
    summary.label = pending(record(data.summary));
    summary.rows = records(data.items).map(item => `${scalar(item.statusCode) || scalar(item.kind)}  ${scalar(item.sourcePath) ? `${scalar(item.sourcePath)} -> ` : ""}${scalar(item.path)}`);
    const omitted = count(record(data.itemCount).omitted);
    if (omitted) notices.push(`${omitted} status records omitted by the tool.`);
  } else if (name === "currentBranch" && typeof data.branch === "string") {
    summary.label = data.branch;
  } else if (name === "branchExists" && /^(true|false)$/.test(raw.trim())) {
    summary.label = raw.trim() === "true" ? "Branch found" : "Branch not found";
  } else if ((name === "diffFile" || name === "diffRevisions") && typeof data.status === "string") {
    summary.label = data.status === "unchanged" ? "No differences" : data.status === "binary-different" ? "Binary content differs" : data.status === "added-empty" ? "Added file is empty" : "Text differences";
    if (data.binary === true) notices.push("Binary comparison; no text hunks.");
  } else if (name === "workspaceDiff" && Array.isArray(data.outcomes)) {
    const outcomes = records(data.outcomes);
    const unavailable = outcomes.filter(item => item.status === "unavailable");
    const skipped = outcomes.filter(item => item.status === "skipped-directory");
    summary.label = `${outcomes.length} results${separator}${outcomes.filter(item => item.changed === true).length} changed${separator}${unavailable.length} unavailable`;
    if (unavailable.length) summary.tone = "warning";
    if (skipped.length) notices.push(`${skipped.length} directories skipped.`);
    summary.rows = [...unavailable, ...outcomes.filter(item => item.status !== "unavailable" && item.status !== "skipped-directory"), ...skipped].map(item => `${scalar(item.path)}: ${scalar(item.status)}${item.error ? ` - ${scalar(item.error)}` : ""}`);
    if (outcomes.some(item => item.truncated === true)) notices.push("Some file diffs were truncated by the tool.");
    if (count(data.omittedOutcomes)) notices.push(`${data.omittedOutcomes} outcomes omitted by the tool.`);
    if (count(data.skippedByLimit)) notices.push(`${data.skippedByLimit} pending items skipped by the file limit.`);
  } else if (name === "patch" && typeof envelope.status === "string") {
    summary.label = `Patch ${envelope.status}${count(envelope.bytes) !== undefined ? `${separator}${envelope.bytes} bytes` : ""}`;
    if (envelope.binaryLimited === true) notices.push("Binary content could not be fully represented.");
    if (envelope.truncated === true) notices.push("Patch output truncated by the tool.");
    summary.rows = [scalar(envelope.output)].filter(Boolean);
  } else if (data.checkedIn === true) {
    summary.label = `Merge checked in${scalar(data.finalBranch) ? `${separator}${scalar(data.finalBranch)}` : ""}`;
    summary.tone = "success";
  } else if (count(data.resultCount) !== undefined) {
    summary.label = `${data.resultCount} returned rows`;
    summary.rows = scalar(data.rawOutput).split(/\r?\n/).filter(Boolean);
  } else if (action) {
    summary.label = `${titles[name] ?? action}: result returned`;
    const outputLines = scalar(data.rawOutput).split(/\r?\n/).filter(Boolean);
    if (outputLines.length) { summary.label = outputLines[0]; summary.rows = outputLines.slice(1); }
    if (name === "switchBranch" && typeof data.branchAfter === "string") summary.label = `Workspace branch: ${data.branchAfter}`;
    if (name === "merge") summary.label = "Merge command returned";
  } else {
    // Unknown and legacy text results stay neutral: command completion is not proof of a mutation.
    summary.label = textLines[0]?.replace(/^#+\s*/, "") || "No output";
    summary.rows = textLines.slice(1);
  }
  if (!action) {
    const urgent = textLines.filter(line => /^(?:## .* (?:Blocked|Paused|Uncertain|Unsupported|Conflict)\b|(?:- )?(?:Unavailable:|Error:|Reason:|Effect:|.*[Cc]ancel(?:l)?ed\b))/.test(line));
    const warnings = textLines.filter(line => /^(?:- )?(?:Warning:|Merge-link identity:|Xlink effects:)|^\[.*truncat/.test(line));
    notices.unshift(...urgent.map(line => line.replace(/^#+\s*/, "")));
    notices.push(...warnings);
  }
  if (data.truncated === true || data.outputTruncated === true) notices.push("Output truncated by the tool.");
  const limited = data.truncated === true || data.outputTruncated === true || envelope.truncated === true
    || Boolean(count(record(data.itemCount).omitted) || count(data.omittedOutcomes) || count(data.skippedByLimit))
    || records(data.outcomes).some(item => item.truncated === true);
  if (limited) summary.label += `${separator}partial output`;
  for (const state of [record(data.mergeState), record(data.mergeStateAfterMerge), record(data.mergeStateAfterFinalize)]) {
    if (state.hasMergeInProgress === true) notices.unshift("Merge still in progress; finalization may be required.");
    const links = strings(state.pendingMergeLinks).length;
    if (links) notices.push(`${links} pending merge links.`);
  }
  if (data.usedNoChangesRecovery === true) notices.unshift("Checkin used clean-workspace recovery; inspect original evidence.");
  if (typeof envelope.nextSuggestedAction === "string") notices.push(envelope.nextSuggestedAction);
  if (notices.length && summary.tone !== "error") summary.tone = "warning";
  return summary;
}

function evidence(text: string, theme: RenderTheme): string {
  return safe(text).split("\n").map(line => {
    const color = line.startsWith("+") ? "toolDiffAdded" : line.startsWith("-") ? "toolDiffRemoved" : line.startsWith("@@") ? "accent" : "toolOutput";
    return theme.fg(color, line);
  }).join("\n");
}

export function renderPlasticResult(name: string, result: Result, options: Options, theme: RenderTheme, context?: Context): Text {
  const raw = body(result);
  if (options.isPartial) return reuse(context, theme.fg("warning", `Running${separator}${compact(raw || titles[name] || name)}`));
  const summary = summarize(name, result, raw, context);
  const symbol = summary.tone === "success" ? "\u2713" : summary.tone === "error" ? "\u2717" : summary.tone === "warning" ? "!" : "\u2022";
  let text = theme.fg(summary.tone, `${symbol} ${compact(summary.label, 220)}`);
  const notices = [...new Set(summary.notices)];
  for (const notice of notices.slice(0, options.expanded ? notices.length : 2)) text += `\n${theme.fg("warning", options.expanded ? safe(notice) : compact(notice))}`;
  if (!options.expanded) {
    if (notices.length > 2) text += `\n${theme.fg("dim", `${notices.length - 2} more notices`)}`;
    for (const row of summary.rows.slice(0, 2)) text += `\n${theme.fg(summary.tone === "error" ? "error" : "muted", compact(row))}`;
    if (summary.rows.length > 2) text += `\n${theme.fg("dim", `${summary.rows.length - 2} more rows`)}`;
    if (raw) text += `\n${theme.fg("dim", keyHint("app.tools.expand", "details"))}`;
  } else {
    const section = (title: string, value: string) => { if (value) text += `\n\n${theme.fg("toolTitle", theme.bold(title))}\n${value}`; };
    const args = record(context?.args);
    const workdir = scalar(record(result.details).workdir) || scalar(args.workdir) || context?.cwd;
    if (workdir && name !== "mergeBranches" && name !== "tool_search") section("Workspace", theme.fg("muted", safe(workdir)));
    if (Object.keys(args).length) section("Request", theme.fg("muted", safe(JSON.stringify(args, null, 2))));
    const envelope = payload(result, raw);
    const data = record(envelope.data);
    if (typeof data.diff === "string") section("Diff", evidence(data.diff, theme));
    for (const item of records(data.outcomes)) {
      if (typeof item.diff === "string") section(safe(scalar(item.path)), evidence(item.diff, theme));
    }
    if (name === "patch" && typeof envelope.content === "string") section("Patch", evidence(envelope.content, theme));
    // Keep original content, including JSON numeric lexemes and duplicate keys, as the evidence.
    section("Evidence", evidence(raw, theme));
  }
  return reuse(context, text);
}

export function renderPlasticSearchResult(result: Result, options: Options, theme: RenderTheme, context?: Context): Text {
  if (options.isPartial || context?.isError) return renderPlasticResult("tool_search", result, options, theme, context);
  const details = record(result.details);
  const added = strings(details.added);
  const matches = strings(details.matches);
  const unavailable = strings(details.unavailableToolNames);
  if (!Array.isArray(details.matches)) return renderPlasticResult("tool_search", result, options, theme, context);
  const label = details.browse === true ? "Browse Plastic capabilities" : matches.length === 0 ? "No executable tools matched" : `${added.length} activated${separator}${strings(details.alreadyActive).length} already active`;
  const tone = details.browse === true ? "toolOutput" : unavailable.length || matches.length === 0 ? "warning" : "success";
  let text = theme.fg(tone, `${tone === "success" ? "\u2713" : tone === "warning" ? "!" : "\u2022"} ${label}`);
  if (unavailable.length) text += `\n${theme.fg("warning", compact(`Unavailable: ${unavailable.join(", ")}`))}`;
  for (const name of matches) text += `\n${theme.fg("accent", compact(name))}`;
  if (options.expanded) text += `\n\n${theme.fg("toolTitle", theme.bold("Guidance"))}\n${evidence(body(result), theme)}`;
  else text += `\n${theme.fg("dim", keyHint("app.tools.expand", "guidance"))}`;
  return reuse(context, text);
}
