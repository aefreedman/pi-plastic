import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Check } from "typebox/value";
import { executeSwitchOutput, switchOutputSchema, validateSwitchOutput } from "../src/pi/switch-output";
import { switchBranch } from "../src/operations/switch";
import { runWithAbortSignal } from "../src/execution/context";
import { parseSwitchPending, parseSwitchLoadedBranch } from "../src/domain/switch-contract";
import { loadRegisteredTools } from "./pi-tool-harness";
const behind: string = JSON.parse(readFileSync(new URL("./fixtures/plastic-behind-head-header.json", import.meta.url), "utf8")).stdout;
const cwd="C:\\Example\\workspace",us="\x1f",repo="Example Repository",server="example@unity";
const header=(b="/main/source",r=repo,s=server)=>`${b}@${r}@${s} (cs:123 - head)\r\n`;
const pending=(kind="")=>["STATUS","123",repo,server].join(us)+"\r\n"+(kind?kind.split(",").map((k,i)=>[k,cwd+`\\fixture-${i}.txt`,"False",k==="PR"||k==="AD"?"-1":"125","NO_MERGES"].join(us)+"\r\n").join(""):"");
type Slot={out?:string|Buffer;err?:string;code?:number;noSpawn?:boolean;stall?:boolean;throws?:boolean;streamError?:boolean};
async function invoke(args:Record<string,unknown>,slots:Slot[],core=false,registered=false){
 const calls:string[][]=[],children:any[]=[];const controller=new AbortController();
 const deps={timeoutMs:15,abortKillDelayMs:2,spawn:((_:string,argv:string[])=>{
  calls.push([...argv]);const slot=slots.shift();assert(slot,"Unexpected source command "+JSON.stringify(argv));if(slot.throws)throw Object.assign(Error("Private launch detail"),{code:"ENOENT"});
  const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});children.push(c);
  queueMicrotask(()=>{if(!slot.noSpawn)c.emit("spawn");if(slot.stall)return;if(slot.streamError)c.stdout.destroy(Error("Private stream detail"));else c.stdout.end(slot.out??"");c.stderr.end(slot.err??"");c.emit("close",slot.code??0,null);});return c;
 }) as any};
 const result=await runWithAbortSignal(controller.signal,()=>registered?tools.get("plastic_switchBranch")!.execute("behind-head",{...args,workdir:cwd},undefined,undefined,{cwd}):core?switchBranch.execute({...args,workdir:cwd} as any):executeSwitchOutput({...args,workdir:cwd}),deps);
 if(!core){const r=result as any;assert(Check(switchOutputSchema,r.structuredContent));assert(validateSwitchOutput(r.structuredContent));assert.equal(r.isError,!r.structuredContent.ok);assert.deepEqual(r.details,{});assert(!JSON.stringify(r.structuredContent).includes("Private stream detail"));}
 return {result:result as any,calls,children};
}
const empty=await executeSwitchOutput({});assert(empty.isError);assert(validateSwitchOutput(empty.structuredContent));
assert(!validateSwitchOutput({...empty.structuredContent,foreign:true}));
const tools=await loadRegisteredTools();assert.deepEqual(tools.get("plastic_switchBranch")!.outputSchema,switchOutputSchema);
{
 const clean=()=>[{out:header()},{out:pending()}];
 // Numeric head must not redirect loaded branch identity or imply latest content.
 for (const registered of [false,true]) {
  const r=await invoke({branch:`/main/evidence@${repo}@${server}`},[{out:behind},{out:pending()}],false,registered);
  assert.equal(r.result.structuredContent.outcome,"already-loaded");assert.equal(r.calls.length,2);
  assert.equal(r.result.structuredContent.data.branchBefore.branch,"/main/evidence");
  const switched=await invoke({branch:`/main/evidence@${repo}@${server}`},[{out:header()},{out:pending()},{out:""},{out:behind}],false,registered);
  assert.equal(switched.result.structuredContent.outcome,"switched");assert.equal(switched.calls.length,4);
  assert.equal(switched.result.structuredContent.data.targetVerification,"exact-qualifier-spelling");
  assert.deepEqual(Object.keys(switched.result.structuredContent.data.branchAfter).sort(),["basis","branch","repository","scope","server"]);
  const rejected=await invoke({branch:"/main/evidence"},[{out:behind+header()}],false,registered);
  assert(rejected.result.isError);assert.equal(rejected.calls.length,1);
 }

 const direct=await invoke({branch:"/main/target"},[...clean(),{out:""},{out:header("/main/target")}]);
 assert.equal(direct.result.structuredContent.outcome,"switched");assert.equal(direct.result.structuredContent.data.targetVerification,"name-only");assert.deepEqual(direct.calls.map(a=>a[0]),["status","status","switch","status"]);
 const text=direct.result.structuredContent;
 const json=await invoke({branch:"/main/target",format:"json"},[...clean(),{out:""},{out:header("/main/target")}]);assert.deepEqual(json.result.structuredContent,text);assert.deepEqual(json.calls,direct.calls);
 const qualified=`br:/main/target@${repo}@${server}`;
 const exact=await invoke({branch:qualified},[...clean(),{out:""},{out:header("/main/target")}]);assert.equal(exact.result.structuredContent.data.targetVerification,"exact-qualifier-spelling");assert.equal(exact.calls[2][3],qualified);
 const same=await invoke({branch:`/main/source@${repo}@${server}`},clean());assert.equal(same.result.structuredContent.outcome,"already-loaded");assert.equal(same.calls.length,2);
 const foreign=await invoke({branch:"/main/source@Other Repository@foreign@cloud"},[...clean(),{out:""},{out:header()}]);assert(foreign.result.isError);assert.equal(foreign.result.structuredContent.outcome,"command-completed-unverified");assert.equal(foreign.calls[2][3],"/main/source@Other Repository@foreign@cloud");
 const alias=await invoke({branch:`/main/target@${repo}@1111111111111@cloud`},[...clean(),{out:""},{out:header("/main/target")}]);assert(alias.result.isError);assert.equal(alias.result.structuredContent.data.serverAliasEquivalence,"unverified");
 for(const policy of [undefined,"cancel","bring","shelve"]){
  const priv=await invoke({branch:"/main/target",...(policy?{pendingChanges:policy}:{})},[{out:header()},{out:pending("PR")},...(policy==="cancel"?[]:[{out:""},{out:header("/main/target")}])]);
  assert.equal(priv.result.structuredContent.data.strategy,policy==="cancel"?"cancel-with-pending":"direct-switch-private-only");assert(!priv.calls.some(a=>a[0]==="shelveset"));
 }
 for(const policy of [undefined,"cancel","bring"]){
  const tracked=await invoke({branch:"/main/target",...(policy?{pendingChanges:policy}:{})},[{out:header()},{out:pending("CH,PR")}]);assert(tracked.result.isError);assert.equal(tracked.calls.length,2);
 }
 for(const [p,k] of [[undefined,""],["cancel","PR"],["bring","CH"],["shelve","CH"]] as const){
  const pre=await invoke({branch:"/main/target",preflight:true,...(p?{pendingChanges:p}:{})},[{out:header()},{out:pending(k)}]);assert.equal(pre.result.structuredContent.outcome,"preflight");assert(!pre.result.isError);assert.equal(pre.calls.length,2);assert.equal(pre.result.structuredContent.data.effect,"not-attempted");
 }
 const shelf=await invoke({branch:"/main/target",pendingChanges:"shelve"},[{out:header()},{out:pending("CH")},{out:"Some genuine-looking shelf text"},{out:""},{out:header("/main/target")}]);assert.equal(shelf.result.structuredContent.outcome,"switched");assert.equal(shelf.result.structuredContent.data.observedShelveset,null);assert.equal(shelf.calls.length,5);
 const emptyError=`Error: There are no changes in the workspace ${cwd}\r\n`;
 const recovered=await invoke({branch:"/main/target",pendingChanges:"shelve"},[{out:header()},{out:pending("CH")},{err:emptyError,code:1},{out:pending("PR")},{out:""},{out:header("/main/target")}]);assert(recovered.result.isError);assert.equal(recovered.result.structuredContent.data.usedNoChangesShelveRecovery,true);assert.equal(recovered.result.structuredContent.data.effect,"uncertain");assert.equal(recovered.calls.length,6);
 for(const recovery of [{err:"Private permission detail",code:1},{out:""},{out:"FOREIGN"},{out:pending("CH")}]){
  const r=await invoke({branch:"/main/target",pendingChanges:"shelve"},[{out:header()},{out:pending("CH")},{err:emptyError,code:1},recovery]);assert(r.result.isError);assert.equal(r.result.structuredContent.data.usedNoChangesShelveRecovery,false);assert.equal(r.calls.length,4);assert(!r.calls.some(a=>a[0]==="switch"));
 }
 for(const error of [{err:"Wrong prefix "+emptyError,code:1},{err:emptyError,code:2},{err:emptyError.replace(cwd,"C:\\Other"),code:1},{err:emptyError,code:1,noSpawn:true},{stall:true}]){
  const r=await invoke({branch:"/main/target",pendingChanges:"shelve"},[{out:header()},{out:pending("CH")},error]);assert(r.result.isError);assert.equal(r.calls.length,3);assert.equal(r.result.structuredContent.data.pendingRecovery,null);
 }
 for(const slot of [{err:"Private switch detail",code:1},{out:Buffer.from([255])},{noSpawn:true},{stall:true},{streamError:true},{throws:true}]){
  const r=await invoke({branch:"/main/target",pendingChanges:"shelve"},[{out:header()},{out:pending("CH")},{out:""},slot]);assert(r.result.isError);assert.equal(r.calls.length,4);assert.equal(r.result.structuredContent.data.steps[2].effect,"command-completed");assert.equal(r.result.structuredContent.data.branchAfter,null);
 }
 for(const post of [{err:"Private failed status",code:1},{out:"cs:123@rep:Example Repository@example@unity"},{out:header("/main/wrong")},{out:header("/main/target").replace("target","t?arget")}]){
  const r=await invoke({branch:"/main/target"},[...clean(),{out:""},post]);assert(r.result.isError);assert.equal(r.result.structuredContent.outcome,"command-completed-unverified");assert.equal(r.result.structuredContent.data.effect,"command-completed");assert.equal(r.calls.length,4);
 }
 for(const source of [{out:"cs:123@rep:Example Repository@example@unity\r\n"},{out:header().replace("source","s?ource")},{out:Buffer.from([255])},{noSpawn:true,out:header()},{err:"Private denied",code:1}]){
  const r=await invoke({branch:"/main/target"},[source]);assert(r.result.isError);assert.equal(r.calls.length,1);assert.equal(r.result.structuredContent.data.effect,"not-attempted");
 }
 for(const source of [{out:""},{out:"FOREIGN"},{out:pending()+"UNKNOWN\r\n"},{out:pending("CH").replace("125","125.5")},{out:pending("PR").replace("fixture-0","fi?xture-0")},{out:"x".repeat(1048577)}]){
  const r=await invoke({branch:"/main/target"},[{out:header()},source]);assert(r.result.isError);assert.equal(r.result.structuredContent.data.pendingBefore,null);assert.equal(r.calls.length,2);
 }
 const forged=structuredClone(direct.result.structuredContent);forged.data.targetVerification="exact-qualifier-spelling";assert(!validateSwitchOutput(forged));
 for(const change of [(d:any)=>d.data.pendingBefore.tracked++,(d:any)=>d.data.effect="not-attempted",(d:any)=>d.data.steps[2].attempt.state="unknown",(d:any)=>d.data.branchAfter.branch="/main/forged",(d:any)=>d.data.steps[2].argv[3]="/main/forged",(d:any)=>d.data.steps[3].capture.complete=false]){const d=structuredClone(text);change(d);assert(!validateSwitchOutput(d));}
 await assert.rejects(()=>invoke({branch:"/main/target"},[{out:header()},{out:pending("CH")}],true),/canceled/);
 await assert.rejects(()=>invoke({branch:"/main/target"},[...clean(),{err:"Denied",code:1}],true));
 const preview=await invoke({branch:"/main/target",preflight:true,format:"json"},clean(),true);assert.equal(typeof preview.result,"string");assert.match(preview.result,/"wouldRun": true/);
 const normalChildren=direct.children;for(const c of normalChildren){for(const emitter of [c,c.stdout,c.stderr])for(const event of ["spawn","close","error","data","end"])assert.equal(emitter.listenerCount(event),0,"Normal completion releases owned listeners");}
 const limited=await invoke({branch:"/main/target"},[...clean(),{stall:true}]);for(const c of limited.children){assert(c.listenerCount("error")<=1);assert.equal(c.listenerCount("close"),0);assert.equal(c.stdout.listenerCount("data"),0);}
}
assert.equal(parseSwitchPending(pending()+Array.from({length:20000},(_,i)=>["PR",cwd+`\\${i}.txt`,"False","-1","NO_MERGES"].join(us)+"\n").join(""),cwd).admitted,false);
assert.equal(parseSwitchLoadedBranch(header()+header()),null);
assert.deepEqual(parseSwitchLoadedBranch(behind),{branch:"/main/evidence",repository:repo,server,basis:"standard-status",scope:"loaded-workspace"});
// Synthetic adversarial derivatives; revision tokens never pass through JS numbers.
for (const id of ["0","9007199254740993","99999999999999999999"]) assert(parseSwitchLoadedBranch(behind.replace("head:43",`head:${id}`)));
for (const id of ["","-1","+43","043","43.0","43x","100000000000000000000","４３","43\u0000"]) {
 assert.equal(parseSwitchLoadedBranch(behind.replace("head:43",`head:${id}`)),null);
 assert.equal(parseSwitchLoadedBranch(behind.replace("cs:42",`cs:${id}`)),null);
}
for (const text of [behind+behind,behind+header(),header()+behind,behind.trimEnd()+" junk",behind.replace("/main/evidence","/main/e?vidence"),behind.replace("/main/evidence","/main/bad\\path"),behind.replace("example@unity","example@unity@cloud"),behind.replace("/main/evidence","/main/"+"x".repeat(4096)),"cs:42@rep:Example Repository@example@unity",behind.replace("/main/evidence","/main/\uD800")]) assert.equal(parseSwitchLoadedBranch(text),null);
assert.equal(parseSwitchLoadedBranch(behind.replace("/main/evidence","/main/résumé-é-日本-😀"))?.branch,"/main/résumé-é-日本-😀");
console.log("PASS: switch closed/semantic schemas, genuine-source shapes, same-observation formats, qualifier/fork safety, pending policy matrix, exact recovery admission, partial effects, core rejection, byte/record/lifecycle bounds and no retry");
