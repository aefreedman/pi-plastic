import { promises as fs } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export type Found<T> = { kind: "found"; value: T };
export type ParseOutcome<T> = Found<T> | { kind: "not_found" } | { kind: "malformed"; reason: string };
export type WorkspaceDiscoveryOutcome =
  | Found<{ root: string; plasticDir: string; markerPath: string }>
  | { kind: "not_found" }
  | { kind: "unavailable"; reason: string };

export type PlasticSelector = {
  branch: string;
  repository?: string;
};

export type PlasticStatusBranch = {
  branch?: string;
  changesetId?: string;
};

type WorkspaceFileSystem = {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean }>;
};

const defaultWorkspaceFileSystem: WorkspaceFileSystem = {
  realpath: (path) => fs.realpath(path),
  stat: (path) => fs.stat(path),
};

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Find the nearest enclosing Plastic workspace using only the documented marker. */
export async function discoverPlasticWorkspace(
  cwd: string,
  fileSystem: WorkspaceFileSystem = defaultWorkspaceFileSystem,
): Promise<WorkspaceDiscoveryOutcome> {
  let current: string;
  try {
    current = await fileSystem.realpath(resolve(cwd));
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  while (true) {
    const plasticDir = join(current, ".plastic");
    const markerPath = join(plasticDir, "plastic.workspace");
    try {
      if ((await fileSystem.stat(markerPath)).isFile()) {
        return { kind: "found", value: { root: current, plasticDir, markerPath } };
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        return {
          kind: "unavailable",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return { kind: "not_found" };
    current = parent;
  }
}

const parseSelectorValue = (line: string, key: string): string | undefined => {
  const match = line.match(new RegExp(`^\\s*${key}\\s+(.*?)\\s*$`, "i"));
  if (!match) return undefined;
  const value = match[1].replace(/^(["'])(.*)\1$/, "$2").trim();
  return value;
};

/** Parse the local selector without treating it as proof that a workspace exists. */
export function parsePlasticSelector(content: string): ParseOutcome<PlasticSelector> {
  let repository: string | undefined;
  let branch: string | undefined;
  let sawBranchKey = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(line)) continue;
    if (/^\s*repository(?:\s|$)/i.test(line)) repository = parseSelectorValue(line, "repository");
    if (/^\s*smartbranch(?:\s|$)/i.test(line)) {
      sawBranchKey = true;
      branch = parseSelectorValue(line, "smartbranch");
    }
  }

  if (!sawBranchKey) return { kind: "not_found" };
  if (!branch || /[\u0000-\u001f\u007f]/.test(branch)) {
    return { kind: "malformed", reason: "Selector smartbranch is blank or contains control characters." };
  }

  return {
    kind: "found",
    value: { branch, ...(repository ? { repository } : {}) },
  };
}

const nonEmptyLines = (output: string): string[] => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

const normalizeStatusBranch = (branch: string): string =>
  branch.trim().replace(/^br:/i, "").replace(/@[^@\s)]+(?:@[^@\s)]+)*$/, "");

/** Parse normal or compact `cm status` output into an unqualified branch path. */
export function parsePlasticStatusBranch(output: string): ParseOutcome<PlasticStatusBranch> {
  const lines = nonEmptyLines(output);
  if (lines.length === 0) return { kind: "not_found" };

  const workspaceMatch = lines[0].match(/^([^@\s]+)@/);
  if (workspaceMatch) return { kind: "found", value: { branch: normalizeStatusBranch(workspaceMatch[1]) } };

  for (const line of lines) {
    const branchSpec = line.match(/\bbr:[^\s)]+/i);
    if (branchSpec) return { kind: "found", value: { branch: normalizeStatusBranch(branchSpec[0]) } };

    const branchLine = line.match(/^branch\s*[:=]\s*(.+)$/i);
    if (branchLine?.[1]?.trim()) return { kind: "found", value: { branch: normalizeStatusBranch(branchLine[1]) } };
  }

  const changeset = output.match(/\bcs:(\d+)/i);
  if (changeset) return { kind: "found", value: { changesetId: changeset[1] } };

  return { kind: "malformed", reason: "Status output contains no recognized branch or changeset." };
}

const isCombining = (codePoint: number): boolean =>
  (codePoint >= 0x0300 && codePoint <= 0x036f)
  || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
  || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
  || (codePoint >= 0xfe20 && codePoint <= 0xfe2f);

const isWide = (codePoint: number): boolean =>
  codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );

export function sanitizePlasticBranch(branch: string, maxColumns = 80): string {
  const clean = branch.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (maxColumns <= 0) return "";

  let width = 0;
  let result = "";
  let truncated = false;
  for (const character of clean) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterWidth = isCombining(codePoint) ? 0 : isWide(codePoint) ? 2 : 1;
    if (width + characterWidth > maxColumns) {
      truncated = true;
      break;
    }
    result += character;
    width += characterWidth;
  }

  if (!truncated) return result;
  while (result && width > maxColumns - 1) {
    const character = Array.from(result).pop()!;
    result = Array.from(result).slice(0, -1).join("");
    const codePoint = character.codePointAt(0) ?? 0;
    width -= isCombining(codePoint) ? 0 : isWide(codePoint) ? 2 : 1;
  }
  return `${result}…`;
}
