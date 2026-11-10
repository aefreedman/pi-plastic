import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { assemblePatchReceipt, presentPatchReceipt } from "./patch-receipt";
export { __plasticPatchInternals } from "./patch-support";

export const patch = tool({
    description: "Generate a native git-diff-format Plastic SCM review patch (generation only); branch selectors are qualified to the current workspace repository and requested outputs publish atomically without overwrite (cm patch).",
    args: {
        source: tool.schema.string().min(1).describe("Source changeset or branch spec. Unqualified br:/ selectors are qualified only from the exact current workspace repository."),
        destination: tool.schema.string().optional().describe("Optional second changeset or branch spec for two-spec patch generation."),
        output: tool.schema.string().optional().describe("Optional new output file path. The package stages then atomically publishes it and refuses any existing path. If omitted, patch content is returned."),
        includeBinaries: tool.schema.boolean().optional().describe("Include changed binary content as raw byte hunks. Default false lists changed binary files only; non-UTF8 artifacts return metadata rather than decoded content."),
        clean: tool.schema.boolean().optional().describe("Exclude content that arrived via merges and include only direct checkins."),
        integration: tool.schema.boolean().optional().describe("Show branch changes pending integration into the parent branch."),
        preflight: tool.schema.boolean().optional().describe("Command-only preview; no staging or generation."),
        format: tool.schema.enum(["text", "json"]).optional().describe("Receipt presentation; defaults to JSON."),
        workdir: workdirArg,
    },
    async execute(args) {
        const dto = await assemblePatchReceipt(Object.freeze({ ...args }));
        const text = presentPatchReceipt(dto);
        if (!dto.ok) throw new Error(text);
        return text;
    },
});
