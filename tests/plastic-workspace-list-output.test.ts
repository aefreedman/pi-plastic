import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { loadRegisteredTools } from "./pi-tool-harness";
import { runWithAbortSignal } from "../src/execution/context";
import { workspaceList } from "../src/operations/workspace";
import { parseWorkspaceListFields, validWorkspaceTemplate } from "../src/operations/workspace-list";
import { workspaceListOutputSchema, validateWorkspaceListOutput, type WorkspaceListOutput } from "../src/pi/workspace-list-output";
const registered = (await loadRegisteredTools()).get("plastic_workspaceList")!;
assert.deepEqual(registered.outputSchema, workspaceListOutputSchema);
const row = (i = 0, path = "C:\\Fictional\\space workspace") => `Workspace ${i}\tFICTIONAL\t${path}${i}\t00000000-0000-0000-0000-${i.toString(16).padStart(12,"0")}`;
let calls: string[][] = [], children: any[] = [];
type Options = { stderr?: Buffer | string; code?: number; split?: number; signal?: AbortSignal; abortDuring?: AbortController; timeout?: boolean; spawnThrow?: boolean; spawnError?: boolean; streamError?: boolean; decoded?: boolean; decodedStderr?: boolean; premature?: boolean; outputLimitChars?: number };
async function invoke(output: Buffer | string = row() + "\r\n", args: Record<string, unknown> = {}, options: Options = {}) {
    calls = []; children = [];
    const spawn = ((_command: string, argv: string[], spawnOptions: any) => {
        assert.equal(spawnOptions.shell, false); calls.push(argv);
        if (options.spawnThrow) throw Error("private spawn diagnostic");
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("close", 1); }); return true; } });
        if (options.decoded) child.stdout.setEncoding("utf8");
        if (options.decodedStderr) child.stderr.setEncoding("utf8");
        children.push(child);
        queueMicrotask(() => {
            if (options.spawnError) { child.emit("error", Error("private spawn diagnostic")); return; }
            if (options.timeout) return;
            if (options.premature) { child.stdout.destroy(); child.stderr.end(); child.emit("close", 0); return; }
            if (options.streamError) { child.stdout.destroy(Error("private stream diagnostic")); child.stderr.end(); child.emit("close", 0); return; }
            const bytes = Buffer.from(output);
            if (options.split !== undefined) { child.stdout.write(bytes.subarray(0, options.split)); child.stdout.write(bytes.subarray(options.split)); }
            else child.stdout.write(bytes);
            child.stderr.end(options.stderr ?? ""); child.stdout.end();
            options.abortDuring?.abort(); child.emit("close", options.code ?? 0);
        });
        return child;
    }) as any;
    const result = await runWithAbortSignal(options.signal ?? options.abortDuring?.signal, () => registered.execute("synthetic", { source: "fields", ...args }, undefined, undefined, { cwd: "/synthetic" }), { spawn, ...(options.outputLimitChars !== undefined ? { outputLimitChars: options.outputLimitChars } : {}), ...(options.timeout ? { timeoutMs: 1, abortKillDelayMs: 1 } : {}) });
    assert(Check(workspaceListOutputSchema, result.structuredContent));
    assert.equal(result.isError, !result.structuredContent.ok);
    assert.doesNotMatch(JSON.stringify(result), /private (?:spawn|stream|stderr) diagnostic/);
    for (const child of children) {
        assert.equal(child.listenerCount("close"), 0); assert.equal(child.listenerCount("error"), 0);
        assert.equal(child.stdout.listenerCount("data"), 0); assert.equal(child.stderr.listenerCount("data"), 0);
    }
    return result;
}

const direct = await invoke(); const dto = direct.structuredContent;
assert(dto.ok); assert.equal(dto.data.rows[0].name, "Workspace 0");
assert.deepEqual(calls,[["workspace","list","--format={wkname}{tab}{machine}{tab}{path}{tab}{wkid}"]]);
assert.equal(dto.data.scope,"local_client_inventory"); assert.equal(dto.data.capability.originalVerification,"not_performed");
assert.equal(dto.completeness.read,"complete_under_ascii_prerequisite");
for(const output of ["text","json"]) { const r=await invoke(row(),{output});assert.deepEqual(r.structuredContent,dto);assert.equal(calls.length,1); }
assert.deepEqual(JSON.parse((await invoke(row(),{output:"json"})).details.rawResult),dto);
for(const suffix of ["","\n","\r\n"]) assert.equal((await invoke(row()+suffix)).isError,false);
assert.equal((await invoke(row(0,"/fictional/space workspace"))).isError,false);
const empty=await invoke("");assert.deepEqual(empty.structuredContent.data.rows,[]);assert.deepEqual(empty.structuredContent.data.counts,{observed:0,returned:0,omitted:0,excluded:0});
assert.equal((await invoke(row(),{format:""})).isError,false);
for(const args of [{format:"{path}"},{format:" "},{maxItems:0},{maxItems:501},{maxItems:1.5},{source:"xml"},{output:"xml"},{format:"x".repeat(4097)},{format:"a\0b"},{format:"\ud800"}]){assert.equal((await invoke(row(),args)).isError,true);assert.equal(calls.length,0);}
const full=Array.from({length:600},(_,i)=>row(i)).join("\n");
const projection=await invoke(full);assert.deepEqual(projection.structuredContent.data.counts,{observed:600,returned:100,omitted:500,excluded:0});
assert.equal(projection.structuredContent.completeness.projection,false);
assert.equal((await invoke(full,{maxItems:500})).structuredContent.data.rows.length,500);
for(const bad of ["\n",row()+"\n\n",row()+"\r","junk",row()+"\textra",row().replace("\tFICTIONAL",""),row().replace("Workspace","Work?space"),row().replace("FICTIONAL","FICT?ONAL"),row().replace("space workspace","space?workspace"),row().replace("Workspace","日本"),row().replace("Workspace","café"),row().replace("Workspace","é"),row().replace("Workspace","😀"),row().replace("C:\\Fictional\\space workspace","relative"),row().replace("Workspace","Work\x7fspace"),row().replace("00000000-0000-0000-0000-000000000000","invalid"),Buffer.concat([Buffer.from([239,187,191]),Buffer.from(row())]),full+"\n"+row(0).replace("FICTIONAL","OTHER"),full+"\njunk",row().replace("Workspace 0","x".repeat(4097)),row().replace("C:\\Fictional\\space workspace0","/"+"x".repeat(4096))]){const r=await invoke(bad);assert.equal(r.isError,true,String(bad).slice(0,30));assert.equal(r.structuredContent.data,undefined);}
assert.equal((await invoke(row().replace("Workspace 0","x".repeat(4096)))).isError,false);
assert.equal((await invoke(row().replace("C:\\Fictional\\space workspace0","/"+"x".repeat(4095)))).isError,false);
assert.equal((await invoke(Array.from({length:20000},(_,i)=>`${i.toString(36)}\tM\t/${i.toString(36)}\t00000000-0000-0000-0000-${i.toString(16).padStart(12,"0")}`).join("\n"),{maxItems:1})).isError,false);
assert.equal((await invoke(Array.from({length:20001},(_,i)=>`${i.toString(36)}\tM\t/${i.toString(36)}\t00000000-0000-0000-0000-${i.toString(16).padStart(12,"0")}`).join("\n"),{maxItems:1})).structuredContent.error.code,"capture_incomplete");
assert.equal((await invoke(Buffer.alloc(1048577,32))).structuredContent.error.code,"capture_incomplete");
for(const options of [{stderr:"private stderr diagnostic"},{code:1},{spawnThrow:true},{spawnError:true},{streamError:true},{premature:true},{decoded:true},{decodedStderr:true},{timeout:true},{abortDuring:new AbortController()}])assert.equal((await invoke(row(),{},options)).isError,true);
assert.equal((await invoke(row(),{},{stderr:Buffer.alloc(65537,32)})).structuredContent.error.code,"capture_incomplete");
assert.equal((await invoke(row(),{},{stderr:Buffer.alloc(65536,32)})).structuredContent.error.code,"command_failed");
const aborted=new AbortController();aborted.abort();assert.equal((await invoke(row(),{},{signal:aborted.signal})).structuredContent.error.code,"aborted");assert.equal(calls.length,0);
for(let split=1;split<Buffer.byteLength(row());split++)assert.equal((await invoke(row(),{},{split})).isError,false);
const native=await invoke("  legacy table\n",{source:"native"});assert.equal(native.details.rawResult,"legacy table");
assert.equal(native.structuredContent.data.rows,null);assert.equal(native.structuredContent.data.counts,null);
assert.deepEqual(native.structuredContent.completeness,{read:"unknown",capture:"unknown",projection:false});assert.deepEqual(calls,[["workspace","list"]]);
assert.equal((await invoke("",{source:"native",format:""})).details.rawResult,"(no output)");assert.deepEqual(calls,[["workspace","list"]]);
for(const template of ["{path}","{wkname}{tab}{newline}","\t\n", "日本😀"]){assert.equal((await invoke("custom",{source:"native",format:template})).isError,false);assert.deepEqual(calls,[["workspace","list","--format="+template]]);}
assert(validWorkspaceTemplate("😀"));assert(!validWorkspaceTemplate("\ud800"));
const legacyJson=await invoke("table",{source:"native",output:"json"});assert.deepEqual(calls,[["workspace","list"],["version"]]);assert.match(legacyJson.details.rawResult,/cliVersion/);
assert.deepEqual(legacyJson.structuredContent,native.structuredContent);assert.equal((await invoke("table",{source:"native",output:"json"})).isError,false);assert.equal(calls.length,1,"version cache preserved");
assert.equal((await invoke("table",{source:"native"},{stderr:"legacy warning"})).details.rawResult,"table\nlegacy warning");
assert.equal((await invoke("",{source:"native"},{code:1,stderr:"private stderr diagnostic"})).structuredContent.error.code,"command_failed");
assert.equal((await invoke("table",{source:"native"},{timeout:true})).structuredContent.error.code,"capture_incomplete");
assert.equal((await invoke("table",{source:"native"},{outputLimitChars:1})).structuredContent.error.code,"capture_incomplete");
const wrong=structuredClone(dto);wrong.data.counts.observed++;assert.equal(validateWorkspaceListOutput(wrong).ok,false);
const foreign=structuredClone(dto);foreign.data.cwd="/private";assert.equal(validateWorkspaceListOutput(foreign).ok,false);
const boundary=structuredClone(dto);boundary.data.rows=Array.from({length:100},(_,i)=>({name:"Workspace "+i,path:"/fictional/"+i+"x".repeat(1200),guid:"00000000-0000-0000-0000-"+i.toString(16).padStart(12,"0")}));
boundary.data.counts={observed:100,returned:100,omitted:0,excluded:0};
const padding=131072-Buffer.byteLength(JSON.stringify(boundary));assert(padding>0&&padding<2900);boundary.data.rows[99].path+="x".repeat(padding);
assert.equal(validateWorkspaceListOutput(boundary).ok,true);boundary.data.rows[99].path+="x";assert.equal((validateWorkspaceListOutput(boundary) as any).error.code,"output_overflow");
const rawRows=Array.from({length:300},(_,i)=>row(i,"/fictional/"+ "x".repeat(3419)));let raw=rawRows.join("\n")+"\n";const rawPadding=1048576-Buffer.byteLength(raw);assert(rawPadding>=0&&rawPadding<4096-3450);rawRows[299]=rawRows[299].replace("/fictional/","/fictional/"+"x".repeat(rawPadding));raw=rawRows.join("\n")+"\n";assert.equal(Buffer.byteLength(raw),1048576);assert.equal((await invoke(raw,{maxItems:1})).isError,false);
// Timeout escalation, drain and all listener/timer cleanup when SIGTERM is ignored.
const kills: string[] = [], timers = new Set<NodeJS.Timeout>(); let escalating: any;
const spawn = (() => {
    escalating = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal: string) => {
        kills.push(signal); if (signal === "SIGKILL") queueMicrotask(() => { escalating.stdout.end(); escalating.stderr.end(); escalating.emit("close", null); }); return true;
    } }); return escalating;
}) as any;
const timed = await runWithAbortSignal(undefined, () => registered.execute("synthetic", { source: "fields" }, undefined, undefined, { cwd: "/synthetic" }), { spawn, timeoutMs: 1, abortKillDelayMs: 1, setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; }, clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); } });
assert.deepEqual(kills, ["SIGTERM", "SIGKILL"]); assert.equal(timers.size, 0); assert.equal(timed.structuredContent.error.code, "capture_incomplete");
assert.equal(escalating.stdout.listenerCount("data"), 0); assert.equal(escalating.listenerCount("close"), 0);

let coreCalls:string[][]=[];
const coreSpawn=((_command:string,argv:string[])=>{coreCalls.push(argv);const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});queueMicrotask(()=>{child.stdout.end(argv.includes("--format={wkname}{tab}{machine}{tab}{path}{tab}{wkid}")?row()+"\n":"  table\n");child.stderr.end();child.emit("close",0);});return child;}) as any;
assert.equal(await runWithAbortSignal(undefined,()=>workspaceList.execute({}),{spawn:coreSpawn}),"table");
assert.equal(await runWithAbortSignal(undefined,()=>workspaceList.execute({format:"{path}"}),{spawn:coreSpawn}),"table");assert.deepEqual(coreCalls[1],["workspace","list","--format={path}"]);
assert.deepEqual(JSON.parse(await runWithAbortSignal(undefined,()=>workspaceList.execute({source:"fields",output:"json"}),{spawn:coreSpawn})),dto);assert(!coreCalls.flat().includes("version"));
const narrow=(value:WorkspaceListOutput)=>value.ok&&value.data.mode==="fields"?value.data.rows.map(r=>r.guid):value.ok?value.data.rows:value.error.code;assert.deepEqual(narrow(dto),[dto.data.rows[0].guid]);
assert.deepEqual(parseWorkspaceListFields(Buffer.alloc(0)),{rows:[],duplicateRecords:0});
const repeats=await invoke(full+"\n"+row(0),{maxItems:1});assert.equal(repeats.isError,false);assert.equal(repeats.structuredContent.data.counts.observed,601);assert.equal(repeats.structuredContent.data.diagnostics.duplicateRecords,1);
const repeated=await invoke(row()+"\n"+row());assert.equal(repeated.structuredContent.data.rows.length,2);assert.equal(repeated.structuredContent.data.diagnostics.duplicateRecords,1);
console.log("PASS: workspace-list ASCII prerequisite, producer, transport, schema, projection and legacy compatibility");
