import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleObjectWriteReceipt, emptyObjectWriteData, objectWriteFailure, objectWriteArgv, objectWritePrefix, parseObjectWriteIdentity, presentObjectWriteReceipt, validObjectWriteRequest, validWriteText, OBJECT_WRITE_ACTIONS, type ObjectWriteAction, type ObjectWriteReceipt } from "../operations/object-write-receipt";
const obj=(p:Record<string,any>)=>Type.Object(p,{additionalProperties:false}),enm=(v:readonly string[])=>Type.Union(v.map(x=>Type.Literal(x))),nil=(s:any)=>Type.Union([s,Type.Null()]),uint=(max=Number.MAX_SAFE_INTEGER)=>Type.Integer({minimum:0,maximum:max}),text=Type.String({minLength:1,maxLength:4096}),optionalText=nil(Type.String({maxLength:4096}));
const common={workdir:text,preflight:Type.Boolean(),output:enm(["text","json"])},paths=nil(Type.Array(text,{maxItems:256}));
const requests={
    "shelveset-create":obj({...common,paths,comment:optionalText,commentsFile:optionalText,all:Type.Boolean(),dependencies:Type.Boolean(),summaryFormat:Type.Boolean()}),
    "shelveset-apply":obj({...common,shelveset:text,changePaths:paths,preview:Type.Boolean(),dontCheckout:Type.Boolean(),comparisonMethod:nil(enm(["ignoreeol","ignorewhitespaces","ignoreeolandwhitespaces","recognizeall"]))}),
    "code-review-create":obj({...common,target:text,title:text,status:optionalText,assignee:optionalText,repository:optionalText,format:optionalText}),
    "code-review-update":obj({...common,id:text,status:optionalText,assignee:optionalText,repository:optionalText}),
};
const attempt=obj({state:enm(["not-attempted","not-started","started","unknown"]),terminal:enm(["not-observed","observed"]),exitCode:nil(uint(2147483647)),aborted:Type.Boolean(),timedOut:Type.Boolean()}),capture=obj({stdoutBytes:uint(),stderrBytes:uint(),stdoutRetainedBytes:uint(65536),stderrRetainedBytes:uint(16384),truncated:Type.Boolean(),complete:Type.Boolean(),validUtf8:Type.Boolean()});
function schema<A extends ObjectWriteAction>(action:A) {
    const data=obj({requested:nil(requests[action]),intendedArgv:Type.Array(Type.String({minLength:1,maxLength:8192}),{minItems:1,maxItems:263}),attempt,capture:nil(capture),commandOutput:nil(obj({kind:Type.Literal("opaque-command-output"),text:Type.String({maxLength:65536})})),observedCreatedIdentity:nil(obj({kind:enm(["shelveset","code-review"]),value:text,basis:enm(["default-scalar","summary-scalar"])})),observedAppliedItems:Type.Null(),observedUpdatedState:Type.Null(),observedRepositoryIdentity:Type.Null(),scope:Type.Literal("requested-only"),rollback:Type.Literal("not-proven"),effect:enm(["not-attempted","not-proven","identity-emitted","uncertain"])});
    const header={schemaVersion:Type.Literal(1),action:Type.Literal(action),provenance:obj({source:Type.Literal("plastic"),producer:Type.Literal("@aefree/pi-plastic"),contentTrust:Type.Literal("external")}),completeness:obj({capture:enm(["complete","incomplete","unknown"]),projection:Type.Literal(true)}),data};
    return Type.Unsafe<ObjectWriteReceipt<A>>(Type.Union([obj({...header,ok:Type.Literal(true),outcome:enm(["preflight","command-completed"])}),obj({...header,ok:Type.Literal(false),outcome:enm(["failed","uncertain"]),error:obj({code:enm(["invalid_request","editor_configured","launch_failed","aborted","uncertain","producer_failed"]),message:Type.String({minLength:1,maxLength:256})})})]));
}
export const shelvesetCreateOutputSchema=schema("shelveset-create"),shelvesetApplyOutputSchema=schema("shelveset-apply"),codeReviewCreateOutputSchema=schema("code-review-create"),codeReviewUpdateOutputSchema=schema("code-review-update");
export const objectWriteSchemas={"shelveset-create":shelvesetCreateOutputSchema,"shelveset-apply":shelvesetApplyOutputSchema,"code-review-create":codeReviewCreateOutputSchema,"code-review-update":codeReviewUpdateOutputSchema};
export function validateObjectWriteOutput(v:unknown):v is ObjectWriteReceipt {
    if(!v||typeof v!=="object")return false;const dto=v as ObjectWriteReceipt;
    if(!OBJECT_WRITE_ACTIONS.includes(dto.action)||!Check(objectWriteSchemas[dto.action],v)||Buffer.byteLength(JSON.stringify(v),"utf8")>524288)return false;
    const d=dto.data,r=d.requested,a=d.attempt,c=d.capture,o=d.commandOutput,id=d.observedCreatedIdentity;
    if(dto.completeness.capture!==(c?c.complete?"complete":"incomplete":"unknown"))return false;
    if(r===null) {if(JSON.stringify(d.intendedArgv)!==JSON.stringify(objectWritePrefix(dto.action))||c||o||id||a.terminal!=="not-observed"||a.exitCode!==null||a.aborted||a.timedOut||!["not-attempted","unknown"].includes(a.state)||dto.ok)return false;}
    else if(!validObjectWriteRequest(dto.action,r)||JSON.stringify(d.intendedArgv)!==JSON.stringify(objectWriteArgv(dto.action,r)))return false;
    if(a.exitCode!==null&&a.terminal!=="observed"||["not-attempted","not-started"].includes(a.state)&&(a.terminal!=="not-observed"||a.exitCode!==null)||a.state==="not-attempted"&&a.timedOut)return false;
    if(c) {
        if(!r||c.stdoutRetainedBytes>c.stdoutBytes||c.stderrRetainedBytes>c.stderrBytes)return false;
        if(c.truncated!==(c.stdoutBytes>65536||c.stderrBytes>16384))return false;
        if(c.complete&&(!c.validUtf8||c.truncated||c.stdoutBytes!==c.stdoutRetainedBytes||c.stderrBytes!==c.stderrRetainedBytes||a.state!=="started"||a.terminal!=="observed"||a.exitCode===null||a.aborted||a.timedOut))return false;
        if(a.state==="not-attempted"&&(!a.aborted||c.stdoutBytes||c.stderrBytes||c.validUtf8||c.complete))return false;
    }
    const completed=!!c?.complete&&a.state==="started"&&a.exitCode===0;
    if(o!==null) {if(!r||!completed||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(o.text)||Buffer.byteLength(o.text,"utf8")!==c!.stdoutBytes||JSON.stringify(id)!==JSON.stringify(parseObjectWriteIdentity(dto.action,r,o.text)))return false;}
    else if(id!==null||completed)return false;
    if(d.effect!==(id?"identity-emitted":dto.ok&&dto.outcome==="command-completed"?"not-proven":["started","unknown"].includes(a.state)?"uncertain":"not-attempted"))return false;
    if(r?.preflight)return dto.ok&&dto.outcome==="preflight"&&a.state==="not-attempted"&&a.terminal==="not-observed"&&a.exitCode===null&&!a.aborted&&!a.timedOut&&!c&&!o&&!id;
    if(dto.ok)return dto.outcome==="command-completed"&&r!==null&&!r.preflight&&completed&&c!.stderrBytes===0;
    if(dto.outcome!==(["started","unknown"].includes(a.state)?"uncertain":"failed")||!validWriteText(dto.error.message))return false;
    if(completed&&c!.stderrBytes===0)return false;
    if(dto.error.code==="invalid_request"&&(r!==null||c||a.state!=="not-attempted"||a.aborted)||dto.error.code==="aborted"&&!a.aborted||dto.error.code==="launch_failed"&&!["not-attempted","not-started"].includes(a.state)||dto.error.code==="uncertain"&&!['started','unknown'].includes(a.state))return false;
    if(dto.error.code==="editor_configured"&&(dto.action!=="shelveset-create"||r===null||(r as any).comment!==null||(r as any).commentsFile!==null||a.state!=="not-attempted"||c||o||id))return false;
    return true;
}
export async function executeObjectWriteOutput(a:ObjectWriteAction,args:unknown) {
    let dto=await assembleObjectWriteReceipt(a,args);
    if(!validateObjectWriteOutput(dto)||dto.action!==a) {
        const d=emptyObjectWriteData(a);d.attempt.state="unknown";d.effect="uncertain";
        dto=objectWriteFailure(a,d,"producer_failed","Object-write receipt invalid; earlier creation/application/update effects may exist. No automatic retry or verification.");
        if(!validateObjectWriteOutput(dto))throw Error("Safe object-write receipt unavailable; earlier effects may exist.");
    }
    return {content:[{type:"text" as const,text:presentObjectWriteReceipt(dto)}],details:{},structuredContent:dto,isError:!dto.ok};
}
