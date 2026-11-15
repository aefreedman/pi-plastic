import { assembleCheckinReceipt } from "./checkin-receipt";
import { presentCheckinReceipt } from "../presentation/checkin-results";
import { tool } from "../tool-definition";
import { outputFormatArg } from "../presentation/results";
import { workdirArg } from "./arguments";

export const checkin = tool({
    description: "Check in pending changes with a required comment (cm checkin -c=...).",
    args: {
        message: tool.schema.string().min(1).describe("Changeset comment."),
        paths: tool.schema.array(tool.schema.string()).optional().describe("Optional paths to check in."),
        applyChanged: tool.schema.boolean().optional().describe("Include changed items not checked out."),
        includePrivate: tool.schema.boolean().optional().describe("Include private items."),
        includeAll: tool.schema.boolean().optional().describe("Include changed, moved, and deleted items."),
        updateAfter: tool.schema.boolean().optional().describe("Deprecated in unattended mode. Blocked because checkin --update can trigger interactive update-merge."),
        preflight: tool.schema.boolean().optional().describe("Zero-command plan; paths and options are passed unchanged to Plastic."),
        format: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args)
    {
        const dto = await assembleCheckinReceipt(args);
        if (!dto.ok) throw new Error(dto.error.message);
        return presentCheckinReceipt(dto, args.format);
    },
});
