import { tool } from "../tool-definition";
import { outputFormatArg } from "../presentation/results";
import { workdirArg } from "./arguments";
import { assembleWorkspaceMergeReceipt } from "./workspace-merge-receipt";
import { presentWorkspaceMergeReceipt } from "../presentation/workspace-merge-results";
export type MergeConflictStrategy = "auto" | "source" | "destination";
export const merge = tool({
 description:"Request one non-interactive workspace merge with an explicit strategy; command completion is not conflict resolution or checkin readiness.",
 args:{
 source:tool.schema.string().min(1).describe("Exact branch/changeset/label/shelveset source operand; not CLI options."),
 strategy:tool.schema.enum(["auto","source","destination"]).optional().describe("Default auto/try; source/destination explicitly force contributor preference."),
 cherrypicking:tool.schema.boolean().optional().describe("Request cherry-picking mode."),
 forced:tool.schema.boolean().optional().describe("Request connected-branch-check override where CM supports it."),
 preflight:tool.schema.boolean().optional().describe("Zero-command plan only, not conflict/readiness analysis."),
 format:outputFormatArg,workdir:workdirArg},
 async execute(args){const dto=await assembleWorkspaceMergeReceipt("merge",args);if(!dto.ok)throw new Error(presentWorkspaceMergeReceipt({...dto,data:{...dto.data,outputFormatRequested:"text"}}));return presentWorkspaceMergeReceipt(dto);}
});
export const finalizeMerge = tool({
 description:"Request non-interactive merge finalization with an explicit contributor policy; not a guarantee of finalized metadata or preserved manual edits.",
 args:{
 source:tool.schema.string().min(1).describe("Exact original merge source operand; not CLI options."),
 strategy:tool.schema.enum(["source","destination"]).optional().describe("Default destination; contributor preference is not a manual-edit preservation guarantee."),
 preflight:tool.schema.boolean().optional().describe("Zero-command finalization plan only, not readiness analysis."),
 format:outputFormatArg,workdir:workdirArg},
 async execute(args){const dto=await assembleWorkspaceMergeReceipt("finalize-merge",args);if(!dto.ok)throw new Error(presentWorkspaceMergeReceipt({...dto,data:{...dto.data,outputFormatRequested:"text"}}));return presentWorkspaceMergeReceipt(dto);}
});
