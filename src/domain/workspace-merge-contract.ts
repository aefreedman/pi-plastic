import type { NativeHeader, NativeOutcome, NativeCommandData } from "./native-mutation";
export { safeNativeText as safeMergeText } from "./native-mutation";
export type MergeAction = "merge";
export type MergeStrategy = "auto" | "source" | "destination";
export type MergeRequest = { source: string; strategy?: MergeStrategy; cherrypicking?: boolean; forced?: boolean; preflight?: boolean; format?: "text" | "json"; workdir?: string };
export type WorkspaceMergeData = NativeCommandData & { requested: MergeRequest | null };
export type WorkspaceMergeReceipt = NativeHeader & NativeOutcome & { action: "merge"; data: WorkspaceMergeData };
export function buildWorkspaceMergeArgv(source: string, strategy: MergeStrategy, cherry: boolean, forced: boolean, token: string): string[] {
 const result = ["merge",source,"--merge","--nointeractiveresolution","--machinereadable",`--startlineseparator=${token}S__`,`--endlineseparator=${token}E__`,`--fieldseparator=${token}F__`];
 if(strategy === "auto") result.push("--mergetype=try","--conflict-markers"); else result.push("--mergetype=forced",strategy === "source" ? "--keepsource" : "--keepdestination",`--automaticresolution=all-${strategy === "source" ? "src" : "dst"}`);
 if(cherry)result.push("--cherrypicking");if(forced)result.push("--forced");return result;
}
