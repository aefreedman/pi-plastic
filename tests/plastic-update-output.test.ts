import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { executeUpdateOutput, validateUpdateOutput } from "../src/pi/update-output";
import { UPDATE_ARGV, emptyUpdateData } from "../src/operations/update-receipt";
import { runWithAbortSignal } from "../src/execution/context";
import { loadRegisteredTools } from "./pi-tool-harness";
assert(Object.isFrozen(UPDATE_ARGV));
const owned = emptyUpdateData();
assert.notEqual(owned.intendedArgv,UPDATE_ARGV);
(owned.intendedArgv as unknown as string[])[0]="foreign-mutation";
assert.deepEqual(emptyUpdateData().intendedArgv,["update","--dontmerge","--noinput"]);
const cwd = "C:\\Example\\workspace";
let calls: string[][] = [];
const fake = (out: Buffer, err = Buffer.alloc(0), code = 0, mode = "normal") => ({ spawn: ((_cmd: string, args: string[], options: any) => {
    calls.push([...args]); assert.equal(options.cwd, cwd); assert.equal(options.shell, false);
    if (mode === "throw") throw Error("private launch diagnostic");
    const child = Object.assign(new EventEmitter(), { stdout: Readable.from([out]), stderr: Readable.from([err]), kill: () => true });
    process.nextTick(() => { if (mode !== "missing-start") child.emit("spawn"); child.emit("close", code, null); }); return child;
}) as any });
for (const [stdout, stderr, code, mode, outcome] of [
    [Buffer.alloc(0), Buffer.alloc(0), 0, "normal", "command-completed"],
    [Buffer.from("Progress é-é-日本-😀"), Buffer.from("warning"), 0, "normal", "command-completed"],
    [Buffer.from("partially updated"), Buffer.from("private failure"), 1, "normal", "uncertain"],
    [Buffer.from([0xff]), Buffer.alloc(0), 0, "normal", "uncertain"],
    [Buffer.alloc(0), Buffer.alloc(0), 0, "missing-start", "uncertain"],
    [Buffer.alloc(0), Buffer.alloc(0), 0, "throw", "failed"],
] as const) {
    calls = []; const result = await runWithAbortSignal(undefined, () => executeUpdateOutput({workdir:cwd}), fake(stdout, stderr, code, mode));
    assert(validateUpdateOutput(result.structuredContent)); assert.equal(result.structuredContent.outcome, outcome);
    assert.equal(result.isError, outcome !== "command-completed"); assert.deepEqual(calls, [["update", "--dontmerge", "--noinput"]]);
    assert.deepEqual(result.details, {}); assert.equal(result.structuredContent.data.observedChanges, null);
    assert(!JSON.stringify(result).includes("private failure"));
    if (result.structuredContent.ok) {
        for (const modify of [ (v:any)=>v.data.attempt.exitCode=1, (v:any)=>v.data.capture.complete=false, (v:any)=>v.data.capture.stdoutRetainedBytes++, (v:any)=>v.data.intendedArgv.push("--forced"), (v:any)=>v.data.observedChanges=0, (v:any)=>v.data.extra=true, (v:any)=>v.extra=true, (v:any)=>v.data.workingDirectory="\uD800" ]) {
            const forged=structuredClone(result.structuredContent);modify(forged);assert.equal(validateUpdateOutput(forged),false);
        }
    }
}
for (const args of [null, [], {workdir:""}, {workdir:"x".repeat(4097)}, {workdir:"\uD800"}, {workdir:"a\nb"}, {workdir:4}, {workdir:cwd,preflight:true}, {workdir:cwd,format:"json"}]) {
    calls=[];const result=await runWithAbortSignal(undefined,()=>executeUpdateOutput(args),fake(Buffer.alloc(0)));
    assert(validateUpdateOutput(result.structuredContent));assert.equal(result.structuredContent.outcome,"failed");assert.equal(calls.length,0);
}
const abort=new AbortController();abort.abort();calls=[];
const preabort=await runWithAbortSignal(abort.signal,()=>executeUpdateOutput({workdir:cwd}),fake(Buffer.alloc(0)));
assert(validateUpdateOutput(preabort.structuredContent));assert.equal(preabort.structuredContent.data.attempt.aborted,true);assert.equal(calls.length,0);
const tools=await loadRegisteredTools();calls=[];
const native=await runWithAbortSignal(undefined,()=>tools.get("plastic_update")!.execute("update-fixture",{},undefined,undefined,{cwd}),fake(Buffer.alloc(0)));
assert(validateUpdateOutput(native.structuredContent));assert.equal(native.structuredContent.data.workingDirectory,cwd);assert.equal(calls.length,1);
console.log("PASS: update native/core intent, opaque completion/warnings, uncertain/nonstart failures, closed semantics, input/preabort/context and one-command counts");
