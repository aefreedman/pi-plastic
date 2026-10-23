import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal } from "../src/execution/context";
import { executeReviewWorkflowOutput, validateReviewWorkflowOutput, reviewWorkflowSchemas } from "../src/pi/review-workflow-output";
import { REVIEW_WORKFLOW_ACTIONS, codeReviewReviewerAdd, codeReviewReviewerRemove, codeReviewReviewerList, codeReviewSetStatus, codeReviewRequestReview, type ReviewWorkflowAction } from "../src/operations/review-workflow";
import { executeObjectWriteOutput, validateObjectWriteOutput } from "../src/pi/object-write-output";
const repository="synthetic-repository@synthetic-org@unity",base={id:"1110",repository,workdir:process.cwd()};
const requests={"reviewer-add":{...base,users:["me"]},"reviewer-remove":{...base,groups:["Developers"]},"reviewer-list":base,"set-status":{...base,status:"reviewed",comment:"Reviewed café Ω\nexplicit comment"},"request-review":{...base,users:["me"]}};
const core={"reviewer-add":codeReviewReviewerAdd,"reviewer-remove":codeReviewReviewerRemove,"reviewer-list":codeReviewReviewerList,"set-status":codeReviewSetStatus,"request-review":codeReviewRequestReview};
const calls:string[][]=[];
type Reply={out?:string|Buffer;err?:string|Buffer;code?:number;start?:boolean;launch?:boolean;mutate?:()=>void};
function deps(reply:Reply={}) {return {spawn:((_:string,argv:string[],options:any)=>{calls.push([...argv]);assert.equal(options.shell,false);assert.deepEqual(options.stdio,["ignore","pipe","pipe"]);if(reply.launch)throw Error("PRIVATE");const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>false});queueMicrotask(()=>{if(reply.start!==false)child.emit("spawn");reply.mutate?.();child.stdout.end(reply.out??"");child.stderr.end(reply.err??"");child.emit("close",reply.code??0,null);});return child;}) as any};}
async function invoke(a:ReviewWorkflowAction,args:unknown,reply:Reply={}) {calls.length=0;const r=await runWithAbortSignal(undefined,()=>executeReviewWorkflowOutput(a,args),deps(reply));assert(validateReviewWorkflowOutput(r.structuredContent),JSON.stringify(r));assert.deepEqual(r.details,{});return r;}
async function invalid(a:ReviewWorkflowAction,args:unknown) {const r=await invoke(a,args);assert(r.isError,JSON.stringify(args));assert.equal(calls.length,0);assert.equal(r.structuredContent.data.requested,null);}
for(const action of REVIEW_WORKFLOW_ACTIONS) {
    assert(reviewWorkflowSchemas[action]);
    const request=requests[action];
    for(const input of [null,[],{}, {...request,id:"0"},{...request,id:"7junk"},{...request,id:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeZ"},{...request,id:"--all"},{...request,repository:undefined},{...request,repository:""},{...request,repository:"--server"},{...request,id:null},{...request,preflight:"true"},{...request,output:"xml"},{...request,extra:true},{...request,workdir:"bad\npath"}])await invalid(action,input);
    for(const output of ["text","json"]) {const r=await invoke(action,{...request,preflight:true,output});assert(!r.isError);assert.equal(calls.length,0);assert.equal(r.structuredContent.outcome,"preflight");assert.equal(r.structuredContent.data.commandOutput,null);}
    const success=await invoke(action,request,{out:"opaque café\r\n"});assert(!success.isError);assert.equal(calls.length,1);assert.equal(success.structuredContent.data.observedMembership,null);assert.equal(success.structuredContent.data.observedOwnStatus,null);assert.equal(success.structuredContent.data.observedRepositoryIdentity,null);assert.equal(success.structuredContent.data.effect,"not-proven");
    for(const change of [(d:any)=>d.data.requested.id="bad",(d:any)=>d.data.intendedArgv.push("--all"),(d:any)=>d.data.observedMembership=[],(d:any)=>d.data.observedOwnStatus="Reviewed",(d:any)=>d.data.attempt.exitCode=1,(d:any)=>d.data.capture.stdoutBytes++,(d:any)=>d.data.commandOutput.text="fake",(d:any)=>d.extra=true,(d:any)=>d.data.effect="not-attempted",(d:any)=>d.data.capture.complete=false,(d:any)=>d.data.commandOutput.text="\ud800",(d:any)=>d.action="set-status"]) {const d=structuredClone(success.structuredContent);change(d);if(action==="set-status"&&d.action===action&&JSON.stringify(d)===JSON.stringify(success.structuredContent))continue;assert(!validateReviewWorkflowOutput(d),JSON.stringify(d));}
    for(const reply of [{code:1,out:"possible partial effects",err:"PRIVATE_ERROR"},{err:"PRIVATE_WARNING"},{out:Buffer.from([255])},{out:"x".repeat(65537)},{err:"x".repeat(16385)},{start:false},{launch:true}]) {const r=await invoke(action,request,reply);assert(r.isError);assert.equal(calls.length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);assert.equal(r.structuredContent.data.effect,reply.launch?"not-attempted":"uncertain");}
    const aborted=new AbortController();aborted.abort();calls.length=0;const r=await runWithAbortSignal(aborted.signal,()=>executeReviewWorkflowOutput(action,request),deps());assert(validateReviewWorkflowOutput(r.structuredContent));assert(r.isError);assert.equal(calls.length,0);
    for(const terminal of [false,true]) {calls.length=0;const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>false});const r=await runWithAbortSignal(undefined,()=>executeReviewWorkflowOutput(action,request),{timeoutMs:1,abortKillDelayMs:1,spawn:((_c:string,argv:string[])=>{calls.push(argv);queueMicrotask(()=>{child.emit("spawn");child.stdout.write("partial");if(terminal)child.emit("close",0,null);});return child;}) as any});assert(validateReviewWorkflowOutput(r.structuredContent));assert(r.isError);assert.equal(calls.length,1);assert.equal(r.structuredContent.data.attempt.timedOut,true);const snapshot=JSON.stringify(r);child.emit("error",Error("late"));child.emit("close",0,null);assert.equal(JSON.stringify(r),snapshot);}
    const text=await runWithAbortSignal(undefined,()=>core[action].execute({...request,preflight:true,output:"json"} as any),deps());assert.equal(JSON.parse(text).action,action);
}
for(const action of ["reviewer-add","reviewer-remove","request-review"] as const) {
    for(const bad of [{users:undefined,groups:undefined},{users:[]},{users:["me","me"]},{users:["a,b"]},{users:["--all"]},{users:[" me"]},{users:["bad\nuser"]},{users:["\ud800"]},{users:Array(101).fill("x")},{users:Array(1)},{groups:["bad,group"]},{users:null}])await invalid(action,{...requests[action],...bad});
    const r=await invoke(action,{...base,users:["me","reviewer@example.invalid"],groups:["Developers","QA Team"]});assert(!r.isError);assert.deepEqual(calls[0],["codereview",...(action==="request-review"?["review","1110","--re-request"]:["reviewer",action==="reviewer-add"?"add":"remove","1110"]),"--users=me,reviewer@example.invalid","--groups=Developers,QA Team",`--repository=${repository}`]);
}
for(const args of [{all:true,users:["me"]},{all:true,groups:["Developers"]},{all:false},{all:"true"},{all:true,comment:"no"},{all:true,commentsFile:"no"}])await invalid("request-review",{...base,...args});
const all=await invoke("request-review",{...base,all:true});assert(!all.isError);assert.deepEqual(calls[0],["codereview","review","1110","--re-request","--all",`--repository=${repository}`]);
for(const input of [{users:["me"]},{format:"{user}"},{comment:"no"}])await invalid("reviewer-list",{...base,...input});
for(const status of ["reviewed","rework-required","under-review"]) {
    for(const content of [{},{comment:"explicit"},{commentsFile:"comment notes.txt"}]) {const r=await invoke("set-status",{...base,status,...content});assert(!r.isError);assert.deepEqual(calls[0],["codereview","review","1110",`--${status}`,...("comment" in content?["-c=explicit"]:"commentsFile" in content?["-commentsfile=comment notes.txt"]:[]),`--repository=${repository}`]);}
}
for(const input of [{status:"Reviewed"},{status:"--reviewed"},{status:"reviewed",comment:"",},{status:"reviewed",comment:"x",commentsFile:"notes"},{status:"reviewed",commentsFile:"-"},{status:"reviewed",comment:null},{status:"reviewed",all:true},{status:"reviewed",users:["me"]}])await invalid("set-status",{...base,...input});
const boundaryMembers=Array.from({length:16},(_,n)=>String(n).padStart(3,"0")+"x".repeat(n===0?253:252)); // 4096 exact UTF8 bytes including commas.
assert.equal(Buffer.byteLength(boundaryMembers.join(","),"utf8"),4096);
assert(!(await invoke("reviewer-add",{...base,users:boundaryMembers})).isError);
await invalid("reviewer-add",{...base,users:boundaryMembers.map((x,n)=>n===1?x+"x":x)});
assert(!(await invoke("reviewer-add",{...base,users:Array.from({length:100},(_,n)=>`user-${n}`)})).isError);
const during=new AbortController();calls.length=0;
const cancelled=await runWithAbortSignal(during.signal,()=>executeReviewWorkflowOutput("set-status",requests["set-status"]),deps({mutate:()=>during.abort()}));
assert(validateReviewWorkflowOutput(cancelled.structuredContent));assert(cancelled.isError);assert.equal(cancelled.structuredContent.data.attempt.aborted,true);assert.equal(cancelled.structuredContent.data.effect,"uncertain");assert.equal(calls.length,1);
const oldEditor=process.env.PLASTICEDITOR;
try {process.env.PLASTICEDITOR="must-not-launch";for(const action of REVIEW_WORKFLOW_ACTIONS) {const args=action==="set-status"?{...base,status:"under-review"}:requests[action];const r=await invoke(action,args);assert(!r.isError);assert(!calls[0].includes("comment"));}} finally {if(oldEditor===undefined)delete process.env.PLASTICEDITOR;else process.env.PLASTICEDITOR=oldEditor;}
const mutable={...base,users:["me"]};const snap=await invoke("reviewer-add",mutable,{mutate:()=>{mutable.users.push("later");mutable.id="9";}});assert.deepEqual((snap.structuredContent.data.requested as any).users,["me"]);assert.equal(snap.structuredContent.data.requested!.id,"1110");
const guid="27658884-5dcc-49b7-b0ef-a5760ae740a3";const gr=await invoke("reviewer-list",{...base,id:guid});assert(!gr.isError);assert.equal(calls[0][3],guid);
// Exact sanitized selected bytes, not reconstructed table rows or fabricated membership.
const fixture=JSON.parse(readFileSync(new URL("./fixtures/review-workflow-native.json",import.meta.url),"utf8"));assert.equal(fixture.client,"11.0.16.10512");
for(const c of fixture.captures)for(const s of Object.values(c.streams) as any[]) {const bytes=Buffer.from(s.base64,"base64");assert.equal(bytes.length,s.selectedByteCount);assert.equal(createHash("sha256").update(bytes).digest("hex"),s.selectedSha256);new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
for(const c of fixture.captures.filter((x:any)=>x.name.startsWith("reviewer-list-"))) {const r=await invoke("reviewer-list",base,{out:Buffer.from(c.streams.stdout.base64,"base64"),err:Buffer.from(c.streams.stderr.base64,"base64"),code:c.receipt.exitCode});assert(!r.isError);assert.equal(r.structuredContent.data.commandOutput!.text,Buffer.from(c.streams.stdout.base64,"base64").toString("utf8"));assert.equal(r.structuredContent.data.observedMembership,null);}
const create={target:"cs:16",title:"Synthetic title",users:["me"],groups:["Developers"],repository};
for(const args of [{...create,assignee:"legacy"},{...create,users:["x,y"]},{...create,groups:[]},{id:"1110",assignee:"legacy"},{id:"1110"},{id:"bad",title:"Updated"}]) {calls.length=0;const action="id" in args?"code-review-update":"code-review-create";const r=await runWithAbortSignal(undefined,()=>executeObjectWriteOutput(action,args),deps());assert(validateObjectWriteOutput(r.structuredContent));assert(r.isError);assert.equal(calls.length,0);}
for(const out of ["1110\r\n",guid+"\r\n","bad-guid\r\n",guid+"x\r\n","diagnostic "+guid+"\r\n"]) {calls.length=0;const r=await runWithAbortSignal(undefined,()=>executeObjectWriteOutput("code-review-create",create),deps({out}));assert(validateObjectWriteOutput(r.structuredContent));assert(!r.isError);assert.deepEqual(calls[0],["codereview","cs:16","Synthetic title","--users=me","--groups=Developers",`--repository=${repository}`]);assert.equal(r.structuredContent.data.observedCreatedIdentity?.value??null,out===guid+"\r\n"?guid:out==="1110\r\n"?"1110":null);}
for(const [name,action,args] of [
    ["own-status-reviewed","set-status",requests["set-status"]],
    ["rerequest-self","request-review",requests["request-review"]],
    ["reviewer-remove-self","reviewer-remove",{...base,users:["me"]}],
    ["reviewer-add-self","reviewer-add",requests["reviewer-add"]],
] as const) {const capture=fixture.captures.find((c:any)=>c.name===name);assert(capture);const r=await invoke(action,args,{out:Buffer.from(capture.streams.stdout.base64,"base64"),err:Buffer.from(capture.streams.stderr.base64,"base64"),code:capture.receipt.exitCode});assert(!r.isError);assert.equal(r.structuredContent.data.commandOutput!.text,"");assert.equal(r.structuredContent.data.observedOwnStatus,null);}
console.log("PASS: five distinct review workflow receipts; exact native argv, user/group/status exclusivity, opaque list fixtures, no editor/retry, strict identity, forgery rejection, bounded fatal UTF8/abort/timeout/missing-start.");
