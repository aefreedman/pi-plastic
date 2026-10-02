import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { executeDiffRevisions } from "../src/operations/diff-revisions";
import { diffOutputSchema, validateDiffOutput, type DiffOutput } from "../src/pi/diff-output";
import { validDiffRevisionsSelector, validateRevisionUnifiedDiff, DIFF_REVISIONS_FILE_BYTES, diffRevisionsPayload, type DiffRevisionsObservation } from "../src/operations/diff-revisions";
import { diffRevisionsOutputSchema, validateDiffRevisionsOutput, type DiffRevisionsOutput } from "../src/pi/diff-revisions-output";

const tool=(await loadRegisteredTools()).get("plastic_diff")!;
assert.deepEqual(tool.outputSchema,diffOutputSchema);
const selectors={leftRevision:"Assets/Fictional ü 日本 😀.txt#cs:1",rightRevision:"Assets/Fictional ü 日本 😀.txt#cs:2"};
const body="@@ -1 +1 @@\n-before\n+after\n";
let calls:string[][]=[],children:any[]=[],roots=new Set<string>();
type Options={left?:Buffer;right?:Buffer;body?:string;raw?:Buffer|string;code?:number|null;signalCode?:string;stderr?:Buffer|string;catFail?:number;missing?:boolean;oversize?:boolean;decoded?:boolean;streamError?:boolean;premature?:boolean;spawnThrow?:boolean;spawnError?:boolean;timeout?:boolean;exactBytes?:number;abort?:AbortController;abortDuring?:AbortController};
async function invoke(args:Record<string,unknown>={},o:Options={},core=false){
 calls=[];children=[];roots=new Set();let cats=0;
 const spawn=((_exe:string,argv:string[],opts:any)=>{
  calls.push(argv);assert.equal(opts.shell,false);
  if(argv[0]==="cat")roots.add(dirname(argv[2].slice(7)));
  if(o.spawnThrow)throw Error("private diagnostic /private/coordinate");
  const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{queueMicrotask(()=>{c.stdout.end();c.stderr.end();c.emit("close",null,"SIGTERM")});return true}});children.push(c);
  if(argv[0]==="cat"){
   const index=++cats,dest=argv[2].slice(7);roots.add(dirname(dest));
   queueMicrotask(async()=>{
    if(index===o.catFail){await fs.writeFile(dest,"");c.stdout.end();c.stderr.end("private --nodata diagnostic");c.emit("close",1);return;}
    if(!o.missing){if(o.oversize&&index===1){const h=await fs.open(dest,"wx");await h.truncate(DIFF_REVISIONS_FILE_BYTES+1);await h.close();}else await fs.writeFile(dest,index===1?(o.left??Buffer.from("before\n")):(o.right??Buffer.from("after\n")),{flag:"wx"});}
    c.stdout.end();c.stderr.end();c.emit("close",0);
   });
  }else if(argv[0]==="version"){queueMicrotask(()=>{c.stdout.end("11.0.0.synthetic");c.stderr.end();c.emit("close",0)});}
  else{
   assert.equal(argv[0],"-u");roots.add(dirname(argv[1]));assert(!argv.includes(selectors.leftRevision));
   if(o.decoded)c.stdout.setEncoding("utf8");
   queueMicrotask(()=>{
    if(o.spawnError){c.emit("error",Error("private diagnostic"));return;}
    if(o.timeout)return;
    if(o.streamError){c.stdout.destroy(Error("private diagnostic"));c.stderr.end();c.emit("close",1);return;}
    if(o.premature){c.stdout.destroy();c.stderr.end();c.emit("close",1);return;}
    const header="--- "+argv[1]+"\tdate\n+++ "+argv[2]+"\tdate\n";
    const exact=o.exactBytes===undefined?undefined:header+"@@ -1 +1 @@\n-"+ "a".repeat(o.exactBytes-header.length-"@@ -1 +1 @@\n-".length-"\n+b\n".length)+"\n+b\n";
    c.stdout.end(exact??o.raw??(o.code===0?"":header+(o.body??body)));c.stderr.end(o.stderr??"");o.abortDuring?.abort();c.emit("close",o.code===undefined?1:o.code,o.signalCode);
   });
  }
  return c;
 }) as any;
 const result=await runWithAbortSignal(o.abort?.signal??o.abortDuring?.signal,()=>core?executeDiffRevisions({...selectors,...args} as any):tool.execute("fixture",{mode:"revisions",...selectors,...args},undefined,undefined,{cwd:"/fictional"}),{spawn,...(o.timeout?{timeoutMs:50,abortKillDelayMs:1}:{})});
 if(!core){const r=result as any;assert(Check(diffOutputSchema,r.structuredContent));assert.equal(r.isError,!r.structuredContent.ok);assert.doesNotMatch(JSON.stringify(r),/private diagnostic|private --nodata|pi-plastic-revisions-|pi-plastic-diff-/);}
 for(const r of roots)assert.equal(await fs.stat(r).then(()=>true,()=>false),false,"owned temps removed");
 for(const c of children){assert.equal(c.listenerCount("close"),0);assert.equal(c.listenerCount("error"),0);assert.equal(c.stdout.listenerCount("data"),0);assert.equal(c.stderr.listenerCount("data"),0);}
 return result as any;
}
function typed(dto:DiffOutput):string{if(!dto.ok)return dto.error.code;if(dto.mode==="workspace")return "collection";return dto.data.left.selector??"";}
const direct=await invoke(),dto=direct.structuredContent;
assert(dto.ok);assert.equal(typed(dto),selectors.leftRevision);assert.equal(dto.data.status,"changed");assert.equal(dto.data.left.bytes,7);assert.equal(dto.data.right.bytes,6);assert.equal(dto.data.left.identity,null);assert.equal(dto.data.hunkCount,1);assert.equal(calls.length,3);
assert.deepEqual(calls.slice(0,2).map(c=>c.slice(0,2)),[["cat",selectors.leftRevision],["cat",selectors.rightRevision]]);
assert.match(dto.data.excerpt.text,/--- Assets\/Fictional ü 日本 😀\.txt@cs:1/);assert.equal(dto.data.excerpt.returnedChars,dto.data.excerpt.text.length);
const json=await invoke({format:"json"});assert.deepEqual(json.structuredContent,dto);assert.equal(JSON.parse(json.content[0].text).action,"diff");assert.equal(calls.filter(c=>c[0]==="version").length,0);
await invoke({format:"json"});assert.equal(calls.length,3,"unified JSON has no presentation metadata query");
assert.equal((await invoke({}, {code:0})).structuredContent.data.status,"unchanged");
for(const [left,right,status] of [[Buffer.from([0,1]),Buffer.from([0,2]),"binary-different"],[Buffer.from([255]),Buffer.from([255]),"unchanged"],[Buffer.alloc(0),Buffer.from([0]),"binary-different"]] as const){const r=await invoke({}, {left,right});assert.equal(r.structuredContent.data.status,status);assert.equal(r.structuredContent.data.comparisonBasis,"byte_equality");assert.equal(r.structuredContent.data.excerpt,null);assert.equal(calls.length,2);}
for(const selector of ["revid:17","revid:17@rep:example@repserver:example-server","rev:example.txt","Assets/Example.txt#cs:1","Assets/Example.txt#br:/main/space 日本 😀","serverpath:/Assets/Example.txt#br:/main","itemid:17#cs:2","Assets/Example.txt#lb:release"]){assert(validDiffRevisionsSelector(selector),selector);}
for(const selector of ["revid:17;C:/Fictional/output.txt","Assets/Example.txt#br:/main\nextra","Assets/Example.txt#cs:1;output","revid:","revid:-1","revid:word","cs:1","17","base","itemid:17","serverpath:/Assets/Example.txt"," example#cs:1","--file=output#br:/main","file#br:/","file##cs:1","file#cs:1\u0000","file#br:/main\ud800","x".repeat(4097)+"#cs:1"]){assert(!validDiffRevisionsSelector(selector),selector);const r=await invoke({leftRevision:selector});assert.equal(r.structuredContent.error.code,"invalid_selector");assert.equal(calls.length,0);}
const aborted=new AbortController();aborted.abort();assert.equal((await invoke({}, {abort:aborted})).structuredContent.error.code,"aborted");assert.equal(calls.length,0);
for(const [o,code] of [[{catFail:1},"command_failed"],[{catFail:2},"command_failed"],[{missing:true},"materialization_failed"],[{oversize:true},"materialization_limit"],[{code:null},"command_failed"],[{code:1,signalCode:"SIGTERM"},"command_failed"],[{timeout:true},"capture_incomplete"],[{code:0,stderr:"private diagnostic"},"command_failed"],[{raw:""},"malformed_output"],[{raw:Buffer.from([255])},"invalid_utf8"],[{code:0,raw:"unexpected"},"malformed_output"],[{body:"@@ -2,2 +2 @@\n-a\n+b\n"},"malformed_output"],[{body:"@@ -1 +1 @@\n same\n"},"malformed_output"],[{raw:Buffer.alloc(1048577,49)},"capture_incomplete"],[{stderr:Buffer.alloc(65537,32)},"capture_incomplete"],[{decoded:true},"command_failed"],[{streamError:true},"command_failed"],[{premature:true},"command_failed"],[{spawnThrow:true},"command_failed"],[{spawnError:true},"command_failed"],[{abortDuring:new AbortController()},"aborted"]] as const){const r=await invoke({},o as Options);assert(r.isError,JSON.stringify(o));assert.equal(r.structuredContent.error.code,code);assert.equal(r.structuredContent.data,undefined);}
assert.equal((await invoke({}, {left:Buffer.alloc(DIFF_REVISIONS_FILE_BYTES),right:Buffer.alloc(0)})).structuredContent.data.left.bytes,DIFF_REVISIONS_FILE_BYTES);
const inclusive=await invoke({}, {exactBytes:1048576});assert(inclusive.structuredContent.ok);assert.equal(inclusive.structuredContent.data.capture.diffStdoutBytes,1048576);
assert.equal((await invoke({}, {stderr:Buffer.alloc(65536,32)})).structuredContent.error.code,"command_failed");
assert(validDiffRevisionsSelector("x".repeat(4091)+"#cs:1"));
assert(!validDiffRevisionsSelector("x".repeat(4092)+"#cs:1"));
assert.equal(validateRevisionUnifiedDiff("--- left\n+++ right\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n"),1);
assert.equal(validateRevisionUnifiedDiff("--- left\n+++ right\n@@ -0,0 +1 @@\n+added\n"),1);
for(const raw of ["--- left\n+++ right\n", "--- left\n+++ right\n@@ -1 +1 @@\n-a\n+b\nextra", "--- left\n+++ right\n@@ -99999999999 +1 @@\n-a\n+b\n"] )assert.throws(()=>validateRevisionUnifiedDiff(raw));
const n=12000,largeBody="@@ -1,"+n+" +1,"+n+" @@\n"+"-before 😀\n".repeat(n)+"+after 😀\n".repeat(n);
const large=await invoke({maxChars:500},{body:largeBody});assert(large.structuredContent.ok);assert.equal(large.structuredContent.completeness.projection,false);assert(large.structuredContent.data.excerpt.text.length<=500);assert(large.structuredContent.data.excerpt.omittedChars>0);assert(!/[\uD800-\uDFFF]/u.test(large.structuredContent.data.excerpt.text));
for(const mutate of [(x:any)=>x.data.left.selector="revid:1;output",(x:any)=>x.data.left.resolvedIdentity="invented",(x:any)=>x.data.excerpt.sourceChars++,(x:any)=>x.data.capture.diffExitCode=0,(x:any)=>x.completeness.projection=false,(x:any)=>x.data.status="unchanged",(x:any)=>x.data.extra="private"]){const x=structuredClone(dto);mutate(x);assert.equal(validateDiffOutput(x),false);}
const obs:DiffRevisionsObservation={left:{selector:"\u0800".repeat(4090)+"#cs:1",kind:"file-qualified",resolvedIdentity:null,bytes:0,binary:false},right:{selector:"\u0801".repeat(4090)+"#cs:2",kind:"file-qualified",resolvedIdentity:null,bytes:0,binary:false},maxChars:20000,binary:false,changed:true,normalized:"\u0001".repeat(20000),hunkCount:1,diffStdoutBytes:20000,diffExitCode:1,legacyResult:{backend:"diff",changed:true,binary:false,output:"",truncated:false,totalChars:20000}};
const bounded=diffRevisionsPayload(obs);assert(Buffer.byteLength(JSON.stringify(bounded))<=131072);assert.equal(bounded.completeness.projection,false);assert.equal(validateDiffRevisionsOutput(bounded).ok,true);
assert.match(await invoke({}, {},true),/--- Assets\/Fictional/);
assert.equal(await invoke({}, {code:0},true),"No differences.");
assert.equal(await invoke({}, {left:Buffer.from([0]),right:Buffer.from([0,1])},true),"Binary content differs; a text diff is unavailable.");
// Timeout escalation, drain and all listener/timer cleanup when SIGTERM is ignored.
const kills: string[] = [], timers = new Set<NodeJS.Timeout>(); let escalating: any;
const spawn = (() => {
    escalating = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal: string) => {
        kills.push(signal); if (signal === "SIGKILL") queueMicrotask(() => { escalating.stdout.end(); escalating.stderr.end(); escalating.emit("close", null); }); return true;
    } }); return escalating;
}) as any;
const timed = await runWithAbortSignal(undefined, () => tool.execute("synthetic", {mode:"revisions",...selectors}, undefined, undefined, { cwd: "/synthetic" }), { spawn, timeoutMs: 1, abortKillDelayMs: 1, setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; }, clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); } });
assert.deepEqual(kills, ["SIGTERM", "SIGKILL"]); assert.equal(timers.size, 0); assert.equal(timed.structuredContent.error.code, "capture_incomplete");
assert.equal(escalating.stdout.listenerCount("data"), 0); assert.equal(escalating.listenerCount("close"), 0);
console.log("PASS: strict historical diff selectors, typed comparison/capture failures, bounded files/excerpts, byte classification, normalized counts, native JSON cache and cleanup");
