import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { promises as fs, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWithAbortSignal } from "../src/execution/context";
import { executePatchOutput, validatePatchOutput } from "../src/pi/patch-output";
import { PATCH_FILE_MAX_BYTES } from "../src/operations/patch-receipt";
import { patch } from "../src/operations/patch";
import { loadRegisteredTools } from "./pi-tool-harness";
const root=await fs.mkdtemp(join(tmpdir(),"pi-plastic-public-patch-test-"));
const request={source:"cs:42@Example Repository@example@unity",toolPath:"fixture-diff",workdir:root};
type Reply={file?:Buffer|string;stdout?:Buffer|string;stderr?:Buffer|string;code?:number;noStart?:boolean;race?:string;onSpawn?:()=>void};
const calls:string[][]=[];
function deps(reply:Reply) {return {spawn:((_:string,argv:string[])=>{
    calls.push([...argv]);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
    queueMicrotask(()=>{if(!reply.noStart)child.emit("spawn");reply.onSpawn?.();const out=argv.find(a=>a.startsWith("--output="))!.slice(9);if(reply.file!==undefined)writeFileSync(out,reply.file);if(reply.race)writeFileSync(reply.race,"concurrent writer");
        child.stdout.end(reply.stdout??"");child.stderr.end(reply.stderr??"");child.emit("close",reply.code??0,null);});return child;
})as any};}
async function invoke(args:any,reply:Reply={}) {calls.length=0;const d=await runWithAbortSignal(undefined,()=>executePatchOutput(args),deps(reply));assert(validatePatchOutput(d.structuredContent),JSON.stringify(d));assert.deepEqual(d.details,{});return d;}
try {
    for(const args of [{},{...request,source:"--apply"},{...request,destination:" - "},{...request,clean:"false"},{...request,integration:0},{...request,format:"markdown"},{...request,preflight:"true"},{...request,output:null},{...request,toolPath:"x\n"},{...request,extra:true},{...request,source:"x".repeat(4097)}]) {
        const d=await invoke(args);assert(d.isError);assert.equal(d.structuredContent.data.requested,null);assert.equal(calls.length,0);
    }
    const preview=await invoke({...request,preflight:true,clean:true,integration:true});assert(!preview.isError);assert.equal(calls.length,0);assert.deepEqual(preview.structuredContent.data.intendedArgv,["patch",request.source,"--output=<package-owned-staging-file>","--tool=fixture-diff","--clean","--integration"]);assert.equal(preview.structuredContent.data.cleanup,"not-created");
    for(const format of ["text","json"]){
        const d=await invoke({...request,format},{file:"--- a\n+++ b\n@@ -1 +1 @@\n-before\n+after\n"});assert(!d.isError);assert.equal(d.structuredContent.outcome,"generated");assert.equal(d.structuredContent.data.artifact!.content,"--- a\n+++ b\n@@ -1 +1 @@\n-before\n+after\n");assert.equal(d.structuredContent.data.cleanup,"completed");assert.equal(calls.length,1);assert(!calls[0].includes("--apply"));
        const forged=structuredClone(d.structuredContent);forged.data.artifact!.bytes++;assert(!validatePatchOutput(forged));
        const hash=structuredClone(d.structuredContent);hash.data.artifact!.sha256="a".repeat(64);assert(!validatePatchOutput(hash));
        const effect=structuredClone(d.structuredContent);effect.data.effect="published";assert(!validatePatchOutput(effect));
        const arbitrary=structuredClone(d.structuredContent);arbitrary.data.resolved!.source="cs:99";assert(!validatePatchOutput(arbitrary));
    }
    const empty=await invoke(request,{file:""});assert(!empty.isError);assert.equal(empty.structuredContent.outcome,"empty");
    const binary=await invoke(request,{file:Buffer.from([255,254,0])});assert(!binary.isError);assert.equal(binary.structuredContent.data.artifact!.content,null);assert.equal(binary.structuredContent.data.artifact!.utf8,false);
    const large=await invoke(request,{file:"x".repeat(60001)});assert(!large.isError);assert(large.structuredContent.data.artifact!.truncated);assert.equal(large.structuredContent.data.artifact!.totalChars,60001);
    const bound=await invoke(request,{file:Buffer.alloc(PATCH_FILE_MAX_BYTES,97)});assert(!bound.isError);assert.equal(bound.structuredContent.data.artifact!.bytes,PATCH_FILE_MAX_BYTES);
    const over=await invoke(request,{file:Buffer.alloc(PATCH_FILE_MAX_BYTES+1,97)});assert(over.isError);assert.equal(over.structuredContent.data.artifact,null);assert.equal(over.structuredContent.error!.code,"artifact_failed");
    for(const reply of [{},{file:"patch",code:1},{file:"patch",stderr:"PRIVATE_DIAGNOSTIC permission"},{stdout:Buffer.from([255]),file:"patch"},{stderr:"unrecognized option '--binary",file:"patch",code:1},{noStart:true,file:"patch"}]){
        const d=await invoke(request,reply);assert(d.isError);assert.equal(calls.length,1);assert.equal(d.structuredContent.data.artifact,null);assert(!JSON.stringify(d).includes("PRIVATE_DIAGNOSTIC"));
        // Any retained staging is disposed only by the test owner; synthetic emitter has no continuing native process.
        if(d.structuredContent.data.cleanup==="retained")await fs.rm(d.structuredContent.data.retainedStagingDirectory!,{recursive:true,force:true});
    }
    calls.length=0;
    const retired=await runWithAbortSignal(undefined,()=>executePatchOutput(request),{timeoutMs:1,abortKillDelayMs:1,spawn:((_:string,a:string[])=>{calls.push(a);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>false});queueMicrotask(()=>{child.emit("spawn");});return child;})as any});
    assert(validatePatchOutput(retired.structuredContent));assert(retired.isError);assert.equal(retired.structuredContent.data.cleanup,"retained");assert.equal(retired.structuredContent.data.attempt.terminal,"not-observed");assert.equal(calls.length,1);
    const retained=retired.structuredContent.data.retainedStagingDirectory!;assert((await fs.lstat(retained)).isDirectory());await fs.rm(retained,{recursive:true,force:true}); // Fake emitter only: distinct test-owner disposal, not producer rollback.
    const output=join(root,"owned ü.patch");
    const published=await invoke({...request,output},{file:"generated bytes"});assert(!published.isError);assert.equal(published.structuredContent.data.publication,"published");assert.equal(published.structuredContent.data.artifact!.content,null);assert.equal(await fs.readFile(output,"utf8"),"generated bytes");
    const forged=structuredClone(published.structuredContent);forged.data.resolved!.output=join(root,"other.patch");assert(!validatePatchOutput(forged));
    const existing=await invoke({...request,output},{file:"not run"});assert(existing.isError);assert.equal(calls.length,0);assert.equal(await fs.readFile(output,"utf8"),"generated bytes");
    const race=join(root,"race.patch"),raced=await invoke({...request,output:race},{file:"package bytes",race});assert(raced.isError);assert.equal(raced.structuredContent.data.effect,"artifact-observed");assert.equal(raced.structuredContent.data.publication,"not-published");assert.equal(await fs.readFile(race,"utf8"),"concurrent writer");
    const emptyOutput=join(root,"empty.patch"),rejected=await invoke({...request,output:emptyOutput},{file:""});assert(rejected.isError);assert.equal(rejected.structuredContent.data.artifact!.bytes,0);await assert.rejects(fs.lstat(emptyOutput),{code:"ENOENT"});
    const missing=await invoke({...request,output:join(root,"missing","p.patch")},{file:"not run"});assert(missing.isError);assert.equal(calls.length,0);
    const original={...request,output:join(root,"snapshot.patch"),clean:false};
    const snap=await invoke(original,{file:"snapshot bytes",onSpawn:()=>{original.output=output;original.clean=true;}});assert(!snap.isError);assert.equal(snap.structuredContent.data.requested!.clean,false);assert.notEqual(snap.structuredContent.data.requested!.output,original.output);
    const registry=await loadRegisteredTools(),native=registry.get("plastic_patch")!,before={...request,output_file:"unused",format:"markdown",preflight:true};const copy=structuredClone(before),prepared=native.prepareArguments!(before);assert.deepEqual(before,copy);assert.equal(prepared.format,"text");assert.equal(prepared.output,"unused");assert(!Object.hasOwn(prepared,"output_file"));
    const core=patch.execute;patch.execute=async()=>{throw Error("No core reparsing");};try{const registered=await runWithAbortSignal(undefined,()=>native.execute("fixture",{...request,preflight:true}),deps({}));assert(validatePatchOutput(registered.structuredContent));assert.deepEqual(registered.details,{});}finally{patch.execute=core;}
    const coreText=await runWithAbortSignal(undefined,()=>patch.execute({...request,preflight:true}),deps({}));assert.equal(JSON.parse(coreText).outcome,"preflight");await assert.rejects(()=>patch.execute({...request,source:"--apply"}));
    const abort=new AbortController();abort.abort();const aborted=await runWithAbortSignal(abort.signal,()=>executePatchOutput(request),deps({file:"not run"}));assert(validatePatchOutput(aborted.structuredContent));assert(aborted.isError);assert.equal(aborted.structuredContent.data.effect,"not-attempted");
    console.log("PASS: typed patch request/argv/selector/snapshot/preflight/native/core; 4MiB files, hash/UTF8/empty/excerpts, no-overwrite publication, warnings/failures/retention and no retries/substitutions");
} finally {await fs.rm(root,{recursive:true,force:true});}
