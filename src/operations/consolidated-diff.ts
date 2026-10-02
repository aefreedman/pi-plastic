import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createAsciiTempDirectory, isBinaryContent } from "../diff/text";
import { snapshotLocalFile } from "../diff/local-snapshot";
import { parseLoadedFileInfo, parseLoadedLs } from "../domain/diff-base-xml";
import { parseDiffPending, type DiffPendingItem, type DiffPendingSnapshot } from "../domain/diff-pending-xml";
import { resolveDiffFileRevision } from "../domain/revisions";
import { getCmExecutable } from "../execution/process";
import { getActiveAbortSignal } from "../execution/context";
import { runDiffRevisionsCommand } from "../execution/diff-revisions-command";
import { assembleDiffRevisionsObservation, compareDiffBytes, diffRevisionsPayload, materializeDiffRevision, validDiffRevisionsSelector, type DiffRevisionsObservation } from "./diff-revisions";

export type DiffRequest = { workdir?:string;format?:"text"|"json";maxChars?:number } & (
    {mode:"revisions";leftRevision:string;rightRevision:string} |
    {mode:"file";path:string;revision?:string} |
    {mode:"workspace";paths:string[];allPending?:never;includePrivate?:never;maxFiles?:number} |
    {mode:"workspace";allPending:true;paths?:never;includePrivate?:boolean;maxFiles?:number}
);
export class ConsolidatedDiffError extends Error {
    constructor(readonly code:string,readonly stage:string) { super("The requested diff could not be verified."); }
}
const fail=(code:string,stage:string):never=>{throw new ConsolidatedDiffError(code,stage);};
const aborted=()=>{if(getActiveAbortSignal()?.aborted)fail("aborted","comparison");};
const safe=(s:unknown,max:number):s is string=>typeof s==="string"&&s.length>0&&s.length<=max&&s.trim()===s&&!/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
export function validateDiffRequest(input:unknown):asserts input is DiffRequest {
    if(!input||typeof input!=="object"||Array.isArray(input))fail("invalid_request","input");
    const r=input as Record<string,unknown>,allowed=new Set(["mode","workdir","format","maxChars"]);
    if(r.mode==="revisions") {allowed.add("leftRevision");allowed.add("rightRevision");if(!validDiffRevisionsSelector(r.leftRevision)||!validDiffRevisionsSelector(r.rightRevision))fail("invalid_selector","input");}
    else if(r.mode==="file") {allowed.add("path");allowed.add("revision");if(!safe(r.path,1024)||r.revision!==undefined&&!safe(r.revision,4096))fail("invalid_request","input");}
    else if(r.mode==="workspace") {
        allowed.add("maxFiles");
        if(r.paths!==undefined){allowed.add("paths");if(!Array.isArray(r.paths)||!r.paths.length||r.paths.length>20||r.paths.some(p=>!safe(p,1024)))fail("invalid_request","input");}
        else {allowed.add("allPending");allowed.add("includePrivate");if(r.allPending!==true||r.includePrivate!==undefined&&typeof r.includePrivate!=="boolean")fail("invalid_request","input");}
        if(r.maxFiles!==undefined&&(!Number.isInteger(r.maxFiles)||Number(r.maxFiles)<1||Number(r.maxFiles)>20))fail("invalid_request","input");
    } else fail("invalid_request","input");
    if(Object.keys(r).some(k=>!allowed.has(k))||r.format!==undefined&&r.format!=="text"&&r.format!=="json"||r.workdir!==undefined&&!safe(r.workdir,4096))fail("invalid_request","input");
    if(r.maxChars!==undefined&&(!Number.isInteger(r.maxChars)||Number(r.maxChars)<500||Number(r.maxChars)>(r.mode==="workspace"?8000:20000)))fail("invalid_request","input");
}
const key=(p:string)=>{const normalized=resolve(p);return process.platform==="win32"?normalized.toLowerCase():normalized;};
const contains=(root:string,p:string)=>{const r=relative(root,p);return r!==".."&&!r.startsWith(".."+sep)&&!isAbsolute(r);};
async function workspaceRoot(cwd:string):Promise<string>{
    let p=await fs.realpath(cwd);
    for(let i=0;i<128;i++){const marker=await fs.lstat(join(p,".plastic")).catch(()=>null),config=await fs.lstat(join(p,".plastic","plastic.workspace")).catch(()=>null);if(marker?.isDirectory()&&!marker.isSymbolicLink()&&config?.isFile()&&!config.isSymbolicLink())return p;const parent=dirname(p);if(parent===p)break;p=parent;}
    return fail("workspace_unavailable","selection");
}
async function xmlCommand(args:string[],cwd:string,stage:string):Promise<Buffer>{
    aborted();try{return (await runDiffRevisionsCommand(getCmExecutable(),args,cwd,[0])).stdout;}catch{return fail(getActiveAbortSignal()?.aborted?"aborted":"command_failed",stage);}
}
export type LoadedIdentity={revisionId:string;changeset:string;repository:string;server:string};
export type DiffSide={origin:"historical"|"local-snapshot"|"synthetic-empty";selector:string|null;path:string|null;identity:LoadedIdentity|null;bytes:number;binary:boolean};
export type Comparison={atomicSnapshot:false;kind:string;pendingKind:string|null;left:DiffSide;right:DiffSide;status:"changed"|"unchanged"|"binary-different"|"added-empty";changed:boolean;binary:boolean;comparisonBasis:"byte_equality"|"diff_u";hunkCount:number;capture:{diffStdoutBytes:number|null;diffExitCode:number|null};excerpt:ReturnType<typeof diffRevisionsPayload>["data"]["excerpt"]};
function comparison(observation:DiffRevisionsObservation,left:DiffSide,right:DiffSide,kind:string,pendingKind:string|null):Comparison {
    const d=diffRevisionsPayload(observation).data;
    return {atomicSnapshot:false,kind,pendingKind,left,right,status:!d.changed&&pendingKind==="added"?"added-empty":d.status,changed:d.changed,binary:d.binary,comparisonBasis:d.comparisonBasis,hunkCount:d.hunkCount,capture:d.capture,excerpt:d.excerpt};
}
const side=(origin:DiffSide["origin"],bytes:Buffer,path:string|null,selector:string|null,identity:LoadedIdentity|null=null):DiffSide=>({origin,path,selector,identity,bytes:bytes.length,binary:isBinaryContent(bytes)});
async function pending(cwd:string):Promise<DiffPendingSnapshot>{try{return parseDiffPending(await xmlCommand(["status","--xml","--encoding=utf-8","--fullpaths","--iscochanged"],cwd,"status"));}catch(e){if(e instanceof ConsolidatedDiffError)throw e;return fail("malformed_output","status");}}
async function base(path:string,cwd:string,snapshot:DiffPendingSnapshot,item:DiffPendingItem|null):Promise<{selector:string;identity:LoadedIdentity;hash:string;algorithm:"md5"|"sha1"}>{
    try {
        const info=parseLoadedFileInfo(await xmlCommand(["fileinfo",path,"--fields=ClientPath,ServerPath,RevisionChangeset,Hash,RepSpec,Status,Type","--xml","--encoding=utf-8"],cwd,"base"));
        if(key(info.clientPath)!==key(path)||!["txt","bin","file"].includes(info.type.toLowerCase()))return fail("base_unavailable","base");
        // DE removes live-tree membership/RepSpec. Deliberately inspect the
        // frozen loaded root tree, never retry a failed live-tree lookup or
        // guess a parent owning repository. Require loaded changeset/hash match.
        const deleted=item?.code==="DE";
        if(deleted&&info.status!=="deleted")return fail("base_changed","base");
        const query=deleted?["ls",info.serverPath,"--tree=cs:"+snapshot.changeset+"@"+snapshot.repository+"@"+snapshot.server,"--xml","--encoding=utf-8"]:["ls",path,"--xml","--encoding=utf-8"];
        const row=parseLoadedLs(await xmlCommand(query,cwd,"base"));
        if((deleted?row.path!==info.serverPath:key(row.path)!==key(path))||row.changeset!==info.changeset||row.hash!==info.hash||!deleted&&info.repSpec!==row.repository+"@"+row.server)return fail("base_changed","base");
        const selector="revid:"+row.revisionId+"@rep:"+row.repository+"@repserver:"+row.server;
        if(!validDiffRevisionsSelector(selector))return fail("invalid_selector","base");
        return {selector,identity:{revisionId:row.revisionId,changeset:row.changeset,repository:row.repository,server:row.server},hash:row.hash,algorithm:row.algorithm};
    }catch(e){if(e instanceof ConsolidatedDiffError)throw e;return fail("base_unavailable","base");}
}
async function fileComparison(args:DiffRequest&{mode:"file"},cwd:string,root:string,snapshot:DiffPendingSnapshot|null,item:DiffPendingItem|null):Promise<Comparison>{
    const path=resolve(cwd,args.path);if(!contains(root,path))return fail("outside_workspace","selection");
    let selector:string|null=null,identity:LoadedIdentity|null=null,expected:{hash:string;algorithm:"md5"|"sha1"}|null=null;
    if(args.revision!==undefined){try{selector=resolveDiffFileRevision(args.path,args.revision).resolved;}catch{return fail("invalid_selector","input");}if(!validDiffRevisionsSelector(selector))return fail("invalid_selector","input");}
    else if(item?.kind!=="added"&&item?.kind!=="private") {const lookup=item?.code==="LM"?item.sourcePath!:path;if(!contains(root,lookup))return fail("outside_workspace","selection");const b=await base(lookup,cwd,snapshot!,item);selector=b.selector;identity=b.identity;expected=b;}
    const temp=await createAsciiTempDirectory("pi-plastic-file-diff-");
    try {
        const l=selector?await materializeDiffRevision(selector,join(temp,"base"),"left",cwd):Buffer.alloc(0);
        if(expected&&createHash(expected.algorithm).update(l).digest("base64")!==expected.hash)return fail("base_changed","base");
        const deleted=!args.revision&&item?.kind==="deleted";
        if(deleted&&await fs.lstat(path).catch(()=>null))return fail("file_changed","right");
        const r=deleted?Buffer.alloc(0):(await snapshotLocalFile(path,root,getActiveAbortSignal())).bytes;
        const left=side(selector?"historical":"synthetic-empty",l,null,selector,identity),right=side(deleted?"synthetic-empty":"local-snapshot",r,path,null);
        const raw=await compareDiffBytes(l,r,selector??args.path+" (empty before add)",args.path+(deleted?" (empty after delete)":" (local snapshot)"));
        const obs:DiffRevisionsObservation={...raw,maxChars:args.maxChars??8000,left:{selector:selector??"synthetic empty",kind:"global-revision",resolvedIdentity:null,bytes:l.length,binary:left.binary},right:{selector:args.path,kind:"file-qualified",resolvedIdentity:null,bytes:r.length,binary:right.binary}};
        return comparison(obs,left,right,args.revision!==undefined?"explicit-revision-to-local":"loaded-base-to-local",args.revision!==undefined?null:item?.kind??null);
    } finally {await fs.rm(temp,{recursive:true,force:true}).catch(()=>fail("cleanup_failed","cleanup"));}
}
export type DiffOutcome={path:string;sourcePath:string|null;kind:string;status:"compared";comparison:Comparison}|{path:string;sourcePath:string|null;kind:string;status:"skipped-directory"}|{path:string;sourcePath:string|null;kind:string;status:"unavailable";error:{code:string;stage:string;message:string}};
export function diffError(e:unknown){const r=e as {code?:unknown;stage?:unknown};const codes=new Set(["invalid_request","invalid_selector","workspace_unavailable","outside_workspace","base_unavailable","base_changed","malformed_output","command_failed","aborted","cleanup_failed","materialization_failed","materialization_limit","invalid_utf8","capture_incomplete","output_overflow","missing_file","unsupported_file","file_limit","file_changed","read_failed"]);return {code:typeof r?.code==="string"&&codes.has(r.code)?r.code:"comparison_failed",stage:typeof r?.stage==="string"&&["input","selection","status","base","left","right","comparison","cleanup","producer"].includes(r.stage)?r.stage:"comparison",message:"The requested diff could not be verified."};}
export async function assembleConsolidatedDiff(input:unknown){
    validateDiffRequest(input);const args=input;aborted();
    const header={schemaVersion:1 as const,action:"diff" as const,mode:args.mode,provenance:{source:"plastic" as const,producer:"@aefree/pi-plastic" as const,contentTrust:"external" as const}};
    if(args.mode==="revisions") {
        const obs=await assembleDiffRevisionsObservation(args),d=diffRevisionsPayload(obs);
        const left:DiffSide={origin:"historical",selector:args.leftRevision,path:null,identity:null,bytes:obs.left.bytes,binary:obs.left.binary};
        const right:DiffSide={origin:"historical",selector:args.rightRevision,path:null,identity:null,bytes:obs.right.bytes,binary:obs.right.binary};
        return {...header,mode:"revisions" as const,ok:true,completeness:d.completeness,data:comparison(obs,left,right,"revision-to-revision",null)};
    }
    const cwd=await fs.realpath(args.workdir??process.cwd()),root=await workspaceRoot(cwd);
    if(args.mode==="file") {
        const snapshot=args.revision!==undefined?null:await pending(cwd),item=snapshot?.items.find(i=>key(i.path)===key(resolve(cwd,args.path)))??null;
        const data=await fileComparison(args,cwd,root,snapshot,item);
        return {...header,mode:"file" as const,ok:true,completeness:{read:"complete",capture:"complete",projection:!data.excerpt?.truncated},data};
    }
    const snapshot=await pending(cwd),requestedPaths=args.paths??null,scopes=requestedPaths?.map(p=>resolve(cwd,p))??[];
    if(scopes.some(p=>!contains(root,p)))return fail("outside_workspace","selection");
    if(scopes.some(p=>key(p)===key(root)))return fail("invalid_request","selection");
    const matches=(p:string,i:DiffPendingItem)=>contains(p,i.path)||i.sourcePath!==null&&contains(p,i.sourcePath);
    const eligible=snapshot.items.filter(i=>scopes.length?scopes.some(p=>matches(p,i)):i.kind!=="private"||"includePrivate"in args&&args.includePrivate);
    const maxFiles=args.maxFiles??(scopes.length?20:3),selected=eligible.slice(0,maxFiles),outcomes:DiffOutcome[]=[];
    let attempted=0,completed=0,failed=0,skipped=0;
    for(const i of selected){if(getActiveAbortSignal()?.aborted)break;if(i.directory){outcomes.push({path:i.path,sourcePath:i.sourcePath,kind:i.kind,status:"skipped-directory"});skipped++;continue;}
        attempted++;try{const c=await fileComparison({mode:"file",path:i.path,workdir:cwd,maxChars:args.maxChars??3000},cwd,root,snapshot,i);outcomes.push({path:i.path,sourcePath:i.sourcePath,kind:i.kind,status:"compared",comparison:c});completed++;}catch(e){outcomes.push({path:i.path,sourcePath:i.sourcePath,kind:i.kind,status:"unavailable",error:diffError(e)});failed++;}}
    const unattempted=selected.length-outcomes.length,ok=!failed&&!unattempted;
    const data={scope:scopes.length?"selected":"all-pending",requestedPaths,includePrivate:"includePrivate"in args?args.includePrivate??false:false,excludedPrivate:scopes.length?0:snapshot.items.filter(i=>i.kind==="private"&&!("includePrivate"in args&&args.includePrivate)).length,counts:{parsed:snapshot.items.length,eligible:eligible.length,selected:selected.length,attempted,completed,failed,skipped,unattempted,limited:eligible.length-selected.length,returned:outcomes.length,omitted:0},unmatched:requestedPaths?requestedPaths.filter((p,index)=>!snapshot.items.some(i=>matches(scopes[index],i))):[],outcomes};
    const payload={...header,mode:"workspace" as const,ok,completeness:{read:ok&&!data.counts.limited&&!data.unmatched.length&&!data.counts.skipped?"complete":"incomplete",capture:ok?"complete":"unknown",projection:outcomes.every(o=>o.status!=="compared"||!o.comparison.excerpt?.truncated)&&!data.counts.limited},data,...(!ok?{error:{code:unattempted?"aborted":"partial_comparison",stage:"comparison",message:"Some requested comparisons could not be verified."}}:{})};
    while(Buffer.byteLength(JSON.stringify(payload),"utf8")>131072&&data.outcomes.length){data.outcomes.pop();data.counts.returned--;data.counts.omitted++;payload.completeness.projection=false;}
    if(Buffer.byteLength(JSON.stringify(payload),"utf8")>131072)return fail("output_overflow","producer");return payload;
}
