import { Type, type Static, type TProperties } from "typebox";
import { Check } from "typebox/value";
import { validDiffRevisionsSelector } from "../operations/diff-revisions";
import { assembleConsolidatedDiff, diffError, type DiffRequest } from "../operations/consolidated-diff";
const object=<P extends TProperties>(p:P)=>Type.Object(p,{additionalProperties:false});
const enumOf=<const V extends readonly string[]>(v:V)=>Type.Unsafe<V[number]>({anyOf:v.map(x=>({type:"string",const:x}))});
const string=(max=4096)=>Type.String({maxLength:max});
const uint=(max=4194304)=>Type.Integer({minimum:0,maximum:max});
const nullable=<T extends ReturnType<typeof Type.String>|ReturnType<typeof object>|ReturnType<typeof Type.Array>|ReturnType<typeof Type.Integer>|ReturnType<typeof enumOf>>(s:T)=>Type.Union([s,Type.Null()]);
const common={workdir:Type.Optional(Type.String({minLength:1,maxLength:4096})),format:Type.Optional(enumOf(["text","json"])),maxChars:Type.Optional(Type.Integer({minimum:500,maximum:20000}))};
const paths=Type.Array(Type.String({minLength:1,maxLength:1024}),{minItems:1,maxItems:20});
const workspace={...common,maxChars:Type.Optional(Type.Integer({minimum:500,maximum:8000})),maxFiles:Type.Optional(Type.Integer({minimum:1,maximum:20}))};
const variants=Type.Union([
    object({mode:Type.Literal("file"),path:Type.String({minLength:1,maxLength:1024}),revision:Type.Optional(Type.String({minLength:1,maxLength:4096})),...common}),
    object({mode:Type.Literal("revisions"),leftRevision:Type.String({minLength:1,maxLength:4096}),rightRevision:Type.String({minLength:1,maxLength:4096}),...common}),
    object({mode:Type.Literal("workspace"),paths,...workspace}),
    object({mode:Type.Literal("workspace"),allPending:Type.Literal(true),includePrivate:Type.Optional(Type.Boolean()),...workspace}),
]);
export const diffInputSchema=Type.Unsafe<DiffRequest>({...variants,type:"object"});
const provenance=object({source:Type.Literal("plastic"),producer:Type.Literal("@aefree/pi-plastic"),contentTrust:Type.Literal("external")});
const completeness=object({read:enumOf(["complete","incomplete"]),capture:enumOf(["complete","unknown"]),projection:Type.Boolean()});
const error=object({code:enumOf(["invalid_request","invalid_selector","workspace_unavailable","outside_workspace","base_unavailable","base_changed","malformed_output","command_failed","aborted","cleanup_failed","materialization_failed","materialization_limit","invalid_utf8","capture_incomplete","output_overflow","missing_file","unsupported_file","file_limit","file_changed","read_failed","comparison_failed","partial_comparison"]),stage:enumOf(["input","selection","status","base","left","right","comparison","cleanup","producer"]),message:string(256)});
const identity=object({revisionId:Type.String({pattern:"^(0|[1-9][0-9]{0,19})$"}),changeset:Type.String({pattern:"^(0|[1-9][0-9]{0,19})$"}),repository:string(),server:string()});
const side=object({origin:enumOf(["historical","local-snapshot","synthetic-empty"]),selector:nullable(string()),path:nullable(string()),identity:nullable(identity),bytes:uint(),binary:Type.Boolean()});
const excerpt=object({countBasis:Type.Literal("normalized_diff_utf16"),text:string(20000),observedChars:uint(1060000),sourceChars:uint(20000),returnedChars:uint(20000),omittedChars:uint(1060000),markerChars:uint(59),truncated:Type.Boolean()});
const comparison=object({atomicSnapshot:Type.Literal(false),kind:enumOf(["revision-to-revision","explicit-revision-to-local","loaded-base-to-local"]),pendingKind:nullable(enumOf(["changed","added","deleted","moved","private","checkedout","copied","replaced"])),left:side,right:side,status:enumOf(["changed","unchanged","binary-different","added-empty"]),changed:Type.Boolean(),binary:Type.Boolean(),comparisonBasis:enumOf(["byte_equality","diff_u"]),hunkCount:uint(),capture:object({diffStdoutBytes:nullable(uint(1048576)),diffExitCode:nullable(uint(1))}),excerpt:nullable(excerpt)});
const outcome=Type.Union([object({path:string(),sourcePath:nullable(string()),kind:string(32),status:Type.Literal("compared"),comparison}),object({path:string(),sourcePath:nullable(string()),kind:string(32),status:Type.Literal("skipped-directory")}),object({path:string(),sourcePath:nullable(string()),kind:string(32),status:Type.Literal("unavailable"),error})]);
const collection=object({scope:enumOf(["selected","all-pending"]),requestedPaths:nullable(paths),includePrivate:Type.Boolean(),excludedPrivate:uint(20000),counts:object({parsed:uint(20000),eligible:uint(20000),selected:uint(20),attempted:uint(20),completed:uint(20),failed:uint(20),skipped:uint(20),unattempted:uint(20),limited:uint(20000),returned:uint(20),omitted:uint(20)}),unmatched:Type.Array(string(1024),{maxItems:20}),outcomes:Type.Array(outcome,{maxItems:20})});
const header={schemaVersion:Type.Literal(1),action:Type.Literal("diff"),provenance,completeness};
export const diffOutputSchema=Type.Union([
    object({...header,mode:enumOf(["file","revisions"]),ok:Type.Literal(true),data:comparison}),
    object({...header,mode:Type.Literal("workspace"),ok:Type.Literal(true),data:collection}),
    object({...header,mode:Type.Literal("workspace"),ok:Type.Literal(false),data:collection,error}),
    object({...header,mode:Type.Union([enumOf(["file","revisions","workspace"]),Type.Null()]),ok:Type.Literal(false),error}),
]);
export type DiffOutput=Static<typeof diffOutputSchema>;
export function validateDiffOutput(value:unknown):value is DiffOutput {
    if(!Check(diffOutputSchema,value)||Buffer.byteLength(JSON.stringify(value),"utf8")>131072)return false;
    const p=value as DiffOutput;
    const check=(c:Static<typeof comparison>)=>{
        if(c.kind==="revision-to-revision"&&(c.pendingKind!==null||c.left.origin!=="historical"||c.right.origin!=="historical"||c.left.identity!==null||c.right.identity!==null))return false;
        if(c.kind==="explicit-revision-to-local"&&(c.pendingKind!==null||c.left.origin!=="historical"||c.left.identity!==null||c.right.origin!=="local-snapshot"))return false;
        if(c.kind==="loaded-base-to-local"&&(["added","private"].includes(c.pendingKind??"")?c.left.origin!=="synthetic-empty":c.left.origin!=="historical"||c.left.identity===null))return false;
        for(const s of [c.left,c.right]){if(s.origin==="historical"&&(!s.selector||!validDiffRevisionsSelector(s.selector))||s.origin!=="historical"&&(s.selector!==null||s.identity!==null)||s.origin==="synthetic-empty"&&(s.bytes!==0||s.binary))return false;}
        const e=c.excerpt;if(e&&(e.text.length!==e.returnedChars||e.returnedChars!==e.sourceChars+e.markerChars||e.observedChars!==e.sourceChars+e.omittedChars||e.truncated!==(e.omittedChars>0)||e.markerChars!==(e.truncated?59:0)))return false;
        if(c.binary!==(c.left.binary||c.right.binary)||c.comparisonBasis!==(c.binary?"byte_equality":"diff_u")||(c.excerpt===null)!==c.binary)return false;
        if(c.status==="changed"&&(!c.changed||c.binary)||c.status==="binary-different"&&(!c.binary||!c.changed)||c.status==="unchanged"&&c.changed||c.status==="added-empty"&&(c.changed||c.pendingKind!=="added"||c.right.bytes))return false;
        return c.binary?c.hunkCount===0&&c.capture.diffExitCode===null&&c.capture.diffStdoutBytes===null:c.capture.diffExitCode===(c.changed?1:0)&&c.hunkCount>0===c.changed;
    };
    if("data"in p){if(p.mode==="workspace"){const c=p.data.counts;if(c.returned!==p.data.outcomes.length||c.returned+c.omitted!==c.selected-c.unattempted||c.completed+c.failed!==c.attempted||c.attempted+c.skipped+c.unattempted!==c.selected||c.selected+c.limited!==c.eligible||c.eligible>c.parsed||p.ok!==(c.failed===0&&c.unattempted===0)||!p.data.outcomes.every(o=>o.status!=="compared"||check(o.comparison)))return false;}else if(!check(p.data)||(p.mode==="revisions")!==(p.data.kind==="revision-to-revision")||p.completeness.read!=="complete"||p.completeness.capture!=="complete"||p.completeness.projection!==!p.data.excerpt?.truncated)return false;}
    return true;
}
export async function executeDiffOutput(args:unknown){
    let payload:unknown;
    try{payload=await assembleConsolidatedDiff(args);}catch(e){const mode=(args as {mode?:unknown})?.mode;payload={schemaVersion:1,action:"diff",mode:["file","revisions","workspace"].includes(String(mode))?mode:null,provenance:{source:"plastic",producer:"@aefree/pi-plastic",contentTrust:"external"},ok:false,completeness:{read:"incomplete",capture:"unknown",projection:false},error:diffError(e)};}
    if(!validateDiffOutput(payload))payload={schemaVersion:1,action:"diff",mode:null,provenance:{source:"plastic",producer:"@aefree/pi-plastic",contentTrust:"external"},ok:false,completeness:{read:"incomplete",capture:"unknown",projection:false},error:{code:"comparison_failed",stage:"producer",message:"The diff producer envelope could not be verified."}};
    const dto=payload as DiffOutput;
    const json=(args as {format?:unknown})?.format==="json";
    let text=JSON.stringify(dto);
    if(!json){
        if("data"in dto)text=dto.mode==="workspace"?"## Workspace Diff\n"+(dto.ok?"":"Partial failure: "+dto.error.code+"\n")+JSON.stringify(dto.data.counts)+"\nPrivate excluded: "+dto.data.excludedPrivate+"; unmatched paths: "+dto.data.unmatched.length+"\n"+dto.data.outcomes.map(o=>o.path+": "+o.status+(o.status==="compared"?"\n"+(o.comparison.excerpt?.text??o.comparison.status):o.status==="unavailable"?" ("+o.error.code+")":"")).join("\n\n"):"## Diff\n"+dto.data.status+"\n"+(dto.data.excerpt?.text??"");
        else text=dto.error.message;
    }
    if(text.length>24000)text=json?JSON.stringify({action:"diff",mode:dto.mode,ok:dto.ok,note:"Presentation omitted; use structuredContent for the bounded producer observation."}):text.slice(0,23920)+"\n[Presentation truncated; inspect the structured projection/completeness fields.]";
    return {content:[{type:"text" as const,text}],details:{},structuredContent:dto,isError:!dto.ok};
}
