import { tool } from "../tool-definition";
import { outputFormatArg } from "../presentation/results";
import { workdirArg } from "./arguments";
import { assembleCloseoutReceipt, presentCloseoutReceipt } from "./closeout-receipt";
export const mergeToBranch = tool({
 description: "Merge a source branch into a target branch with a bounded typed stage ledger; unknown target/readiness stops before checkin and earlier effects remain recorded.",
 args: {
  source:tool.schema.string().optional().describe("Bounded hierarchical branch selector. Defaults to the directly observed loaded branch."),
  target:tool.schema.string().optional().describe("Bounded hierarchical branch selector. Defaults to an admitted source-parent read in the observed repository scope."),
  cardRef:tool.schema.string().optional().describe("Optional tracker reference in the default checkin message; derived message must meet existing checkin admission."),
  message:tool.schema.string().optional().describe("Optional checkin message. Defaults to Merge <source> into <target>. Existing child text bounds apply."),
  strategy:tool.schema.enum(["auto","source","destination"]).optional().describe("Conflict strategy; defaults to auto."),
  updateTarget:tool.schema.boolean().optional().describe("Update target before merge; defaults to true."),
  includePrivate:tool.schema.boolean().optional().describe("Include private items in merge checkin; defaults to false."),
  preflight:tool.schema.boolean().optional().describe("Read-only discovery/pending preview, not zero CLI or applying readiness proof."),
  format:outputFormatArg,workdir:workdirArg,
 },
 async execute(args){const dto=await assembleCloseoutReceipt(args);if(!dto.ok&&!args.preflight)throw Error(dto.error.message);return presentCloseoutReceipt(dto,args.format);},
});
