import { readFileSync } from "fs";

const pass = (msg: string): void => console.log(`PASS: ${msg}`);
const fail = (msg: string): void => console.log(`FAIL: ${msg}`);

const readText = (fileURL: URL): string => readFileSync(fileURL, "utf8");

const checkRequired = (contents: string, target: string, snippets: string[]): number => {
  let failures = 0;
  for (const snippet of snippets) {
    if (contents.includes(snippet)) {
      pass(`${target} contains: ${snippet}`);
    } else {
      fail(`${target} missing required snippet: ${snippet}`);
      failures += 1;
    }
  }
  return failures;
};

const checkForbidden = (contents: string, target: string, patterns: RegExp[]): number => {
  let failures = 0;
  for (const pattern of patterns) {
    if (pattern.test(contents)) {
      fail(`${target} matched forbidden pattern: ${pattern}`);
      failures += 1;
    } else {
      pass(`${target} does not match: ${pattern}`);
    }
  }
  return failures;
};

const main = (): void => {
  let failures = 0;

  const plasticPath = new URL("../src/plastic-core.ts", import.meta.url);
  const skillPath = new URL("../skills/using-plastic/SKILL.md", import.meta.url);
  const reviewingPath = new URL("../skills/using-plastic/references/reviewing-changes.md", import.meta.url);
  const changesetPath = new URL("../skills/using-plastic/references/changeset-operations.md", import.meta.url);
  const troubleshootingPath = new URL("../skills/using-plastic/references/troubleshooting.md", import.meta.url);
  const integrationPath = new URL("../skills/using-plastic/references/integration.md", import.meta.url);
  const bashGuardPath = new URL("../extensions/bash-cm-diff-guard.ts", import.meta.url);
  const bashMergeGuardPath = new URL("../extensions/bash-cm-merge-guard.ts", import.meta.url);

  const plasticText = readText(plasticPath);
  failures += checkRequired(plasticText, "pi-plastic/src/plastic-core.ts", [
    "const BLOCKED_CM_DIFF_MESSAGE",
    "ensureCmCommandAllowed(args);",
    'command === "diff"',
    "export const merge = tool({",
    "export const mergeToBranch = tool({",
    "export const finalizeMerge = tool({",
    "export const resolveDeleteChangeConflict = tool({",
    "export const patch = tool({",
    "__plasticPatchInternals",
    "buildPatchCommandArgs",
    "export const diffRevisions = tool({",
    "plastic_diff is disabled",
    "parseMachineReadablePendingItems",
    "summarizePendingItems",
    "selectPrivatePathsForAutoAdd",
    "filterPendingItemsByScope",
    "isNoChangesWorkspaceCheckinError",
    "SENSITIVE_PRIVATE_PATH_PATTERNS",
    "auto-add-private-retry-success",
    "__plasticSwitchInternals",
    "normalizeBranchSpecForComparison",
    "isSwitchBringBlockedForUnattended",
    "canSwitchDirectWithPrivateOnlyPending",
    "direct-switch-private-only",
    "resolveCheckinPaths",
    "buildFallbackScopePaths",
    "--nointeractiveresolution",
    "--mergetype=try",
    "--automaticresolution=all-",
    "FILE_CONFLICT",
    "isMergeInProgressCheckinError",
    "buildMergeInProgressCheckinMessage",
    "updateAfter is disabled for unattended safety",
    '["update", "--dontmerge", "--noinput"]',
  ]);
  failures += checkForbidden(plasticText, "pi-plastic/src/plastic-core.ts", [
    /runCm\(\["diff"/,
    /runCmRaw\(\["diff"/,
    /runCm\(\["update"\]/,
  ]);

  const skillText = readText(skillPath);
  failures += checkRequired(skillText, "pi-plastic/skills/using-plastic/SKILL.md", [
    "Never run `cm diff` in Pi.",
    "plastic_diffRevisions",
    "plastic_patch",
    "plastic_merge",
    "plastic_mergeToBranch",
  ]);
  failures += checkForbidden(skillText, "pi-plastic/skills/using-plastic/SKILL.md", [
    /^\s*-\s+plastic_diff\s*$/m,
  ]);

  const refs = [
    ["reviewing-changes.md", readText(reviewingPath)],
    ["changeset-operations.md", readText(changesetPath)],
    ["troubleshooting.md", readText(troubleshootingPath)],
    ["integration.md", readText(integrationPath)],
  ] as const;

  for (const [name, text] of refs) {
    failures += checkForbidden(text, `pi-plastic/skills/using-plastic/references/${name}`, [
      /cm diff\s+br:/,
      /cm diff\s+cs:/,
      /cm diff\s+lb:/,
      /cm diff\s+sh:/,
      /cm diff\s+rev:/,
      /plastic_diff\(source=/,
      /list changed files/i,
    ]);
  }

  const bashGuardText = readText(bashGuardPath);
  failures += checkRequired(bashGuardText, "pi-plastic/extensions/bash-cm-diff-guard.ts", [
    'pi.on("tool_call"',
    "isBashToolCall",
    "commandRunsCmDiff",
    "__bashCmDiffGuardInternals",
    "block: true",
    "reason: BLOCK_MESSAGE",
  ]);

  const bashMergeGuardText = readText(bashMergeGuardPath);
  failures += checkRequired(bashMergeGuardText, "pi-plastic/extensions/bash-cm-merge-guard.ts", [
    'pi.on("tool_call"',
    "isBashToolCall",
    "commandRunsUnsafeCmMerge",
    "__bashCmMergeGuardInternals",
    "plastic_resolveDeleteChangeConflict",
    "--nointeractiveresolution",
    "--mergetype=try",
    "block: true",
    "reason: BLOCK_MESSAGE",
  ]);

  if (failures > 0) {
    console.log(`FAIL: plastic validation failed with ${failures} issue(s)`);
    process.exit(1);
  }

  console.log("PASS: plastic validation succeeded");
};

main();
