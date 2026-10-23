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
 strategy:tool.schema.enum(["auto","source","destination"]).optional().describe("Default auto uses CM 11.0.16.10512+ native conflict markers without GUI; marker absence is not all-conflict readiness. source/destination explicitly force contributor preference."),
 cherrypicking:tool.schema.boolean().optional().describe("Request cherry-picking mode."),
 forced:tool.schema.boolean().optional().describe("Request connected-branch-check override where CM supports it."),
 preflight:tool.schema.boolean().optional().describe("Zero-command plan only, not conflict/readiness analysis."),
 format:outputFormatArg,workdir:workdirArg},
 async execute(args){const dto=await assembleWorkspaceMergeReceipt("merge",args);if(!dto.ok)throw new Error(presentWorkspaceMergeReceipt({...dto,data:{...dto.data,outputFormatRequested:"text"}}));return presentWorkspaceMergeReceipt(dto);}
});
