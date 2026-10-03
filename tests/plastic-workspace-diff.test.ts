import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import { diff } from "../src/plastic-core";
import { runWithAbortSignal } from "../src/execution/context";
import { diffInputSchema, diffOutputSchema, validateDiffOutput } from "../src/pi/diff-output";
import { validateDiffRequest } from "../src/operations/consolidated-diff";
import { parseLoadedFileInfo, parseLoadedLs } from "../src/domain/diff-base-xml";
import { parseDiffPending } from "../src/domain/diff-pending-xml";
import { loadRegisteredTools } from "./pi-tool-harness";

const root=await mkdtemp(join(tmpdir(),"pi-consolidated-fixture-"));
const esc=(x:string)=>x.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const file=join(root,"Tracked 日本-é-😀.txt"), original=Buffer.from("base\n");
const hash=createHash("md5").update(original).digest("base64");
let rows:{path:string;code:string;old?:string;directory?:boolean;binary?:boolean}[]=[],calls:string[][]=[];
let abortComparison:AbortController|undefined;
let badHash=false,badOwnership=false,catFailure=false,statusFailure=false,deletedRep=false,lookup=file;
const records=()=>rows.map(r=>`<Change><Type>${r.code}</Type><Path>${esc(r.path)}</Path><OldPath>${esc(r.old??"")}</OldPath><RevisionType>${r.directory?"enDirectory":r.binary?"enBinaryFile":"enTextFile"}</RevisionType></Change>`).join("");
const status=()=>`<?xml version="1.0" encoding="utf-8"?><StatusOutput><WorkspaceStatus><Status><RepSpec><Server>example-id@cloud</Server><Name>Example Repository</Name></RepSpec><Changeset>7</Changeset></Status></WorkspaceStatus><WkConfigType>Branch</WkConfigType><WkConfigName>/main</WkConfigName><Changes>${records()}</Changes></StatusOutput>`;
const info=()=>`<?xml version="1.0" encoding="utf-8"?><FileInfos><FileInfo><ClientPath>${esc(lookup)}</ClientPath><ServerPath>/Tracked.txt</ServerPath><RevisionChangeset>3</RevisionChangeset><Status>${deletedRep?"deleted":"controlled"}</Status><Type>txt</Type><Hash>${hash}</Hash><RepSpec>${deletedRep?"":"Example Repository@example@cloud"}</RepSpec></FileInfo></FileInfos>`;
const ls=()=>`<?xml version="1.0" encoding="utf-8"?><LsResults><LsItems><LsItem><ItemId>9</ItemId><Changeset>3</Changeset><RevId>17</RevId><ParentRevId>16</ParentRevId><Type>txt</Type><Size>5</Size><Hash>${badHash?"AAAAAAAAAAAAAAAAAAAAAA==":hash}</Hash><HashAlgorithm>MD5</HashAlgorithm><CurrentPath>${esc(deletedRep?"/Tracked.txt":lookup)}</CurrentPath><WkPath>${esc(lookup)}</WkPath><Repository>rep:Example Repository@example@cloud</Repository><Server>${badOwnership?"other@cloud":"example@cloud"}</Server></LsItem></LsItems></LsResults>`;
const spawn=((_exe:string,args:string[])=>{
 calls.push(args);const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
 queueMicrotask(async()=>{try{
  let output="",exit=0;
  if(args[0]==="status"){output=status();if(statusFailure)exit=1;}
  else if(args[0]==="fileinfo") {assert.equal(args[1],lookup);output=info();}
  else if(args[0]==="ls")output=ls();
  else if(args[0]==="cat"){if(catFailure)exit=1;else await writeFile(args[2].slice(7),original,{flag:"wx"});}
  else {assert.equal(args[0],"-u");const l=await readFile(args[1]),r=await readFile(args[2]);
   if(!l.equals(r)){exit=1;const lines=(b:Buffer)=>b.length?b.toString("utf8").replace(/\n$/,"").split("\n"):[];const a=lines(l),b=lines(r);
    output=`--- ${args[1]}\n+++ ${args[2]}\n@@ -${a.length?1:0},${a.length} +${b.length?1:0},${b.length} @@\n`+a.map(x=>`-${x}\n`).join("")+b.map(x=>`+${x}\n`).join("");}}
  c.stdout.end(output);c.stderr.end();if(args[0]==="-u")abortComparison?.abort();c.emit("close",exit,null);
 }catch(e){c.emit("error",e);c.stdout.end();c.stderr.end();c.emit("close",1,null);}});return c;
}) as any;
const tool=(await loadRegisteredTools()).get("plastic_diff")!;
async function withLstatFault<T>(path:string,code:string,run:()=>Promise<T>):Promise<T>{
 const originalLstat=fs.lstat;
 fs.lstat=((candidate:any,...args:any[])=>String(candidate)===path?Promise.reject(Object.assign(new Error("private filesystem diagnostic"),{code})):Reflect.apply(originalLstat,fs,[candidate,...args])) as typeof fs.lstat;
 try{return await run();}finally{fs.lstat=originalLstat;}
}
async function invoke(args:Record<string,unknown>,core=false){calls=[];const r:any=await runWithAbortSignal(abortComparison?.signal,()=>core?diff.execute({workdir:root,...args} as any):tool.execute("synthetic",{workdir:root,...args},undefined,undefined,{cwd:root}),{spawn});const p=core?r:r.structuredContent;assert(Check(diffOutputSchema,p));assert(validateDiffOutput(p));if(!core)assert.equal(r.isError,!p.ok);return p;}
try{
 await mkdir(join(root,".plastic"));await writeFile(join(root,".plastic","plastic.workspace"),"synthetic workspace marker");await writeFile(file,original);
 for(const input of [{mode:"file",path:file},{mode:"file",path:file,revision:"revid:17"},{mode:"revisions",leftRevision:"revid:17",rightRevision:"revid:18"},{mode:"workspace",paths:[file]},{mode:"workspace",allPending:true}]){assert(Check(diffInputSchema,input));validateDiffRequest(input);}
 for(const input of [{},{mode:"workspace"},{mode:"file",path:file,paths:[file]},{mode:"file",path:file,allPending:false},{mode:"revisions",leftRevision:"revid:17",rightRevision:"revid:18",path:file},{mode:"workspace",paths:[]},{mode:"workspace",paths:[file],includePrivate:false},{mode:"workspace",paths:[file],allPending:true},{mode:"workspace",allPending:false},{mode:"workspace",allPending:true,maxFiles:0},{mode:"workspace",allPending:true,maxChars:8001},{mode:"file",path:file,extra:true}]){assert(!Check(diffInputSchema,input));assert.throws(()=>validateDiffRequest(input));calls=[];await assert.rejects(()=>invoke(input,true));assert.equal(calls.length,0);}
 let p=await invoke({mode:"file",path:file});assert(p.ok);assert.equal(p.data.status,"unchanged");assert.equal(p.data.left.identity.revisionId,"17");assert.equal(p.data.left.identity.server,"example@cloud");assert.equal(p.data.left.selector,"revid:17@rep:Example Repository@repserver:example@cloud");assert(!calls.some(c=>c[0]==="version"));
 p=await invoke({mode:"file",path:file,revision:"revid:17"});assert(p.ok);assert.equal(p.data.left.identity,null);assert(!calls.some(c=>["status","fileinfo","ls"].includes(c[0])));
 await writeFile(file,"local\n");rows=[{path:file,code:"CH"}];p=await invoke({mode:"file",path:file});assert(p.ok);assert.equal(p.data.pendingKind,"changed");assert.equal(p.data.status,"changed");assert.match(p.data.excerpt.text,/\+local/);
 badHash=true;p=await invoke({mode:"file",path:file});assert.equal(p.error.code,"base_changed");assert(!calls.some(c=>c[0]==="cat"));badHash=false;
 badOwnership=true;p=await invoke({mode:"file",path:file});assert.equal(p.error.code,"base_unavailable");badOwnership=false;
 catFailure=true;p=await invoke({mode:"file",path:file});assert.equal(p.error.code,"command_failed");assert(!calls.some(c=>c[0]==="-u"));catFailure=false;
 const moved=join(root,"Moved 日本-😀.txt");await writeFile(moved,original);await rm(file);lookup=moved;rows=[{path:moved,code:"MV",old:file}];p=await invoke({mode:"workspace",paths:[file]});assert(p.ok);assert.equal(p.data.outcomes[0].sourcePath,file);assert.equal(p.data.outcomes[0].comparison.status,"unchanged");
 lookup=file;rows=[{path:moved,code:"LM",old:file}];p=await invoke({mode:"file",path:moved});assert(p.ok);assert(calls.some(c=>c[0]==="fileinfo"&&c[1]===file));assert.equal(p.data.right.path,moved);await rm(moved);
 rows=[{path:file,code:"DE"}];deletedRep=true;p=await invoke({mode:"file",path:file});assert(p.ok);assert.equal(p.data.pendingKind,"deleted");assert.equal(p.data.right.origin,"synthetic-empty");assert(calls.some(c=>c[0]==="ls"&&c[1]==="/Tracked.txt"&&c.includes("--tree=cs:7@Example Repository@example-id@cloud")));deletedRep=false;
 rows=[{path:file,code:"LD"}];p=await invoke({mode:"file",path:file});assert(p.ok);assert(calls.some(c=>c[0]==="ls"&&c[1]===file));
 for(const code of ["EACCES","EPERM","EIO"]){
  p=await withLstatFault(file,code,()=>invoke({mode:"file",path:file}));assert(!p.ok);assert.equal(p.error.code,"read_failed");assert.equal(p.error.stage,"right");assert(!calls.some(c=>c[0]==="-u"));assert.doesNotMatch(JSON.stringify(p),/private filesystem diagnostic/);
  const retained=join(root,"Retained.txt");await writeFile(retained,"added\n");rows=[{path:retained,code:"AD"},{path:file,code:"LD"}];
  p=await withLstatFault(file,code,()=>invoke({mode:"workspace",paths:[retained,file]}));assert(!p.ok);assert.equal(p.error.code,"partial_comparison");assert.equal(p.data.counts.completed,1);assert.equal(p.data.counts.failed,1);assert.equal(p.data.outcomes[1].error.code,"read_failed");assert.equal(calls.filter(c=>c[0]==="-u").length,1);rows=[{path:file,code:"LD"}];
 }
 for(const code of ["ENOENT","ENOTDIR"]){p=await withLstatFault(file,code,()=>invoke({mode:"file",path:file}));assert(p.ok);assert.equal(p.data.right.origin,"synthetic-empty");}
 await writeFile(file,original);p=await invoke({mode:"file",path:file});assert.equal(p.error.code,"file_changed");
 rows=[{path:file,code:"AD"}];await writeFile(file,Buffer.alloc(0));p=await invoke({mode:"file",path:file});assert(p.ok);assert.equal(p.data.status,"added-empty");assert(!calls.some(c=>["cat","fileinfo","ls"].includes(c[0])));
 rows=[{path:file,code:"PR",binary:true}];await writeFile(file,Buffer.from([0,1]));p=await invoke({mode:"workspace",allPending:true});assert(p.ok);assert.equal(p.data.excludedPrivate,1);assert.equal(p.data.counts.selected,0);assert.equal(p.completeness.read,"complete");
 p=await invoke({mode:"workspace",allPending:true,includePrivate:true});assert(p.ok);assert.equal(p.data.outcomes[0].comparison.status,"binary-different");assert(!calls.some(c=>c[0]==="cat"));
 p=await invoke({mode:"workspace",paths:[file]});assert(p.ok);assert.equal(p.data.counts.completed,1,"explicit private selection is intentional");
 const extra=join(root,"Other.txt");await writeFile(extra,"added\n");rows=[{path:file,code:"AD"},{path:extra,code:"AD"}];p=await invoke({mode:"workspace",allPending:true,maxFiles:1});assert(p.ok);assert.equal(p.data.counts.limited,1);assert.equal(p.completeness.read,"incomplete");
 p=await invoke({mode:"workspace",paths:[file,join(root,"Missing.txt")]});assert(p.ok);assert.deepEqual(p.data.unmatched,[join(root,"Missing.txt")]);assert.equal(p.completeness.read,"incomplete");
 p=await invoke({mode:"workspace",paths:[join(root,"..","Outside.txt")]});assert.equal(p.error.code,"outside_workspace");
 rows=[{path:file,code:"AD"},{path:extra,code:"CH"}];lookup=extra;catFailure=true;p=await invoke({mode:"workspace",allPending:true,maxFiles:2});assert(!p.ok);assert.equal(p.error.code,"partial_comparison");assert.equal(p.data.counts.completed,1);assert.equal(p.data.counts.failed,1);catFailure=false;
 await writeFile(file,"added\n");rows=[{path:file,code:"AD"},{path:extra,code:"AD"}];abortComparison=new AbortController();p=await invoke({mode:"workspace",allPending:true,maxFiles:2});assert(!p.ok);assert.equal(p.error.code,"aborted");assert.equal(p.data.counts.unattempted,1);assert.equal(p.data.outcomes[0].error.code,"aborted");abortComparison=undefined;
 rows=[{path:file,code:"AD"},{path:extra,code:"CH"}];statusFailure=true;p=await invoke({mode:"workspace",allPending:true});assert.equal(p.error.code,"command_failed");statusFailure=false;
 const inner=join(root,"Inner");await mkdir(join(inner,".plastic"),{recursive:true});const innerConfig=join(inner,".plastic","plastic.workspace");await writeFile(innerConfig,"synthetic inner marker");const innerFile=join(inner,"Added.txt");await writeFile(innerFile,"added\n");rows=[{path:innerFile,code:"AD"}];
 for(const target of [join(inner,".plastic"),innerConfig])for(const code of ["EACCES","EPERM","EIO"]){
  for(const args of [{mode:"workspace",paths:["."]},{mode:"file",path:innerFile},{mode:"file",path:file,revision:"revid:17"}]){
   p=await withLstatFault(target,code,()=>invoke({...args,workdir:inner}));assert(!p.ok);assert.equal(p.error.code,"workspace_unavailable");assert.equal(p.error.stage,"selection");assert.equal(calls.length,0);assert.doesNotMatch(JSON.stringify(p),/private filesystem diagnostic/);
  }
 }
 p=await invoke({mode:"workspace",workdir:inner,paths:["."]});assert(!p.ok);assert.equal(p.error.code,"invalid_request","readable nearest root cannot be selected as disguised whole workspace");
 const nativeLstat=fs.lstat;
 for(const target of [join(inner,".plastic"),innerConfig]){
  fs.lstat=(async(candidate:any,...args:any[])=>{const stat=await Reflect.apply(nativeLstat,fs,[candidate,...args]);if(String(candidate)===target)stat.isSymbolicLink=()=>true;return stat;}) as typeof fs.lstat;
  try{p=await invoke({mode:"file",workdir:inner,path:innerFile});assert(!p.ok);assert.equal(p.error.code,"workspace_unavailable");assert.equal(calls.length,0);}finally{fs.lstat=nativeLstat;}
 }
 await rm(innerConfig);await mkdir(innerConfig);p=await invoke({mode:"file",workdir:inner,path:innerFile});assert(!p.ok);assert.equal(p.error.code,"workspace_unavailable");assert.equal(calls.length,0);await rm(innerConfig,{recursive:true});await rm(join(inner,".plastic"),{recursive:true});await writeFile(join(inner,".plastic"),"unsupported marker");p=await invoke({mode:"file",workdir:inner,path:innerFile});assert(!p.ok);assert.equal(p.error.code,"workspace_unavailable");assert.equal(calls.length,0);
 const directory=join(root,"Nested");await mkdir(directory);const descendant=join(directory,"New.txt");await writeFile(descendant,"added\n");rows=[{path:directory,code:"AD",directory:true},{path:descendant,code:"AD"}];p=await invoke({mode:"workspace",paths:[directory]});assert(p.ok);assert.equal(p.data.counts.completed,1);assert.equal(p.data.counts.skipped,1);assert.equal(p.completeness.read,"incomplete");
 assert.equal(parseDiffPending(Buffer.from(status())).items.length,2);
 // Individually complete Unicode excerpts exceed the aggregate UTF-8 byte cap.
 // This must remove whole trailing outcomes, not clip identities or change read counts.
 const overflowFiles=Array.from({length:20},(_,i)=>i===0?file:join(root,`Overflow-${i}.txt`));
 const bodies=overflowFiles.map((_,i)=>`entry-${i}:`+"日本😀".repeat(900)+"\n");
 for(let i=0;i<overflowFiles.length;i++)await writeFile(overflowFiles[i],bodies[i]);
 lookup=file;rows=overflowFiles.map((path,i)=>({path,code:i===0?"CH":"AD"}));
 for(const core of [true,false]){
  p=await invoke({mode:"workspace",allPending:true,maxFiles:20,maxChars:8000,format:"json"},core);assert(p.ok);
  const counts=p.data.counts;assert.equal(counts.parsed,20);assert.equal(counts.eligible,20);assert.equal(counts.selected,20);assert.equal(counts.attempted,20);assert.equal(counts.completed,20);
  for(const name of ["failed","skipped","unattempted","limited"])assert.equal(counts[name],0);
  assert(counts.omitted>0&&counts.returned>0);assert.equal(counts.returned,p.data.outcomes.length);assert.equal(counts.returned+counts.omitted,20);
  assert.equal(p.completeness.read,"complete");assert.equal(p.completeness.capture,"complete");assert.equal(p.completeness.projection,false);
  assert(Buffer.byteLength(JSON.stringify(p),"utf8")<=131072);
  assert.deepEqual(p.data.outcomes.map((o:any)=>o.path),overflowFiles.slice(0,counts.returned));
  for(let i=0;i<counts.returned;i++){const o=p.data.outcomes[i];assert.equal(o.status,"compared");assert.equal(o.comparison.right.path,overflowFiles[i]);assert.equal(o.comparison.right.bytes,Buffer.byteLength(bodies[i],"utf8"));assert.equal(o.comparison.excerpt.truncated,false);assert(o.comparison.excerpt.text.includes("+"+bodies[i].trimEnd()));}
  assert.deepEqual(p.data.outcomes[0].comparison.left.identity,{revisionId:"17",changeset:"3",repository:"Example Repository",server:"example@cloud"});assert.equal(p.data.outcomes[0].comparison.left.selector,"revid:17@rep:Example Repository@repserver:example@cloud");
  assert.equal(calls.filter(c=>c[0]==="-u").length,20,"projection omits completed observations, not comparisons");
 }
 rows=[{path:directory,code:"AD",directory:true},{path:descendant,code:"AD"}];
 assert.throws(()=>parseDiffPending(Buffer.from(status().replace("<Type>AD</Type>","<Type>UNSUPPORTED</Type>"))));
 assert.throws(()=>parseLoadedFileInfo(Buffer.from(info()+info())));assert.throws(()=>parseLoadedLs(Buffer.from(ls().replace("<RevId>17</RevId>","<RevId>1.7</RevId>"))));
 for(const parser of [parseLoadedFileInfo,parseLoadedLs,parseDiffPending])assert.throws(()=>parser(Buffer.from([255])));
 console.log("PASS: unified requests, loaded identities, moves/deletions/additions, scoped partial outcomes and fail-closed filesystem faults (deletion presence, nearest workspace, unsupported/symlink markers)");
}finally{await rm(root,{recursive:true,force:true});}
