import { Type } from "typebox";
import { Check } from "typebox/value";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { assemblePatchReceipt, emptyPatchData, patchFailure, patchReceiptArgv, presentPatchReceipt, validPatchRequest, PATCH_FILE_MAX_BYTES, PATCH_RECEIPT_MAX_BYTES, type PatchReceipt } from "../operations/patch-receipt";
const obj=(p:Record<string,any>)=>Type.Object(p,{additionalProperties:false});
const enm=(v:string[])=>Type.Union(v.map(x=>Type.Literal(x))),nil=(s:any)=>Type.Union([s,Type.Null()]),uint=(max=Number.MAX_SAFE_INTEGER)=>Type.Integer({minimum:0,maximum:max}),text=Type.String({minLength:1,maxLength:8192});
const attempt=obj({state:enm(["not-attempted","not-started","started","unknown"]),terminal:enm(["not-observed","observed"]),exitCode:nil(uint(2147483647)),aborted:Type.Boolean(),timedOut:Type.Boolean()});
const capture=obj({stdoutBytes:uint(),stderrBytes:uint(),stdoutRetainedBytes:uint(65536),stderrRetainedBytes:uint(16384),truncated:Type.Boolean(),complete:Type.Boolean(),validUtf8:Type.Boolean()});
const artifact=obj({bytes:uint(PATCH_FILE_MAX_BYTES),sha256:Type.String({pattern:"^[a-f0-9]{64}$"}),utf8:Type.Boolean(),empty:Type.Boolean(),binaryLimited:Type.Boolean(),totalChars:nil(uint(PATCH_FILE_MAX_BYTES)),truncated:Type.Boolean(),content:nil(Type.String({maxLength:60500}))});
const request=obj({source:text,destination:nil(text),output:nil(text),toolPath:nil(text),clean:Type.Boolean(),integration:Type.Boolean(),workdir:text,preflight:Type.Boolean(),format:enm(["text","json"])});
const data=obj({requested:nil(request),resolved:nil(obj({source:text,destination:nil(text),toolPath:text,output:nil(text)})),intendedArgv:Type.Array(text,{minItems:1,maxItems:7}),attempt,capture:nil(capture),artifact:nil(artifact),publication:enm(["not-requested","not-published","published","unknown"]),cleanup:enm(["not-created","completed","failed","retained","unknown"]),retainedStagingDirectory:nil(text),effect:enm(["not-attempted","unverified","artifact-observed","published"]),workspaceEffects:Type.Literal("unverified"),moveRepresentation:Type.Literal("backend-determined")});
const header={schemaVersion:Type.Literal(1),action:Type.Literal("patch"),provenance:obj({source:Type.Literal("plastic"),producer:Type.Literal("@aefree/pi-plastic"),contentTrust:Type.Literal("external")}),completeness:obj({capture:enm(["complete","incomplete","unknown"]),projection:Type.Literal(true)}),data};
export const patchOutputSchema=Type.Unsafe<PatchReceipt>(Type.Union([obj({...header,ok:Type.Literal(true),outcome:enm(["preflight","generated","empty"])}),obj({...header,ok:Type.Literal(false),outcome:enm(["failed","uncertain"]),error:obj({code:enm(["invalid_request","setup_failed","command_failed","uncertain","backend_incompatible","artifact_failed","publication_failed","cleanup_failed","producer_failed"]),message:Type.String({minLength:1,maxLength:256})})})]));
const safe=(s:string)=>s.trim().length>0&&!/[\u0000-\u001f\u007f-\u009f]/.test(s);
function resolvedSelector(requested:string,observed:string) {const s=requested.trim();return observed===s||/^br:\/.+/i.test(s)&&!s.includes("@")&&observed.startsWith(s+"@")&&observed.slice(s.length+1).split("@").every(p=>p.trim().length>0&&p===p.trim());}
export function validatePatchOutput(v:unknown):v is PatchReceipt {
    if(!Check(patchOutputSchema,v)||Buffer.byteLength(JSON.stringify(v),"utf8")>PATCH_RECEIPT_MAX_BYTES)return false;
    const dto=v as PatchReceipt,d=dto.data,r=d.requested,z=d.resolved,a=d.attempt,c=d.capture,f=d.artifact;
    if(dto.completeness.capture!==(c?c.complete?"complete":"incomplete":"unknown"))return false;
    if(r===null) {
        if(z||c||f||JSON.stringify(d.intendedArgv)!=='["patch"]'||d.retainedStagingDirectory!==null||a.terminal!=="not-observed"||a.exitCode!==null||a.aborted||a.timedOut)return false;
        if(a.state==="not-attempted")return !dto.ok&&dto.outcome==="failed"&&dto.error.code==="invalid_request"&&d.effect==="not-attempted"&&d.cleanup==="not-created"&&d.publication==="not-requested";
        return !dto.ok&&dto.outcome==="uncertain"&&dto.error.code==="producer_failed"&&a.state==="unknown"&&d.effect==="unverified"&&d.cleanup==="unknown"&&d.publication==="unknown";
    }
    if(!validPatchRequest(r))return false;
    if(z) {
        if(!Object.values(z).every(s=>s===null||safe(s))||!resolvedSelector(r.source,z.source)||(r.destination===null?z.destination!==null:z.destination===null||!resolvedSelector(r.destination,z.destination))||JSON.stringify(d.intendedArgv)!==JSON.stringify(patchReceiptArgv(r,z)))return false;
        if(r.toolPath!==null&&z.toolPath!==r.toolPath.trim()||r.output===null&&z.output!==null||r.output!==null&&z.output!==(isAbsolute(r.output)?r.output:resolve(r.workdir,r.output)))return false;
        const tails=[r.source,r.destination].map((s,i)=>s!==null&&/^br:\/.+/i.test(s.trim())&&!s.includes("@")?(i===0?z.source:z.destination)!.slice(s.trim().length):null).filter(s=>s!==null);
        if(tails.some(t=>t!==tails[0]))return false;
    } else if(c||f||JSON.stringify(d.intendedArgv)!=='["patch"]'||a.state!=="not-attempted"||d.cleanup!=="not-created")return false;
    if(a.exitCode!==null&&a.terminal!=="observed"||["not-attempted","not-started"].includes(a.state)&&(a.exitCode!==null||a.terminal!=="not-observed")||a.state==="not-attempted"&&a.timedOut)return false;
    if(c) {
        if(!z||c.stdoutRetainedBytes>c.stdoutBytes||c.stderrRetainedBytes>c.stderrBytes)return false;
        if(c.complete&&(!c.validUtf8||c.truncated||c.stdoutBytes!==c.stdoutRetainedBytes||c.stderrBytes!==c.stderrRetainedBytes||a.state!=="started"||a.terminal!=="observed"||a.exitCode===null||a.aborted||a.timedOut))return false;
    }
    if(dto.completeness.capture!==(c?c.complete?"complete":"incomplete":"unknown"))return false;
    if((d.retainedStagingDirectory!==null)!==["failed","retained"].includes(d.cleanup)||["failed","retained"].includes(d.cleanup)&&!safe(d.retainedStagingDirectory!))return false;
    if(d.cleanup==="retained"&&(a.terminal==="observed"&&!a.aborted&&!a.timedOut||!["started","unknown"].includes(a.state)))return false;
    if(f) {
        if(f.utf8&&(f.totalChars===null||f.totalChars>f.bytes||f.bytes>3*f.totalChars))return false;
        if(!c?.complete||a.state!=="started"||a.exitCode!==0||c.stderrBytes!==0||f.empty!==(f.bytes===0)||!f.utf8&&!f.binaryLimited||!f.utf8&&(f.content!==null||f.totalChars!==null||f.truncated)||f.utf8&&f.totalChars===null)return false;
        if(r.output!==null&&(f.content!==null||f.truncated)||r.output===null&&f.utf8&&f.content===null)return false;
        if(r.output===null&&f.utf8) {
            if(f.truncated!==(f.totalChars!>60000))return false;
            if(!f.truncated&&(f.totalChars!==f.content!.length||f.bytes!==Buffer.byteLength(f.content!,"utf8")||f.sha256!==createHash("sha256").update(f.content!).digest("hex")))return false;
            if(f.truncated&&f.content!.length<=60000)return false;
        }
        if(f.empty&&(!f.utf8||f.totalChars!==0||f.sha256!==createHash("sha256").update("").digest("hex")))return false;
    }
    if(d.publication==="published"&&(!f||f.empty||r.output===null||d.effect!=="published")||d.publication!=="published"&&d.effect==="published")return false;
    if(d.publication!=="published"&&d.publication!==(r.output===null?"not-requested":"not-published"))return false;
    if(d.effect!==(d.publication==="published"?"published":f?"artifact-observed":["started","unknown"].includes(a.state)?"unverified":"not-attempted"))return false;
    if(r.preflight)return !c&&!f&&a.state==="not-attempted"&&!a.aborted&&d.cleanup==="not-created"&&(dto.ok?dto.outcome==="preflight"&&!!z:dto.outcome==="failed"&&dto.error.code==="setup_failed");
    if(dto.ok)return !!z&&!!f&&d.cleanup==="completed"&&(dto.outcome==="empty"?f.empty:dto.outcome==="generated"&&!f.empty)&&(r.output===null||d.publication==="published");
    if(dto.outcome!==(["started","unknown"].includes(a.state)&&!f?"uncertain":"failed"))return false;
    if(dto.error.code==="invalid_request"||dto.error.code==="setup_failed"&&(a.state!=="not-attempted"||c||f)||dto.error.code==="uncertain"&&!["started","unknown"].includes(a.state)||["publication_failed","cleanup_failed"].includes(dto.error.code)&&!f)return false;
    return true;
}
export async function executePatchOutput(args:unknown) {
    let dto=await assemblePatchReceipt(args);
    if(!validatePatchOutput(dto)) {
        const d=emptyPatchData();d.attempt.state="unknown";d.effect="unverified";d.publication="unknown";d.cleanup="unknown";
        dto=patchFailure(d,"producer_failed","Patch receipt invalid; generation/publication and staging effects may already exist. No automatic retry or cleanup.");
        if(!validatePatchOutput(dto))throw new Error("Safe patch receipt unavailable; earlier effects may exist.");
    }
    return {content:[{type:"text" as const,text:presentPatchReceipt(dto)}],details:{},structuredContent:dto,isError:!dto.ok};
}
