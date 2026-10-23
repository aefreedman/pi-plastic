import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { outputFormatArg } from "../presentation/results";
import { assembleObjectWriteReceipt, presentObjectWriteReceipt } from "./object-write-receipt";

export const changesetEditComment = tool({
    description: "Replace or clear one exact changeset comment (cm changeset editcomment, CM 11.0.16.10512+). Completion does not verify stored comment or repository identity.",
    args: {
        changeset: tool.schema.string().min(1).describe("Explicit cs:number or cs:GUID selector, optionally repository/server qualified."),
        comment: tool.schema.string().max(4096).optional().describe("Exact replacement text; empty string clears. Exclusive with commentsFile. For option-leading text use commentsFile."),
        commentsFile: tool.schema.string().min(1).optional().describe("Explicit local comment file, exclusive with comment."),
        preflight: tool.schema.boolean().optional().describe("Zero-command preview, not existence or permission analysis."),
        output: outputFormatArg,
        workdir: workdirArg,
    },
    async execute(args) {
        const dto = await assembleObjectWriteReceipt("changeset-edit-comment", args);
        const text = presentObjectWriteReceipt(dto);
        if (!dto.ok) throw new Error(text);
        return text;
    },
});
