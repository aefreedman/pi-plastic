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

  const skillPath = new URL("../skills/using-plastic/SKILL.md", import.meta.url);
  const reviewingPath = new URL("../skills/using-plastic/references/reviewing-changes.md", import.meta.url);
  const changesetPath = new URL("../skills/using-plastic/references/changeset-operations.md", import.meta.url);
  const troubleshootingPath = new URL("../skills/using-plastic/references/troubleshooting.md", import.meta.url);
  const integrationPath = new URL("../skills/using-plastic/references/integration.md", import.meta.url);
  const bashGuardPath = new URL("../extensions/bash-cm-diff-guard.ts", import.meta.url);
  const bashMergeGuardPath = new URL("../extensions/bash-cm-merge-guard.ts", import.meta.url);

  failures += checkRequired(readText(new URL("../src/execution/cm.ts", import.meta.url)), "pi-plastic/src/execution/cm.ts", [
    "const BLOCKED_CM_DIFF_MESSAGE",
    "ensureCmCommandAllowed(args);",
    'command === "diff"',
  ]);
  failures += checkRequired(readText(new URL("../src/operations/merge.ts", import.meta.url)), "pi-plastic/src/operations/merge.ts", [
    "export const merge = tool({",
    "export const finalizeMerge = tool({",
    "--nointeractiveresolution",
    "--mergetype=try",
    "--automaticresolution=all-"
]);
  failures += checkRequired(readText(new URL("../src/operations/closeout.ts", import.meta.url)), "pi-plastic/src/operations/closeout.ts", [
    "export const mergeToBranch = tool({",
    "resolveBranchParentName",
  ]);
  failures += checkRequired(readText(new URL("../src/operations/patch.ts", import.meta.url)), "pi-plastic/src/operations/patch.ts", [
    "export const patch = tool({",
    "__plasticPatchInternals",
    "buildPatchCommandArgs"
]);
  failures += checkRequired(readText(new URL("../src/operations/diff.ts", import.meta.url)), "pi-plastic/src/operations/diff.ts", [
    "export const diffRevisions = tool({",
    "plastic_diff is disabled"
]);
  failures += checkRequired(readText(new URL("../src/operations/checkin.ts", import.meta.url)), "pi-plastic/src/operations/checkin.ts", [
    "parseMachineReadablePendingItems",
    "summarizePendingItems",
    "selectPrivatePathsForAutoAdd",
    "filterPendingItemsByScope",
    "isNoChangesWorkspaceCheckinError",
    "auto-add-private-retry-success",
    "resolveCheckinPaths",
    "buildFallbackScopePaths",
    "isMergeInProgressCheckinError",
    "buildMergeInProgressCheckinMessage",
    "updateAfter is disabled for unattended safety"
]);
  failures += checkRequired(readText(new URL("../src/operations/switch.ts", import.meta.url)), "pi-plastic/src/operations/switch.ts", [
    "__plasticSwitchInternals",
    "normalizeBranchSpecForComparison",
    "assertWorkspaceOnBranch",
    "isSwitchBringBlockedForUnattended",
    "canSwitchDirectWithPrivateOnlyPending",
    "direct-switch-private-only"
]);
  failures += checkRequired(readText(new URL("../src/operations/workspace.ts", import.meta.url)), "pi-plastic/src/operations/workspace.ts", [
    "export const resolveDeleteChangeConflict = tool({",
    "[\"update\", \"--dontmerge\", \"--noinput\"]"
]);
  for (const [owner, snippets] of [
    ["pending", ["SENSITIVE_PRIVATE_PATH_PATTERNS"]],
    ["branches", ["Plastic changesets remain on the branch where they were created"]],
    ["merge-output", ["FILE_CONFLICT"]],
  ] as const) {
    failures += checkRequired(readText(new URL(`../src/domain/${owner}.ts`, import.meta.url)), `pi-plastic/src/domain/${owner}.ts`, [...snippets]);
  }
  for (const owner of ["operations/merge", "operations/server-merge", "operations/closeout", "operations/checkin", "operations/switch", "operations/diff", "operations/patch", "operations/workspace"]) {
    failures += checkForbidden(readText(new URL(`../src/${owner}.ts`, import.meta.url)), `pi-plastic/src/${owner}.ts`, [
      /runCm\(\["diff"/,
      /runCmRaw\(\["diff"/,
      /runCm\(\["update"\]/,
    ]);
  }

  const skillText = readText(skillPath);
  failures += checkRequired(skillText, "pi-plastic/skills/using-plastic/SKILL.md", [
    "Never run `cm diff` in Pi.",
    "plastic_diffRevisions",
    "plastic_patch",
    "plastic_merge",
    "plastic_mergeToBranch",
  "source branch's Plastic parent branch",
    "not Git fast-forwards",
    "Switching to the target after a checkin on the source branch does not move or integrate that changeset",
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
    'pi.on("user_bash"',
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
