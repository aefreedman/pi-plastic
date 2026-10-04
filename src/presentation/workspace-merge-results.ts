import type { WorkspaceMergeReceipt } from "../domain/workspace-merge-contract";
export function presentWorkspaceMergeReceipt(dto:WorkspaceMergeReceipt):string {
 if(dto.data.outputFormatRequested==="json")return JSON.stringify(dto,null,2);
 const title=dto.action==="merge"?"Workspace Merge":"Merge Finalization";
 return dto.ok?dto.outcome==="preflight"?title+" command-only preview; no readiness analysis or command executed.\ncm "+dto.data.intendedArgv.join(" "):title+" command completed; admitted observations contain no unresolved signals. Conflict resolution/finalized metadata/preservation and complete affected scope remain unverified.":title+" "+dto.outcome+": "+dto.error.message+" Applying command completed: "+dto.data.commandCompleted+". No automatic retry, checkin, rollback or strategy change.";
}
