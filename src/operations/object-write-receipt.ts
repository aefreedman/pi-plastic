import { captureWorkspaceMergeCommand, emptyWorkspaceMergeAttempt } from "../execution/workspace-merge-command";

export const OBJECT_WRITE_ACTIONS = ["shelveset-create", "shelveset-apply", "code-review-create", "code-review-update"] as const;
export type ObjectWriteAction = typeof OBJECT_WRITE_ACTIONS[number];
type Common = { workdir: string; preflight: boolean; output: "text"|"json" };
export type ObjectWriteRequests = {
    "shelveset-create": Common & { paths: string[]|null; comment: string|null; commentsFile: string|null; all: boolean; dependencies: boolean; summaryFormat: boolean };
    "shelveset-apply": Common & { shelveset: string; changePaths: string[]|null; preview: boolean; dontCheckout: boolean; comparisonMethod: string|null };
    "code-review-create": Common & { target: string; title: string; status: string|null; assignee: string|null; repository: string|null; format: string|null };
    "code-review-update": Common & { id: string; status: string|null; assignee: string|null; repository: string|null };
};
export type ObjectWriteRequest = ObjectWriteRequests[ObjectWriteAction];
export type EmittedObjectIdentity = { kind: "shelveset"|"code-review"; value: string; basis: "default-scalar"|"summary-scalar" };
export type ObjectWriteData = {
    requested: ObjectWriteRequest|null; intendedArgv: string[];
    attempt: ReturnType<typeof emptyWorkspaceMergeAttempt>;
    capture: Awaited<ReturnType<typeof captureWorkspaceMergeCommand>>["capture"]|null;
    commandOutput: { kind: "opaque-command-output"; text: string }|null;
    observedCreatedIdentity: EmittedObjectIdentity|null;
    observedAppliedItems: null; observedUpdatedState: null; observedRepositoryIdentity: null;
    scope: "requested-only"; rollback: "not-proven";
    effect: "not-attempted"|"not-proven"|"identity-emitted"|"uncertain";
};
export type ObjectWriteReceipt<A extends ObjectWriteAction=ObjectWriteAction> = {
    schemaVersion:1; action:A; provenance:{source:"plastic";producer:"@aefree/pi-plastic";contentTrust:"external"};
    completeness:{capture:"complete"|"incomplete"|"unknown";projection:true};
    data: ObjectWriteData & {requested:ObjectWriteRequests[A]|null};
} & ({ok:true;outcome:"preflight"|"command-completed"}|{ok:false;outcome:"failed"|"uncertain";error:{code:"invalid_request"|"editor_configured"|"launch_failed"|"aborted"|"uncertain"|"producer_failed";message:string}});
const keys = {
    "shelveset-create": ["paths","comment","commentsFile","all","dependencies","summaryFormat"],
    "shelveset-apply": ["shelveset","changePaths","preview","dontCheckout","comparisonMethod"],
    "code-review-create": ["target","title","status","assignee","repository","format"],
    "code-review-update": ["id","status","assignee","repository"],
} as const;
const comparisons=["ignoreeol","ignorewhitespaces","ignoreeolandwhitespaces","recognizeall"];
export function validWriteText(v:unknown, multiline=false, empty=false):v is string {
    return typeof v==="string"&&v.length<=4096&&(empty||v.trim().length>0)&&!(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/:/[\u0000-\u001f\u007f-\u009f]/).test(v)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
}
export function validWriteOperand(v:unknown):v is string {return validWriteText(v)&&!v.trimStart().startsWith("-");}
export function validWritePaths(v:unknown):v is string[] {return Array.isArray(v)&&v.length<=256&&Array.from(v).every(validWriteOperand)&&Buffer.byteLength(JSON.stringify(v),"utf8")<=32768;}
export function validObjectWriteRequest(a:ObjectWriteAction,r:ObjectWriteRequest):boolean {
    if(!validWriteText(r.workdir)||typeof r.preflight!=="boolean"||!["text","json"].includes(r.output)||Buffer.byteLength(JSON.stringify(r),"utf8")>32768)return false;
    const v=r as unknown as Record<string,unknown>;
    if(a==="shelveset-create")return (v.paths===null||validWritePaths(v.paths))&&(v.comment===null||validWriteText(v.comment,true))&&(v.commentsFile===null||validWriteText(v.commentsFile))&&!(v.comment!==null&&v.commentsFile!==null)&&[v.all,v.dependencies,v.summaryFormat].every(x=>typeof x==="boolean");
    if(a==="shelveset-apply")return validWriteOperand(v.shelveset)&&(v.changePaths===null||validWritePaths(v.changePaths))&&[v.preview,v.dontCheckout].every(x=>typeof x==="boolean")&&(v.comparisonMethod===null||comparisons.includes(v.comparisonMethod as string));
    if(![v.status,v.assignee,v.repository].every(x=>x===null||validWriteText(x,false,true)))return false;
    return a==="code-review-create"?validWriteOperand(v.target)&&validWriteOperand(v.title)&&(v.format===null||validWriteText(v.format,true,true)):validWriteOperand(v.id);
}
export function objectWritePrefix(a:ObjectWriteAction) {return a==="shelveset-create"?["shelveset","create"]:a==="shelveset-apply"?["shelveset","apply"]:a==="code-review-create"?["codereview"]:["codereview","-e"];}
export function objectWriteArgv(a:ObjectWriteAction,r:ObjectWriteRequest):string[] {
    const v=r as any,argv=objectWritePrefix(a);
    if(a==="shelveset-create") {
        argv.push(...(v.paths??[]));if(v.all)argv.push("--all");if(v.dependencies)argv.push("--dependencies");if(v.summaryFormat)argv.push("--summaryformat");if(v.comment!==null)argv.push(`-c=${v.comment}`);if(v.commentsFile!==null)argv.push(`-commentsfile=${v.commentsFile}`);
    } else if(a==="shelveset-apply") {
        argv.push(v.shelveset,...(v.changePaths??[]));if(v.preview)argv.push("--preview");if(v.dontCheckout)argv.push("--dontcheckout");if(v.comparisonMethod!==null)argv.push(`--comparisonmethod=${v.comparisonMethod}`);
    } else {
        argv.push(...(a==="code-review-create"?[v.target,v.title]:[v.id]));if(v.status)argv.push(`--status=${v.status}`);if(v.assignee)argv.push(`--assignee=${v.assignee}`);if(v.repository)argv.push(`--repository=${v.repository}`);if(a==="code-review-create"&&v.format)argv.push(`--format=${v.format}`);
    }
    return argv;
}
export function parseObjectWriteIdentity(a:ObjectWriteAction,r:ObjectWriteRequest,stdout:string):EmittedObjectIdentity|null {
    const line=stdout.replace(/\r?\n$/,""); // One emitted scalar, not a match buried in diagnostic text.
    if(!validWriteText(line)||line!==line.trim())return null;
    if(a==="shelveset-create"&&/^sh:[1-9][0-9]*@[^@\r\n]+@[^@\r\n]+(?:@(cloud|unity))?$/.test(line))return {kind:"shelveset",value:line,basis:(r as ObjectWriteRequests["shelveset-create"]).summaryFormat?"summary-scalar":"default-scalar"};
    if(a==="code-review-create"&&!(r as ObjectWriteRequests["code-review-create"]).format&&/^(?:[1-9][0-9]*|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(line))return {kind:"code-review",value:line,basis:"default-scalar"};
    return null; // Custom creation formatting and apply/update progress are opaque, never identity/state.
}
export function emptyObjectWriteData(a:ObjectWriteAction):ObjectWriteData {return {requested:null,intendedArgv:objectWritePrefix(a),attempt:emptyWorkspaceMergeAttempt(),capture:null,commandOutput:null,observedCreatedIdentity:null,observedAppliedItems:null,observedUpdatedState:null,observedRepositoryIdentity:null,scope:"requested-only",rollback:"not-proven",effect:"not-attempted"};}
function header(a:ObjectWriteAction,d:ObjectWriteData) {return {schemaVersion:1 as const,action:a,provenance:{source:"plastic" as const,producer:"@aefree/pi-plastic" as const,contentTrust:"external" as const},completeness:{capture:d.capture?d.capture.complete?"complete" as const:"incomplete" as const:"unknown" as const,projection:true as const},data:d};}
export function objectWriteFailure(a:ObjectWriteAction,d:ObjectWriteData,code:Extract<ObjectWriteReceipt,{ok:false}>["error"]["code"],message:string):ObjectWriteReceipt {return {...header(a,d),ok:false,outcome:["started","unknown"].includes(d.attempt.state)?"uncertain":"failed",error:{code,message}} as ObjectWriteReceipt;}
export async function assembleObjectWriteReceipt(a:ObjectWriteAction,args:unknown):Promise<ObjectWriteReceipt> {
    const d=emptyObjectWriteData(a);let entered=false;
    try {
        if(!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(k=>![...keys[a],"workdir","preflight","output"].includes(k)))return objectWriteFailure(a,d,"invalid_request","Use only declared bounded object-write controls.");
        const i={...args} as Record<string,unknown>,r:any={workdir:i.workdir===undefined?process.cwd():i.workdir,preflight:i.preflight===undefined?false:i.preflight,output:i.output===undefined?"text":i.output};
        for(const k of keys[a]) {
            if(Object.hasOwn(i,k)&&i[k]===null)return objectWriteFailure(a,d,"invalid_request","Explicit null controls are unsupported; omit optional controls.");
            const v=i[k];r[k]=v===undefined?(["all","dependencies","summaryFormat","preview","dontCheckout"].includes(k)?false:null):["paths","changePaths"].includes(k)&&Array.isArray(v)&&v.length<=256?Array.from(v):v;
        }
        if(!validObjectWriteRequest(a,r))return objectWriteFailure(a,d,"invalid_request","Use exact non-option operands, bounded lists/text, exclusive comments, strict booleans and declared output/comparison modes.");
        d.requested=r;d.intendedArgv=objectWriteArgv(a,r);
        if(r.preflight)return {...header(a,d),ok:true,outcome:"preflight"} as ObjectWriteReceipt;
        if(a==="shelveset-create"&&r.comment===null&&r.commentsFile===null&&process.env.PLASTICEDITOR?.trim())return objectWriteFailure(a,d,"editor_configured","Comment-less creation with PLASTICEDITOR configured could launch an editor. Supply comment/commentsFile; no environment override or dispatch.");
        entered=true;const o=await captureWorkspaceMergeCommand([...d.intendedArgv],r.workdir);d.attempt=o.attempt;d.capture=o.capture;
        const completed=o.capture.complete&&!o.failed&&o.attempt.state==="started"&&o.attempt.exitCode===0;
        if(completed) {
            d.commandOutput={kind:"opaque-command-output",text:o.stdout!};d.observedCreatedIdentity=parseObjectWriteIdentity(a,r,o.stdout!);
            d.effect=d.observedCreatedIdentity?"identity-emitted":"not-proven";
            if(o.capture.stderrBytes===0)return {...header(a,d),ok:true,outcome:"command-completed"} as ObjectWriteReceipt;
            if(!d.observedCreatedIdentity)d.effect="uncertain";
        } else d.effect=["started","unknown"].includes(d.attempt.state)?"uncertain":"not-attempted";
        return objectWriteFailure(a,d,o.attempt.aborted?"aborted":["started","unknown"].includes(d.attempt.state)?"uncertain":"launch_failed","Object-write completion/state is not admitted. Earlier emitted identities remain recorded; no automatic retry, conflict choice or rollback.");
    } catch {
        if(entered&&d.capture===null){d.attempt={...emptyWorkspaceMergeAttempt(),state:"unknown"};d.effect="uncertain";}
        return objectWriteFailure(a,d,"producer_failed","Object-write observation failed. Earlier possible/emitted effects remain; no automatic recovery or retry.");
    }
}
export function presentObjectWriteReceipt(d:ObjectWriteReceipt):string {
    if(d.data.requested?.output==="json")return JSON.stringify(d);
    const identity=d.data.observedCreatedIdentity?` Emitted ${d.data.observedCreatedIdentity.kind}: ${d.data.observedCreatedIdentity.value}.`:"";
    if(!d.ok)return `${d.action} ${d.outcome}: ${d.error.message} Effect: ${d.data.effect}.${identity}`;
    if(d.outcome==="preflight")return `${d.action} command-only preview (not executed): ${JSON.stringify(d.data.intendedArgv)}. No existence/conflict/state analysis.`;
    const opaque=d.data.commandOutput?.text?`\n${d.data.commandOutput.text}`:"";
    return `${d.action} command completed.${identity} Applied items, requested review state, repository scope and rollback remain unverified.${opaque}`;
}
