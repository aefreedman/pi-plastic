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
    assert(pendingItems.length === 3, "Expected ambiguous legacy moved records to be skipped.");
    assert(pendingItems.some((item) => item.kind === "deleted"), "Expected at least one deleted pending item.");
    assert(!pendingItems.some((item) => item.kind === "moved"), "Expected ambiguous legacy moved records not to select a potentially wrong path.");
    assert(__plasticCheckinInternals.inferPendingItemKind("CO+RP") === "changed", "Expected CO+RP to classify as changed.");

    const separator = "\x1f";
    const separatedOutput = [
        `PR${separator}/repo/ws/Assets/True False private.txt${separator}False${separator}201${separator}NO_MERGES`,
        `AD${separator}/repo/ws/Assets/True False added.txt${separator}False${separator}202${separator}NO_MERGES`,
        `CH${separator}/repo/ws/Assets/True False changed.txt${separator}False${separator}203${separator}NO_MERGES`,
        `DE${separator}/repo/ws/Assets/True False deleted.txt${separator}False${separator}204${separator}NO_MERGES`,
        `MV${separator}100%${separator}/repo/ws/Assets/old True False moved.txt${separator}/repo/ws/Assets/moved destination True False.txt${separator}False${separator}205${separator}NO_MERGES`,
    ].join("\n");
    const separatedItems = __plasticCheckinInternals.parseMachineReadablePendingItems(separatedOutput, cwd);
    assert(separatedItems.length === 5, "Expected all separated PR/AD/CH/DE/MV records to parse.");
    assert(separatedItems.map((item) => item.kind).join(",") === "private,added,changed,deleted,moved", "Expected separated status records to retain their kinds.");
    assert(separatedItems.map((item) => item.revisionId).join(",") === "201,202,203,204,205", "Expected separated records to retain revision IDs.");
    const movedItem = separatedItems[4];
    assert(movedItem.workspacePath === "/repo/ws/Assets/moved destination True False.txt", "Expected moved records to use their destination as the current workspace path.");
    assert(movedItem.sourceWorkspacePath === "/repo/ws/Assets/old True False moved.txt", "Expected moved records to retain source metadata.");
    const separatedSummary = __plasticCheckinInternals.summarizePendingItems(separatedItems, cwd);
    assert(separatedSummary.moved === 1 && separatedSummary.tracked === 4, "Expected summary accounting to retain the separated moved destination record.");
    const movedDestinationScope = __plasticCheckinInternals.resolveCheckinPaths(["Assets/moved destination True False.txt"], separatedItems, cwd);
    assert(movedDestinationScope.includedPaths.length === 1 && pathMatches(movedDestinationScope.includedPaths[0], "Assets/moved destination True False.txt"), "Expected checkin scope to match a moved destination path.");
    assert(movedDestinationScope.shouldApplyChanged, "Expected moved destination scope to retain checkin --applychanged handling.");

    const pathTokenOutput = [
        "CH /repo/ws/Assets/True False changed.txt False 101 NO_MERGES",
        "AD /repo/ws/Assets/True False added.txt False 102 NO_MERGES",
        "MV /repo/ws/Assets/True False moved.txt False 103 NO_MERGES",
        "LD /repo/ws/Assets/True False deleted.txt False 104 NO_MERGES",
        "PR /repo/ws/Assets/True False private.txt False 105 NO_MERGES",
        "CH /repo/ws/Assets/True False directory True 106 NO_MERGES",
        "CH /repo/ws/missing-directory-flag 107",
        "ch /repo/ws/lowercase-status False 108",
        "CH  False 109",
    ].join("\n");
    const pathTokenItems = __plasticCheckinInternals.parseMachineReadablePendingItems(pathTokenOutput, cwd);
    assert(pathTokenItems.length === 5, "Expected malformed and ambiguous legacy moved records to be ignored.");
    for (const [index, [kind, revisionId]] of [["changed", "101"], ["added", "102"], ["deleted", "104"], ["private", "105"], ["changed", "106"]].entries())
    {
        const item = pathTokenItems[index];
        assert(item.workspacePath.includes("True False"), `Expected ${kind} path to preserve whitespace-delimited True/False filename tokens.`);
        assert(item.revisionId === revisionId, `Expected ${kind} status revision ID to be preserved.`);
        assert(item.kind === kind, `Expected ${kind} status to remain classified correctly.`);
    }
    assert(pathTokenItems[4].isDirectory, "Expected the rightmost True/False token to be parsed as the directory flag.");

    const pendingSummary = __plasticCheckinInternals.summarizePendingItems(pendingItems, cwd);
    assert(pendingSummary.totalPending === 3, "Expected pending summary total count to match parsed items.");
    assert(pendingSummary.tracked === 3, "Expected tracked count to equal total when no private items exist.");
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

    assert(__plasticCheckinInternals.isSameFilesystemDevice(100, 100), "Expected Darwin case probing to remain on the target filesystem device.");
    assert(!__plasticCheckinInternals.isSameFilesystemDevice(100, 200), "Expected Darwin case probing to stop before crossing a mount-device boundary.");

    const comparisonPath = "/Volumes/Workspace/Assets/Player.cs";
    const darwinInsensitiveKey = __plasticCheckinInternals.toPathComparisonKeyFromAbsolutePath(comparisonPath, {
        platform: "darwin",
        isDarwinCaseInsensitiveVolume: () => true,
    });
    const darwinSensitiveKey = __plasticCheckinInternals.toPathComparisonKeyFromAbsolutePath(comparisonPath, {
        platform: "darwin",
        isDarwinCaseInsensitiveVolume: () => false,
    });
    assert(darwinInsensitiveKey === comparisonPath.toLowerCase(), "Expected a detected case-insensitive Darwin volume to normalize comparison keys.");
    assert(darwinSensitiveKey === comparisonPath, "Expected a case-sensitive APFS volume to preserve comparison-key casing.");
    assert(__plasticCheckinInternals.toPathComparisonKeyFromAbsolutePath("C:/Workspace/Assets/Player.cs", {
        platform: "darwin",
        isDarwinCaseInsensitiveVolume: () => false,
    }) === "c:/workspace/assets/player.cs", "Expected Windows drive paths to remain case-insensitive on every host platform.");

    const gameplayScope = pendingItems.find((item) => item.workspacePath.endsWith("Movement.cs"))?.normalizedPath.replace(/\/Movement\.cs$/, "") ?? "";
    const scopedPendingItems = __plasticCheckinInternals.filterPendingItemsByScope(
        pendingItems,
        gameplayScope.length > 0 ? [gameplayScope] : [],
    );
    assert(scopedPendingItems.length === 2, "Expected scope-filter helper to return only pending items under the requested path.");

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
