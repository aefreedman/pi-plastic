import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { captureWorkspaceMergeCommand, emptyWorkspaceMergeAttempt } from "../execution/workspace-merge-command";
import { boundDiffOutput } from "../diff/text";
import { buildPatchCommandArgs, resolvePatchBranchSpecs, ensurePatchOutputDoesNotExist, readBoundedPatchFile } from "./patch-support";

export const PATCH_FILE_MAX_BYTES = 4194304;
export const PATCH_RECEIPT_MAX_BYTES = 524288;
export type PatchRequest = { source: string; destination: string|null; output: string|null; includeBinaries: boolean; clean: boolean; integration: boolean; workdir: string; preflight: boolean; format: "text"|"json" };
// binaryLimited records an observed UTF-8 listing, not a binary inventory.
// False (especially for opaque bytes) does not prove binary completeness.
export type PatchArtifact = { bytes: number; sha256: string; utf8: boolean; empty: boolean; binaryLimited: boolean; totalChars: number|null; truncated: boolean; content: string|null };
export type PatchData = {
    requested: PatchRequest|null;
    resolved: {source: string; destination: string|null; output: string|null}|null;
    intendedArgv: string[];
    attempt: ReturnType<typeof emptyWorkspaceMergeAttempt>;
    capture: Awaited<ReturnType<typeof captureWorkspaceMergeCommand>>["capture"]|null;
    artifact: PatchArtifact|null;
    publication: "not-requested"|"not-published"|"published"|"unknown";
    cleanup: "not-created"|"completed"|"failed"|"retained"|"unknown";
    retainedStagingDirectory: string|null;
    effect: "not-attempted"|"unverified"|"artifact-observed"|"published";
    workspaceEffects: "unverified"; moveRepresentation: "unverified";
};
export type PatchReceipt = {schemaVersion:1; action:"patch"; provenance:{source:"plastic";producer:"@aefree/pi-plastic";contentTrust:"external"}; completeness:{capture:"complete"|"incomplete"|"unknown";projection:true};data:PatchData}&
    ({ok:true;outcome:"preflight"|"generated"|"empty"}|{ok:false;outcome:"failed"|"uncertain";error:{code:"invalid_request"|"setup_failed"|"command_failed"|"uncertain"|"artifact_failed"|"publication_failed"|"cleanup_failed"|"producer_failed";message:string}});
export function validPatchText(v: unknown): v is string { return typeof v==="string" && v.length<=4096 && v.trim().length>0 && !/[\u0000-\u001f\u007f-\u009f]/.test(v); }
export function validPatchRequest(r: PatchRequest) { return validPatchText(r.source)&&!r.source.trimStart().startsWith("-")&&
    (r.destination===null||validPatchText(r.destination)&&!r.destination.trimStart().startsWith("-"))&&
    (r.output===null||validPatchText(r.output))&&typeof r.includeBinaries==="boolean"&&validPatchText(r.workdir)&&typeof r.clean==="boolean"&&typeof r.integration==="boolean"&&typeof r.preflight==="boolean"&&["text","json"].includes(r.format)&&Buffer.byteLength(JSON.stringify(r),"utf8")<=32768; }
export function patchReceiptArgv(r: PatchRequest, v: NonNullable<PatchData["resolved"]>) {
    return buildPatchCommandArgs({source:v.source,...(v.destination===null?{}:{destination:v.destination}),output:"<package-owned-staging-file>",includeBinaries:r.includeBinaries,clean:r.clean,integration:r.integration});
}
export function emptyPatchData(): PatchData { return {requested:null,resolved:null,intendedArgv:["patch"],attempt:emptyWorkspaceMergeAttempt(),capture:null,artifact:null,publication:"not-requested",cleanup:"not-created",retainedStagingDirectory:null,effect:"not-attempted",workspaceEffects:"unverified",moveRepresentation:"unverified"}; }
function header(d: PatchData) {return {schemaVersion:1 as const,action:"patch" as const,provenance:{source:"plastic" as const,producer:"@aefree/pi-plastic" as const,contentTrust:"external" as const},completeness:{capture:d.capture?d.capture.complete?"complete" as const:"incomplete" as const:"unknown" as const,projection:true as const},data:d};}
export function patchFailure(d: PatchData, code: Extract<PatchReceipt,{ok:false}>["error"]["code"], message: string): PatchReceipt {
    return {...header(d),ok:false,outcome:["started","unknown"].includes(d.attempt.state)&&!d.artifact?"uncertain":"failed",error:{code,message}};
}
export async function assemblePatchReceipt(args: unknown): Promise<PatchReceipt> {
    const d=emptyPatchData();let stage: string|null=null;let setupStage:"selector"|"output"="selector";let entered=false;let failure: {code:Extract<PatchReceipt,{ok:false}>["error"]["code"];message:string}|null=null;
    try {
        if (!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(k=>!["source","destination","output","includeBinaries","clean","integration","workdir","preflight","format"].includes(k)))
            return patchFailure(d,"invalid_request","Use declared bounded patch controls only.");
        const i={...args} as Record<string,unknown>;
        const r={source:i.source,destination:i.destination===undefined?null:i.destination,output:i.output===undefined?null:i.output,includeBinaries:i.includeBinaries===undefined?false:i.includeBinaries,clean:i.clean===undefined?false:i.clean,integration:i.integration===undefined?false:i.integration,workdir:i.workdir===undefined?process.cwd():i.workdir,preflight:i.preflight===undefined?false:i.preflight,format:i.format===undefined?"json":i.format} as PatchRequest;
        if (!validPatchRequest(r)||["destination","output"].some(k=>Object.hasOwn(i,k)&&i[k]===null)) return patchFailure(d,"invalid_request","Use non-option source/destination, nonblank paths, strict booleans and text/json.");
        d.requested=r;d.publication=r.output===null?"not-requested":"not-published";
        const branch=await resolvePatchBranchSpecs({source:r.source,...(r.destination===null?{}:{destination:r.destination})},r.workdir);
        const v={source:branch.source,destination:branch.destination??null,output:r.output===null?null:isAbsolute(r.output)?r.output:resolve(r.workdir,r.output)};
        if ([v.source,v.destination,v.output].some(s=>s!==null&&(s.length>8192||/[\u0000-\u001f\u007f-\u009f]/.test(s)))) throw new Error("Resolved patch controls exceed limits.");
        d.resolved=v;d.intendedArgv=patchReceiptArgv(r,v);
        if (r.preflight) return {...header(d),ok:true,outcome:"preflight"};
        setupStage="output";
        if (v.output!==null) await ensurePatchOutputDoesNotExist(v.output);
        stage=await fs.mkdtemp(join(v.output===null?tmpdir():resolve(v.output,".."),".pi-plastic-patch-"));
        const staged=join(stage,"patch-output");
        entered=true;
        const o=await captureWorkspaceMergeCommand(buildPatchCommandArgs({...v,destination:v.destination??undefined,output:staged,clean:r.clean,integration:r.integration,includeBinaries:r.includeBinaries}),r.workdir);
        d.attempt=o.attempt;d.capture=o.capture;d.effect=["started","unknown"].includes(o.attempt.state)?"unverified":"not-attempted";
        if (!o.capture.complete||o.failed||o.attempt.state!=="started"||o.attempt.exitCode!==0||o.capture.stderrBytes>0) {
            failure={code:["started","unknown"].includes(o.attempt.state)?"uncertain":"command_failed",message:"Patch command completion is not admitted. Inspect possible effects; no automatic retry."};
        } else {
            try {
                const bytes=await readBoundedPatchFile(staged,PATCH_FILE_MAX_BYTES),utf8=isUtf8(bytes),body=utf8?bytes.toString("utf8"):null,bounded=body===null?null:boundDiffOutput(body);
                d.artifact={bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),utf8,empty:bytes.length===0,binaryLimited:body!==null&&/^Binary files? .* differ\r?$/m.test(body),totalChars:body===null?null:body.length,truncated:!!bounded?.truncated&&r.output===null,content:r.output===null&&utf8?bounded!.output:null};
                d.effect="artifact-observed";
            } catch { failure={code:"artifact_failed",message:"Completed command did not yield an admitted stable regular patch file within 4MiB. No publication or retry."}; }
            if (!failure&&v.output!==null) {
                if (d.artifact!.empty) failure={code:"publication_failed",message:"Refusing to publish an empty patch; requested output was not published."};
                else try { await fs.link(staged,v.output);d.publication="published";d.effect="published"; }
                catch { failure={code:"publication_failed",message:"Atomic no-overwrite publication failed. Observed generated bytes remain recorded; no replacement or retry."}; }
            }
        }
    } catch {
        if (entered&&d.capture===null) {d.attempt={...emptyWorkspaceMergeAttempt(),state:"unknown"};d.effect="unverified";}
        const setupMessages={
            selector:"Patch selector repository could not be verified. Use an exact qualified br:/branch@repository@server selector. No command was dispatched.",
            output:"Patch output is unavailable or already exists. Use a new filename in an existing writable parent directory. No command was dispatched.",
        };
        failure={code:entered?"producer_failed":"setup_failed",message:entered?"Patch observation failed; earlier observed effects remain recorded, no automatic retry.":setupMessages[setupStage]};
    } finally {
        if (stage!==null) {
            if (entered&&(d.attempt.state==="unknown"||d.attempt.state==="started")&&(d.attempt.terminal!=="observed"||d.attempt.aborted||d.attempt.timedOut)) {d.cleanup="retained";d.retainedStagingDirectory=stage;}
            else try {await fs.rm(stage,{recursive:true,force:true});d.cleanup="completed";}
            catch {d.cleanup="failed";d.retainedStagingDirectory=stage;failure??={code:"cleanup_failed",message:"Owned staging cleanup failed. Earlier generated/published artifact evidence remains; no rollback or retry."};}
        }
    }
    if (failure) return patchFailure(d,failure.code,failure.message);
    return {...header(d),ok:true,outcome:d.artifact!.empty?"empty":"generated"};
}
export function presentPatchReceipt(d: PatchReceipt) {
    if (d.data.requested?.format!=="text") return JSON.stringify(d);
    if (!d.ok) return `Patch ${d.outcome}: ${d.error.message} Effect: ${d.data.effect}; cleanup: ${d.data.cleanup}.`;
    if (d.outcome==="preflight") return `Patch command-only preview: ${JSON.stringify(d.data.intendedArgv)}. No generation/readiness analysis.`;
    return `Patch ${d.outcome}: ${d.data.artifact!.bytes} observed bytes; publication: ${d.data.publication}; cleanup: ${d.data.cleanup}. Binary mode: ${d.data.requested!.includeBinaries?"raw byte hunks requested":"changed binaries listed only"}; UTF-8: ${d.data.artifact!.utf8}; binary listing observed: ${d.data.artifact!.binaryLimited}. Workspace effects/move encoding remain unverified.`;
}
