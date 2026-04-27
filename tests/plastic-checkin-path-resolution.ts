import { __plasticCheckinInternals, __plasticSwitchInternals } from "../src/plastic-core.ts";

const assert = (condition: boolean, message: string): void =>
{
    if (!condition)
    {
        throw new Error(message);
    }
};

const normalizePath = (pathValue: string): string => pathValue.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
const pathMatches = (actualPath: string, expectedPath: string): boolean =>
{
    const actual = normalizePath(actualPath);
    const expected = normalizePath(expectedPath);
    return actual === expected || actual.endsWith(`/${expected}`);
};

const main = (): void =>
{
    const cwd = "/repo/ws";
    const machineOutput = [
        "STATUS 123 Normandie/Repo server",
        "CH /repo/ws/Assets/Gameplay/Movement.cs False NO_MERGES",
        "LD /repo/ws/Assets/Gameplay/FakeModifierService.cs False NO_MERGES",
        "MV /repo/ws/Assets/Gameplay/MockModifierService.cs False NO_MERGES",
        "CH /repo/ws/ProjectSettings/ProjectSettings.asset False NO_MERGES",
    ].join("\n");

    const pendingItems = __plasticCheckinInternals.parseMachineReadablePendingItems(machineOutput, cwd);
    assert(pendingItems.length === 4, "Expected parser to return four pending items.");
    assert(pendingItems.some((item) => item.kind === "deleted"), "Expected at least one deleted pending item.");
    assert(pendingItems.some((item) => item.kind === "moved"), "Expected at least one moved pending item.");
    assert(__plasticCheckinInternals.inferPendingItemKind("CO+RP") === "changed", "Expected CO+RP to classify as changed.");

    const pendingSummary = __plasticCheckinInternals.summarizePendingItems(pendingItems, cwd);
    assert(pendingSummary.totalPending === 4, "Expected pending summary total count to match parsed items.");
    assert(pendingSummary.tracked === 4, "Expected tracked count to equal total when no private items exist.");
    assert(pendingSummary.private === 0, "Expected no private items in initial sample summary.");

    const changedOnly = __plasticCheckinInternals.resolveCheckinPaths([
        "Assets/Gameplay/Movement.cs",
    ], pendingItems, cwd);
    assert(changedOnly.includedPaths.length === 1, "Expected one included path for changed file scope.");
    assert(pathMatches(changedOnly.includedPaths[0], "Assets/Gameplay/Movement.cs"), "Expected changed file path to be preserved.");
    assert(changedOnly.shouldApplyChanged === false, "Expected changed-only scope to avoid auto --applychanged.");

    const deletedOnly = __plasticCheckinInternals.resolveCheckinPaths([
        "Assets/Gameplay/FakeModifierService.cs",
    ], pendingItems, cwd);
    assert(deletedOnly.includedPaths.length === 1, "Expected one included path for deleted file scope.");
    assert(pathMatches(deletedOnly.includedPaths[0], "Assets/Gameplay/FakeModifierService.cs"), "Expected deleted-file scope to preserve the requested path before fallback retry.");
    assert(deletedOnly.shouldApplyChanged, "Expected deleted-file scope to enable --applychanged.");
    assert(deletedOnly.fallbackPaths.length === 1 && pathMatches(deletedOnly.fallbackPaths[0], "Assets/Gameplay"),
           "Expected deleted-file fallback scope to target the parent directory.");

    const directoryScope = __plasticCheckinInternals.resolveCheckinPaths([
        "Assets/Gameplay",
    ], pendingItems, cwd);
    assert(directoryScope.includedPaths.length === 1, "Expected one included path for directory scope.");
    assert(pathMatches(directoryScope.includedPaths[0], "Assets/Gameplay"), "Expected directory scope to remain stable.");
    assert(directoryScope.shouldApplyChanged, "Expected directory scope with deleted/moved items to enable --applychanged.");

    const noMatch = __plasticCheckinInternals.resolveCheckinPaths([
        "Assets/UI/Nope.cs",
    ], pendingItems, cwd);
    assert(noMatch.includedPaths.length === 0, "Expected no included paths for unmatched scope.");
    assert(noMatch.excludedPaths.length === 1, "Expected one excluded path for unmatched scope.");
    assert(noMatch.excludedPaths[0].reason === "no_pending_changes", "Expected unmatched scope reason to be no_pending_changes.");

    const windowsCwd = "C:/Workspaces/GameProject/ws3";
    const windowsMachineOutput = [
        "STATUS 1147 ExampleRepo/game-unity example@server",
        "CH c:/Workspaces/GameProject/ws3/game-unity/Assets/Game/code/Runtime/Paths.cs False NO_MERGES",
        "CH c:/Workspaces/GameProject/ws3/game-unity/Assets/Game/code/Editor/Validation/MapGraphValidationBatchTools.cs False NO_MERGES",
    ].join("\n");
    const windowsPendingItems = __plasticCheckinInternals.parseMachineReadablePendingItems(windowsMachineOutput, windowsCwd);
    assert(windowsPendingItems.length === 2, "Expected Windows parser sample to return two pending items.");

    const windowsRelativeScope = __plasticCheckinInternals.resolveCheckinPaths([
        "game-unity/Assets/Game/code/Runtime/Paths.cs",
    ], windowsPendingItems, windowsCwd);
    assert(windowsRelativeScope.includedPaths.length === 1, "Expected Windows relative scope to match pending file despite drive-letter case mismatch.");
    assert(pathMatches(windowsRelativeScope.includedPaths[0], "game-unity/Assets/Game/code/Runtime/Paths.cs"), "Expected Windows relative scope to keep workspace-relative command path.");

    const windowsAbsoluteScope = __plasticCheckinInternals.resolveCheckinPaths([
        "C:/Workspaces/GameProject/ws3/game-unity/Assets/Game/code/Runtime/Paths.cs",
    ], windowsPendingItems, windowsCwd);
    assert(windowsAbsoluteScope.includedPaths.length === 1, "Expected Windows absolute scope to match pending file despite drive-letter case mismatch.");
    assert(pathMatches(windowsAbsoluteScope.includedPaths[0], "game-unity/Assets/Game/code/Runtime/Paths.cs"), "Expected Windows absolute scope to collapse back to workspace-relative command path.");

    const windowsDirectoryScope = __plasticCheckinInternals.resolveCheckinPaths([
        "GAME-UNITY/Assets/Game/code/Editor",
    ], windowsPendingItems, windowsCwd);
    assert(windowsDirectoryScope.includedPaths.length === 1, "Expected Windows directory scope to match pending children despite path case differences.");
    assert(pathMatches(windowsDirectoryScope.includedPaths[0], "GAME-UNITY/Assets/Game/code/Editor"), "Expected Windows directory scope to preserve the requested command path casing.");

    const windowsDuplicateScope = __plasticCheckinInternals.resolveCheckinPaths([
        "GAME-UNITY/Assets/Game/code/Runtime/Paths.cs",
        "game-unity/Assets/Game/code/Runtime/Paths.cs",
    ], windowsPendingItems, windowsCwd);
    assert(windowsDuplicateScope.includedPaths.length === 1, "Expected Windows duplicate scopes that differ only by case to dedupe to one command path.");

    const gameplayScope = pendingItems.find((item) => item.workspacePath.endsWith("Movement.cs"))?.normalizedPath.replace(/\/Movement\.cs$/, "") ?? "";
    const scopedPendingItems = __plasticCheckinInternals.filterPendingItemsByScope(
        pendingItems,
        gameplayScope.length > 0 ? [gameplayScope] : [],
    );
    assert(scopedPendingItems.length === 3, "Expected scope-filter helper to return only pending items under the requested path.");

    const fallbackPaths = __plasticCheckinInternals.buildFallbackScopePaths([
        "/repo/ws/Assets/Gameplay/Movement.cs",
        "/repo/ws/Assets/Gameplay/FakeModifierService.cs",
    ], cwd);
    assert(fallbackPaths.length === 1 && pathMatches(fallbackPaths[0], "Assets/Gameplay"), "Expected fallback paths to collapse to the common parent scope.");

    const normalizedDiffRevision = __plasticCheckinInternals.normalizeDiffFileRevisionSpec(
        "Assets/Gameplay/Movement.cs",
        "cs:947",
    );
    assert(normalizedDiffRevision === "Assets/Gameplay/Movement.cs#cs:947", "Expected diff-file revision shorthand to be expanded with path scope.");

    const numericDiffRevision = __plasticCheckinInternals.normalizeDiffFileRevisionSpec(
        "Assets/Gameplay/Movement.cs",
        "947",
    );
    assert(numericDiffRevision === "Assets/Gameplay/Movement.cs#cs:947", "Expected numeric diff-file revision shorthand to normalize to cs: selector.");

    const scopedRevision = __plasticCheckinInternals.normalizeDiffFileRevisionSpec(
        "Assets/Gameplay/Movement.cs",
        "Assets/Gameplay/Movement.cs#cs:947",
    );
    assert(scopedRevision === "Assets/Gameplay/Movement.cs#cs:947", "Expected already scoped revision to remain unchanged.");

    assert(__plasticCheckinInternals.isUnscopedDiffRevisionSpec("cs:947"), "Expected cs selector without file scope to be detected as unscoped.");
    assert(__plasticCheckinInternals.isUnscopedDiffRevisionSpec("947"), "Expected numeric selector without file scope to be detected as unscoped.");
    assert(!__plasticCheckinInternals.isUnscopedDiffRevisionSpec("Assets/Gameplay/Movement.cs#cs:947"), "Expected file-qualified selector not to be treated as unscoped.");

    assert(__plasticCheckinInternals.isGitUnknownOptionLabelError("error: unknown option `label'"), "Expected backtick-style git unknown-option error to be detected.");
    assert(__plasticCheckinInternals.isGitUnknownOptionLabelError("error: unknown option 'label'"), "Expected single-quote-style git unknown-option error to be detected.");
    assert(!__plasticCheckinInternals.isGitUnknownOptionLabelError("fatal: unrelated error"), "Expected unrelated git errors not to match label-option detector.");

    assert(__plasticCheckinInternals.isRevisionNotFoundError("The specified revision was not found foo#cs:1"), "Expected revision-not-found detector to match Plastic cat errors.");
    assert(!__plasticCheckinInternals.isRevisionNotFoundError("fatal: unrelated error"), "Expected unrelated errors not to match revision-not-found detector.");

    const branchSelectorFromRevision = __plasticCheckinInternals.extractBranchSelectorFromRevision("Assets/Gameplay/Movement.cs#br:/dev/task-123");
    assert(branchSelectorFromRevision === "br:/dev/task-123", "Expected branch selector extraction from file-qualified revision.");
    assert(__plasticCheckinInternals.extractBranchSelectorFromRevision("Assets/Gameplay/Movement.cs#cs:947") === null, "Expected no branch selector extraction for non-branch revisions.");

    const branchName = __plasticCheckinInternals.extractBranchNameFromSelector("br:/dev/task-123@Repo@server");
    assert(branchName === "/dev/task-123", "Expected branch selector repository suffix to be removed.");
    assert(__plasticCheckinInternals.extractBranchNameFromSelector("br:") === null, "Expected invalid branch selector to return null branch name.");

    assert(__plasticSwitchInternals.normalizeBranchSpecForComparison("br:/dev/task-123@Repo@server") === "/dev/task-123", "Expected switch branch normalization to remove br: prefix and repository suffix.");
    assert(__plasticSwitchInternals.isSameBranchSpec("/dev/task-123", "br:/dev/task-123@Repo@server"), "Expected branch comparison helper to treat equivalent branch specs as equal.");
    assert(!__plasticSwitchInternals.isSameBranchSpec("/dev/task-123", "/dev/task-124"), "Expected branch comparison helper to detect different branches.");

    const machineOutputWithPrivate = [
        "STATUS 123 Normandie/Repo server",
        "PR /repo/ws/todos/059-ready.md False NO_MERGES",
        "PR /repo/ws/.env.local False NO_MERGES",
        "PR /repo/ws/src/id_rsa False NO_MERGES",
    ].join("\n");
    const pendingItemsWithPrivate = __plasticCheckinInternals.parseMachineReadablePendingItems(machineOutputWithPrivate, cwd);
    const privateSummary = __plasticCheckinInternals.summarizePendingItems(pendingItemsWithPrivate, cwd);
    assert(privateSummary.private === 3, "Expected private summary to count private pending items.");
    assert(privateSummary.tracked === 0, "Expected tracked count to be zero for private-only sample.");
    assert(privateSummary.privatePaths.some((path) => pathMatches(path, "todos/059-ready.md")), "Expected summary private paths to include the expected markdown file.");

    const privateOnlyProfile = __plasticSwitchInternals.buildSwitchPendingProfile(privateSummary);
    assert(privateOnlyProfile.hasPrivateOnlyPendingChanges, "Expected switch pending profile to classify private-only pending state.");
    assert(__plasticSwitchInternals.canSwitchDirectWithPrivateOnlyPending("bring", false, privateOnlyProfile), "Expected private-only bring policy to allow direct unattended switch.");
    assert(__plasticSwitchInternals.canSwitchDirectWithPrivateOnlyPending("shelve", false, privateOnlyProfile), "Expected private-only shelve policy to allow direct unattended switch.");
    assert(__plasticSwitchInternals.canSwitchDirectWithPrivateOnlyPending("cancel", true, privateOnlyProfile), "Expected defaulted cancel policy to allow direct private-only switch.");
    assert(!__plasticSwitchInternals.canSwitchDirectWithPrivateOnlyPending("cancel", false, privateOnlyProfile), "Expected explicit cancel policy to keep private-only switch blocked.");

    assert(__plasticCheckinInternals.getSensitivePrivatePathReason(".env.local") === "sensitive_path:dotenv", "Expected dotenv path to be blocked as sensitive.");
    assert(__plasticCheckinInternals.getSensitivePrivatePathReason("src/id_rsa") === "sensitive_path:ssh-key", "Expected SSH key path to be blocked as sensitive.");
    assert(__plasticCheckinInternals.getSensitivePrivatePathReason("todos/059-ready.md") === null, "Expected normal markdown path not to be blocked as sensitive.");

    const autoAddSelection = __plasticCheckinInternals.selectPrivatePathsForAutoAdd(pendingItemsWithPrivate, [], cwd);
    assert(autoAddSelection.candidatePaths.length === 1, "Expected one safe private auto-add candidate.");
    assert(pathMatches(autoAddSelection.candidatePaths[0], "todos/059-ready.md"), "Expected private auto-add candidate to keep relative file path.");
    assert(autoAddSelection.blockedPaths.length === 2, "Expected two sensitive private paths to be blocked from auto-add.");

    const trackedPendingProfile = __plasticSwitchInternals.buildSwitchPendingProfile(pendingSummary);
    assert(__plasticSwitchInternals.isSwitchBringBlockedForUnattended("bring", trackedPendingProfile), "Expected bring policy to be blocked when tracked pending changes exist.");
    assert(!__plasticSwitchInternals.isSwitchBringBlockedForUnattended("bring", privateOnlyProfile), "Expected bring policy not to be blocked for private-only pending changes.");

    const legacyPendingSummary = __plasticSwitchInternals.toLegacyPendingSummary(privateSummary);
    assert(legacyPendingSummary.totalPending === privateSummary.totalPending, "Expected legacy pending summary total count to match detailed summary.");
    assert(legacyPendingSummary.other >= privateSummary.private, "Expected legacy pending summary to account for private items in other count.");

    assert(__plasticCheckinInternals.isNoChangesWorkspaceCheckinError("Error: There are no changes in the workspace c:/repo/ws"), "Expected no-changes detector to match workspace no-changes errors.");
    assert(!__plasticCheckinInternals.isNoChangesWorkspaceCheckinError("Error: path is not changed in current workspace"), "Expected no-changes detector not to match path-scope errors.");

    console.log("PASS: plastic checkin path resolution tests passed");
};

main();
