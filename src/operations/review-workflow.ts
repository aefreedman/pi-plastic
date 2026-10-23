import { tool } from "../tool-definition";
import { workdirArg } from "./arguments";
import { outputFormatArg } from "../presentation/results";
import { captureWorkspaceMergeCommand, emptyWorkspaceMergeAttempt } from "../execution/workspace-merge-command";
import { validWriteOperand, validWriteText } from "./object-write-receipt";
import { OWN_REVIEW_STATUSES, REVIEW_WORKFLOW_ACTIONS, validReviewId, validReviewMembers, type ReviewWorkflowAction } from "../domain/review-workflow";
export { REVIEW_WORKFLOW_ACTIONS, type ReviewWorkflowAction } from "../domain/review-workflow";

type Common = {id:string;repository:string;workdir:string;preflight:boolean;output:"text"|"json"};
type Members = {users:string[]|null;groups:string[]|null};
export type ReviewWorkflowRequests = {
    "reviewer-add": Common & Members;
    "reviewer-remove": Common & Members;
    "reviewer-list": Common;
    "set-status": Common & {status:typeof OWN_REVIEW_STATUSES[number];comment:string|null;commentsFile:string|null};
    "request-review": Common & Members & {all:boolean};
};
export type ReviewWorkflowData = {
    requested:ReviewWorkflowRequests[ReviewWorkflowAction]|null;intendedArgv:string[];
    attempt:ReturnType<typeof emptyWorkspaceMergeAttempt>;
    capture:Awaited<ReturnType<typeof captureWorkspaceMergeCommand>>["capture"]|null;
    commandOutput:{kind:"opaque-command-output";text:string}|null;
    observedMembership:null;observedOwnStatus:null;observedRepositoryIdentity:null;
    scope:"requested-only";rollback:"not-proven";effect:"not-attempted"|"not-proven"|"uncertain";
};
export type ReviewWorkflowReceipt<A extends ReviewWorkflowAction=ReviewWorkflowAction> = {
    schemaVersion:1;action:A;provenance:{source:"plastic";producer:"@aefree/pi-plastic";contentTrust:"external"};
    completeness:{capture:"complete"|"incomplete"|"unknown";projection:true};
    data:ReviewWorkflowData & {requested:ReviewWorkflowRequests[A]|null};
} & ({ok:true;outcome:"preflight"|"command-completed"}|{ok:false;outcome:"failed"|"uncertain";error:{code:"invalid_request"|"launch_failed"|"aborted"|"uncertain"|"producer_failed";message:string}});
const keys={"reviewer-add":["users","groups"],"reviewer-remove":["users","groups"],"reviewer-list":[],"set-status":["status","comment","commentsFile"],"request-review":["all","users","groups"]} as const;
export function validReviewWorkflowRequest(a:ReviewWorkflowAction,r:ReviewWorkflowData["requested"]):boolean {
    if(!r||!validReviewId(r.id)||!validWriteOperand(r.repository)||!validWriteText(r.workdir)||typeof r.preflight!=="boolean"||!["text","json"].includes(r.output)||Buffer.byteLength(JSON.stringify(r),"utf8")>32768)return false;
    if(a==="reviewer-list")return true;
    if(a==="set-status") {
        const v=r as ReviewWorkflowRequests["set-status"];
        return OWN_REVIEW_STATUSES.includes(v.status)&&!(v.comment!==null&&v.commentsFile!==null)&&(v.comment===null||validWriteText(v.comment,true))&&(v.commentsFile===null||validWriteText(v.commentsFile)&&v.commentsFile!=="-");
    }
    const v=r as ReviewWorkflowRequests["request-review"];
    if(![v.users,v.groups].every(x=>x===null||validReviewMembers(x)))return false;
    const selected=v.users!==null||v.groups!==null;
    return a==="request-review"?typeof v.all==="boolean"&&(v.all?!selected:selected):selected;
}
export function reviewWorkflowPrefix(a:ReviewWorkflowAction):string[] {return a.startsWith("reviewer-")?["codereview","reviewer",a.slice(9)]:["codereview","review"];}
export function reviewWorkflowArgv(a:ReviewWorkflowAction,r:NonNullable<ReviewWorkflowData["requested"]>):string[] {
    const argv=[...reviewWorkflowPrefix(a),r.id],v=r as ReviewWorkflowRequests["request-review"] & ReviewWorkflowRequests["set-status"];
    if(a==="set-status") {argv.push(`--${v.status}`);if(v.comment!==null)argv.push(`-c=${v.comment}`);if(v.commentsFile!==null)argv.push(`-commentsfile=${v.commentsFile}`);}
    else if(a!=="reviewer-list") {if(a==="request-review")argv.push("--re-request");if(v.all)argv.push("--all");if(v.users)argv.push(`--users=${v.users.join(",")}`);if(v.groups)argv.push(`--groups=${v.groups.join(",")}`);}
    argv.push(`--repository=${r.repository}`);return argv;
}
export function emptyReviewWorkflowData(a:ReviewWorkflowAction):ReviewWorkflowData {return {requested:null,intendedArgv:reviewWorkflowPrefix(a),attempt:emptyWorkspaceMergeAttempt(),capture:null,commandOutput:null,observedMembership:null,observedOwnStatus:null,observedRepositoryIdentity:null,scope:"requested-only",rollback:"not-proven",effect:"not-attempted"};}
function header(a:ReviewWorkflowAction,d:ReviewWorkflowData) {return {schemaVersion:1 as const,action:a,provenance:{source:"plastic" as const,producer:"@aefree/pi-plastic" as const,contentTrust:"external" as const},completeness:{capture:d.capture?d.capture.complete?"complete" as const:"incomplete" as const:"unknown" as const,projection:true as const},data:d};}
export function reviewWorkflowFailure(a:ReviewWorkflowAction,d:ReviewWorkflowData,code:Extract<ReviewWorkflowReceipt,{ok:false}>["error"]["code"],message:string):ReviewWorkflowReceipt {return {...header(a,d),ok:false,outcome:["started","unknown"].includes(d.attempt.state)?"uncertain":"failed",error:{code,message}} as ReviewWorkflowReceipt;}
export async function assembleReviewWorkflowReceipt(a:ReviewWorkflowAction,args:unknown):Promise<ReviewWorkflowReceipt> {
    const d=emptyReviewWorkflowData(a);let entered=false;
    try {
        if(!REVIEW_WORKFLOW_ACTIONS.includes(a)||!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(k=>![...keys[a],"id","repository","workdir","preflight","output"].includes(k)))return reviewWorkflowFailure(a,d,"invalid_request","Use only the declared per-action review controls.");
        const i={...args} as Record<string,unknown>,r:any={};
        for(const k of ["id","repository","workdir","preflight","output",...keys[a]]) {
            if(i[k]===null)return reviewWorkflowFailure(a,d,"invalid_request","Explicit null controls are unsupported; omit optional controls.");
            r[k]=i[k]===undefined?k==="workdir"?process.cwd():["preflight","all"].includes(k)?false:k==="output"?"text":null:["users","groups"].includes(k)&&Array.isArray(i[k])&&(i[k] as unknown[]).length<=100?Array.from(i[k] as unknown[]):i[k];
        }
        if(!validReviewWorkflowRequest(a,r))return reviewWorkflowFailure(a,d,"invalid_request","Require exact review ID and repository, bounded unique comma-free user/group choices, explicit status and exclusive nonempty comment/file (not stdin).");
        d.requested=r;d.intendedArgv=reviewWorkflowArgv(a,r);
        if(r.preflight)return {...header(a,d),ok:true,outcome:"preflight"} as ReviewWorkflowReceipt;
        // Native own-status permits no comment without opening an editor. No add-comment command is inferred.
        entered=true;const o=await captureWorkspaceMergeCommand([...d.intendedArgv],r.workdir);d.attempt=o.attempt;d.capture=o.capture;
        const completed=o.capture.complete&&!o.failed&&o.attempt.state==="started"&&o.attempt.exitCode===0;
        if(completed) {d.commandOutput={kind:"opaque-command-output",text:o.stdout!};d.effect="not-proven";if(o.capture.stderrBytes===0)return {...header(a,d),ok:true,outcome:"command-completed"} as ReviewWorkflowReceipt;}
        d.effect=["started","unknown"].includes(d.attempt.state)?"uncertain":"not-attempted";
        return reviewWorkflowFailure(a,d,o.attempt.aborted?"aborted":["started","unknown"].includes(d.attempt.state)?"uncertain":"launch_failed","Review command completion not admitted; partial effects may exist. No automatic retry or rollback.");
    } catch {
        if(entered&&d.capture===null){d.attempt.state="unknown";d.effect="uncertain";}
        return reviewWorkflowFailure(a,d,"producer_failed","Review observation failed; earlier effects may exist. No automatic retry or rollback.");
    }
}
export function presentReviewWorkflowReceipt(d:ReviewWorkflowReceipt):string {
    if(d.data.requested?.output==="json")return JSON.stringify(d);
    if(!d.ok)return `${d.action} ${d.outcome}: ${d.error.message} Effect: ${d.data.effect}.`;
    if(d.outcome==="preflight")return `${d.action} command-only preview (not executed): ${JSON.stringify(d.data.intendedArgv)}. No SCM/state analysis.`;
    return `${d.action} command completed. Membership, own status, stored text and repository identity remain unverified; no atomicity or rollback proven.\n${d.data.commandOutput?.text??""}`;
}
const common={id:tool.schema.string().min(1).describe("Exact numeric review ID or GUID."),repository:tool.schema.string().min(1).describe("Explicit repository specification."),preflight:tool.schema.boolean().optional().describe("Zero-command preview only."),output:outputFormatArg,workdir:workdirArg};
const members=()=>({users:tool.schema.array(tool.schema.string()).min(1).max(100).optional().describe("Unique exact comma-free native users; me supported."),groups:tool.schema.array(tool.schema.string()).min(1).max(100).optional().describe("Unique exact comma-free native reviewer groups.")});
function execute(a:ReviewWorkflowAction) {return async(args:unknown)=>{const dto=await assembleReviewWorkflowReceipt(a,args);const text=presentReviewWorkflowReceipt(dto);if(!dto.ok)throw Error(text);return text;};}
export const codeReviewReviewerAdd=tool({description:"Add explicitly selected reviewers; existing reviewers are kept.",args:{...common,...members()},execute:execute("reviewer-add")});
export const codeReviewReviewerRemove=tool({description:"Remove only explicitly selected reviewers.",args:{...common,...members()},execute:execute("reviewer-remove")});
export const codeReviewReviewerList=tool({description:"Read bounded opaque native reviewer evidence; no parsed membership or identity guarantee.",args:{...common},execute:execute("reviewer-list")});
export const codeReviewSetStatus=tool({description:"Set caller own review status, not assignee status. Optional explicit status comment only.",args:{...common,status:tool.schema.enum(OWN_REVIEW_STATUSES),comment:tool.schema.string().min(1).optional(),commentsFile:tool.schema.string().min(1).optional()},execute:execute("set-status")});
export const codeReviewRequestReview=tool({description:"Explicitly re-request all OR selected users/groups. Never attaches a comment.",args:{...common,...members(),all:tool.schema.boolean().optional()},execute:execute("request-review")});
