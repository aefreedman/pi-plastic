/** Synthetic six-copy asset/sidecar shape. No retained historical producer bytes:
 * names, namespace, IDs and display values are invented. This exercises only the
 * already sourced DO_COPIED/APPLY ADD/CP profile, not replace/delete admission. */
export const copiedAddShape = {
    cwd: "C:\\Example\\workspace",
    source: "/main/source-café-😀",
    target: "/main/target",
    repository: "Example Repository",
    server: "example@unity",
    relativePaths: ["assets\\cards\\alpha.png", "assets\\cards\\alpha.png.meta", "assets\\cards\\beta.png", "assets\\cards\\beta.png.meta", "assets\\cards\\gamma.png", "assets\\cards\\gamma.png.meta"],
};
export const copiedAddPaths = copiedAddShape.relativePaths.map(p => copiedAddShape.cwd + "\\" + p);
export const copiedAddMachine = `STATUS\x1f16\x1f${copiedAddShape.repository}\x1f${copiedAddShape.server}\r\n` + copiedAddPaths.map((p, i) => `CP\x1f${p}\x1fFalse\x1f${680 + i}\x1fMerge from 27\r\n`).join("");
export const copiedAddStandard = `${copiedAddShape.target}@${copiedAddShape.repository}@${copiedAddShape.server} (cs:16 - head)\r\n\r\nPending merge links\r\n    Merge from cs:27 at ${copiedAddShape.source}@${copiedAddShape.repository}@${copiedAddShape.server}\r\n\r\nAdded\r\n    Status     Size     Last Modified     Path\r\n\r\n` + copiedAddShape.relativePaths.map(p => `    Copied (new) (Merge from 27)    44 bytes    Opaque time    ${p}\r\n`).join("");
export function copiedAddApply(frame: (op: string, ...fields: string[]) => string): string {
    // Keep the two sets separately ordered: correlation must not depend on adjacency.
    return copiedAddPaths.map(p => frame("DO_COPIED", p)).join("") + copiedAddShape.relativePaths.map(p => frame("APPLY", "ADD", "/" + p.replaceAll("\\", "/"))).join("");
}
