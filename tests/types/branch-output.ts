import type { BranchOutput, CurrentBranchOutput, BranchExistsOutput } from "../../src/pi/branch-output";
function narrow(dto: BranchOutput): string | boolean {
  if (!dto.ok) {
    const code: string = dto.error.code;
    // @ts-expect-error Failure has no verified data.
    dto.data.exists;
    return code;
  }
  if (dto.action === "current-branch") {
    const branch: string = dto.data.branch;
    // @ts-expect-error Current branch has no existence value.
    dto.data.exists;
    // @ts-expect-error No arbitrary schema fields.
    dto.data.repository;
    return branch;
  }
  const exists: boolean = dto.data.exists;
  const scope: "workspace_repository" = dto.data.scope;
  const qualifier: false | undefined = dto.data.qualifierVerified;
  // @ts-expect-error Branch exists has deliberate requested/comparison identities, not observed current branch.
  dto.data.branch;
  return exists;
}
function specific(current: CurrentBranchOutput, exists: BranchExistsOutput) {
  if (current.ok) { const basis: "status" | "compact_status" | "changeset_lookup" = current.data.basis; }
  if (exists.ok) { const boolean: boolean = exists.data.exists; }
}
