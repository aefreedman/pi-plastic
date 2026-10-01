import { tool } from "../tool-definition";

export const workdirArg = tool.schema.string().optional().describe("Working directory for the workspace.");
