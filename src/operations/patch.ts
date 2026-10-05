import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { assemblePatchReceipt, presentPatchReceipt } from "./patch-receipt";
export { __plasticPatchInternals, getPatchBackendCapabilityWarning, PLASTIC_PATCH_EXECUTABLE_ENV } from "./patch-support";

export const patch = tool({
    description: "Generate a Plastic SCM review patch with a patch-specific non-GUI diff backend; branch selectors are qualified to the current workspace repository and requested outputs publish atomically without overwrite (cm patch).",
    args: {
        source: tool.schema.string().min(1).describe("Source changeset or branch spec. Unqualified br:/ selectors are qualified only from the exact current workspace repository."),
        destination: tool.schema.string().optional().describe("Optional second changeset or branch spec for two-spec patch generation."),
        output: tool.schema.string().optional().describe("Optional new output file path. The package stages then atomically publishes it and refuses any existing path. If omitted, patch content is returned."),
        toolPath: tool.schema.string().optional().describe("Optional patch-capable non-GUI diff executable for this call (highest priority). Otherwise use PI_PLASTIC_PATCH_EXECUTABLE; non-Windows falls back to PI_PLASTIC_DIFF_EXECUTABLE/diff, which must support the local Plastic patch argument contract."),
        clean: tool.schema.boolean().optional().describe("Exclude content that arrived via merges and include only direct checkins."),
        integration: tool.schema.boolean().optional().describe("Show branch changes pending integration into the parent branch."),
        preflight: tool.schema.boolean().optional().describe("Command-only preview; no staging, backend probe or generation."),
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
