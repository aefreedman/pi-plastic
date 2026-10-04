import type { BranchDeleteReceipt } from "../domain/branch-delete-contract";
export function presentBranchDeleteReceipt(dto:BranchDeleteReceipt):string {
 if(dto.data.outputFormatRequested==="json")return JSON.stringify(dto);
 if(!dto.ok)return `Branch deletion ${dto.outcome}: ${dto.error.message} Effects: ${dto.data.effect}. Do not retry automatically.`;
 if(dto.outcome==="preflight")return `Branch-delete command-only preview (not executed): ${JSON.stringify(dto.data.intendedArgv)}. No branch existence, permissions or deletion readiness analysis.`;
 return "Branch-delete command completed. Deleted branch identity, changeset-history effects, repository/workspace scope and rollback remain unverified.";
}
