import type { BranchListOutput } from "../../src/pi/branch-list-output";
function narrow(dto: BranchListOutput): number | string | null {
    if (!dto.ok) {
        const code: string = dto.error.code;
        // @ts-expect-error Failure has no reusable rows.
        dto.data.rows;
        return code;
    }
    if (dto.data.mode === "native") {
        const rows: null = dto.data.rows;
        const counts: null = dto.data.counts;
        // @ts-expect-error Native observations have no normalized branch array.
        dto.data.rows[0].branch;
        return rows;
    }
    const branch: string | undefined = dto.data.rows[0]?.branch;
    const observed: number = dto.data.counts.observed;
    const excluded: 0 = dto.data.counts.excluded;
    const scope: "workspace_repository" = dto.data.scope;
    const qualifier: false = dto.data.qualifierVerified;
    // @ts-expect-error No repository-wide exhaustion claim.
    dto.data.exhausted;
    // @ts-expect-error No opaque producer fields.
    dto.data.repository;
    return observed;
}
