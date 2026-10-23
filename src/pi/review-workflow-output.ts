import { Type } from "typebox";
import { Check } from "typebox/value";
import { assembleReviewWorkflowReceipt, emptyReviewWorkflowData, reviewWorkflowFailure, reviewWorkflowArgv, reviewWorkflowPrefix, presentReviewWorkflowReceipt, validReviewWorkflowRequest, REVIEW_WORKFLOW_ACTIONS, type ReviewWorkflowAction, type ReviewWorkflowReceipt } from "../operations/review-workflow";
import { validWriteText } from "../operations/object-write-receipt";
const obj=(p:Record<string,any>)=>Type.Object(p,{additionalProperties:false}),enm=(v:readonly string[])=>Type.Union(v.map(x=>Type.Literal(x))),nil=(s:any)=>Type.Union([s,Type.Null()]),uint=(max=Number.MAX_SAFE_INTEGER)=>Type.Integer({minimum:0,maximum:max}),text=Type.String({minLength:1,maxLength:4096});
const common={id:text,repository:text,workdir:text,preflight:Type.Boolean(),output:enm(["text","json"])},members={users:nil(Type.Array(text,{minItems:1,maxItems:100,uniqueItems:true})),groups:nil(Type.Array(text,{minItems:1,maxItems:100,uniqueItems:true}))};
const requests={"reviewer-add":obj({...common,...members}),"reviewer-remove":obj({...common,...members}),"reviewer-list":obj(common),"set-status":obj({...common,status:enm(["reviewed","rework-required","under-review"]),comment:nil(text),commentsFile:nil(text)}),"request-review":obj({...common,...members,all:Type.Boolean()})};
const attempt=obj({state:enm(["not-attempted","not-started","started","unknown"]),terminal:enm(["not-observed","observed"]),exitCode:nil(uint(2147483647)),aborted:Type.Boolean(),timedOut:Type.Boolean()}),capture=obj({stdoutBytes:uint(),stderrBytes:uint(),stdoutRetainedBytes:uint(65536),stderrRetainedBytes:uint(16384),truncated:Type.Boolean(),complete:Type.Boolean(),validUtf8:Type.Boolean()});
function schema<A extends ReviewWorkflowAction>(action:A) {
    const data=obj({requested:nil(requests[action]),intendedArgv:Type.Array(Type.String({maxLength:8192}),{minItems:1,maxItems:263}),attempt,capture:nil(capture),commandOutput:nil(obj({kind:Type.Literal("opaque-command-output"),text:Type.String({maxLength:65536})})),observedMembership:Type.Null(),observedOwnStatus:Type.Null(),observedRepositoryIdentity:Type.Null(),scope:Type.Literal("requested-only"),rollback:Type.Literal("not-proven"),effect:enm(["not-attempted","not-proven","uncertain"])});
    const header={schemaVersion:Type.Literal(1),action:Type.Literal(action),provenance:obj({source:Type.Literal("plastic"),producer:Type.Literal("@aefree/pi-plastic"),contentTrust:Type.Literal("external")}),completeness:obj({capture:enm(["complete","incomplete","unknown"]),projection:Type.Literal(true)}),data};
    return Type.Unsafe<ReviewWorkflowReceipt<A>>(Type.Union([obj({...header,ok:Type.Literal(true),outcome:enm(["preflight","command-completed"])}),obj({...header,ok:Type.Literal(false),outcome:enm(["failed","uncertain"]),error:obj({code:enm(["invalid_request","launch_failed","aborted","uncertain","producer_failed"]),message:Type.String({minLength:1,maxLength:256})})})]));
}
export const codeReviewReviewerAddOutputSchema=schema("reviewer-add"),codeReviewReviewerRemoveOutputSchema=schema("reviewer-remove"),codeReviewReviewerListOutputSchema=schema("reviewer-list"),codeReviewSetStatusOutputSchema=schema("set-status"),codeReviewRequestReviewOutputSchema=schema("request-review");
export const reviewWorkflowSchemas={"reviewer-add":codeReviewReviewerAddOutputSchema,"reviewer-remove":codeReviewReviewerRemoveOutputSchema,"reviewer-list":codeReviewReviewerListOutputSchema,"set-status":codeReviewSetStatusOutputSchema,"request-review":codeReviewRequestReviewOutputSchema};
export function validateReviewWorkflowOutput(v:unknown):v is ReviewWorkflowReceipt {
    if(!v||typeof v!=="object")return false;const dto=v as ReviewWorkflowReceipt;
    if(!REVIEW_WORKFLOW_ACTIONS.includes(dto.action)||!Check(reviewWorkflowSchemas[dto.action],v)||Buffer.byteLength(JSON.stringify(v),"utf8")>524288)return false;
    const d=dto.data,r=d.requested,a=d.attempt,c=d.capture,o=d.commandOutput;
    if(dto.completeness.capture!==(c?c.complete?"complete":"incomplete":"unknown"))return false;
    if(r===null) {if(JSON.stringify(d.intendedArgv)!==JSON.stringify(reviewWorkflowPrefix(dto.action))||c||o||a.terminal!=="not-observed"||a.exitCode!==null||a.aborted||a.timedOut||!["not-attempted","unknown"].includes(a.state)||dto.ok)return false;}
    else if(!validReviewWorkflowRequest(dto.action,r)||JSON.stringify(d.intendedArgv)!==JSON.stringify(reviewWorkflowArgv(dto.action,r)))return false;
    if(a.exitCode!==null&&a.terminal!=="observed"||["not-attempted","not-started"].includes(a.state)&&(a.terminal!=="not-observed"||a.exitCode!==null)||a.state==="not-attempted"&&a.timedOut)return false;
    if(c) {
        if(!r||c.stdoutRetainedBytes>c.stdoutBytes||c.stderrRetainedBytes>c.stderrBytes)return false;
        if(c.truncated!==(c.stdoutBytes>65536||c.stderrBytes>16384))return false;
        if(c.complete&&(!c.validUtf8||c.truncated||c.stdoutBytes!==c.stdoutRetainedBytes||c.stderrBytes!==c.stderrRetainedBytes||a.state!=="started"||a.terminal!=="observed"||a.exitCode===null||a.aborted||a.timedOut))return false;
        if(a.state==="not-attempted"&&(!a.aborted||c.stdoutBytes||c.stderrBytes||c.validUtf8||c.complete))return false;
    }
    const completed=!!c?.complete&&a.state==="started"&&a.exitCode===0;
    if(o!==null) {if(!r||!completed||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(o.text)||Buffer.byteLength(o.text,"utf8")!==c!.stdoutBytes)return false;}
    else if(completed)return false;
    if(d.effect!==(dto.ok&&dto.outcome==="command-completed"?"not-proven":["started","unknown"].includes(a.state)?"uncertain":"not-attempted"))return false;
    if(r?.preflight)return dto.ok&&dto.outcome==="preflight"&&a.state==="not-attempted"&&a.terminal==="not-observed"&&a.exitCode===null&&!a.aborted&&!a.timedOut&&!c&&!o;
    if(dto.ok)return dto.outcome==="command-completed"&&r!==null&&!r.preflight&&completed&&c!.stderrBytes===0;
    if(dto.outcome!==(["started","unknown"].includes(a.state)?"uncertain":"failed")||!validWriteText(dto.error.message))return false;
    if(completed&&c!.stderrBytes===0)return false;
    if(dto.error.code==="invalid_request"&&(r!==null||c||a.state!=="not-attempted"||a.aborted)||dto.error.code==="aborted"&&!a.aborted||dto.error.code==="launch_failed"&&!["not-attempted","not-started"].includes(a.state)||dto.error.code==="uncertain"&&!['started','unknown'].includes(a.state))return false;
    return true;
}
export async function executeReviewWorkflowOutput(a:ReviewWorkflowAction,args:unknown) {
    let dto=await assembleReviewWorkflowReceipt(a,args);
    if(!validateReviewWorkflowOutput(dto)||dto.action!==a) {
        const d=emptyReviewWorkflowData(a);d.attempt.state="unknown";d.effect="uncertain";
        dto=reviewWorkflowFailure(a,d,"producer_failed","Review-workflow receipt invalid; earlier review command effects may exist. No automatic retry or verification.");
        if(!validateReviewWorkflowOutput(dto))throw Error("Safe review-workflow receipt unavailable; earlier effects may exist.");
    }
    return {content:[{type:"text" as const,text:presentReviewWorkflowReceipt(dto)}],details:{},structuredContent:dto,isError:!dto.ok};
}
