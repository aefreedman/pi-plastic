import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { captureCheckinCommand } from "../src/execution/checkin-command";
import { captureBranchCreateCommand } from "../src/execution/branch-create-command";
import { captureSwitchCommand } from "../src/execution/switch-command";
import { captureUpdateCommand } from "../src/execution/update-command";
import { captureAddCommand } from "../src/execution/add-command";
import { captureUndoCommand } from "../src/execution/undo-command";
import { captureRemovalCommand } from "../src/execution/removal-command";
import { runWithAbortSignal } from "../src/execution/context";
import { loadRegisteredTools } from "./pi-tool-harness";
import { validateCheckinOutput } from "../src/pi/checkin-output";
import { validateBranchCreateOutput } from "../src/pi/branch-create-output";

const modes = ["timeout-false-kill","timeout-thrown-kill","timeout-default-grace","abort-no-terminal","missing-spawn","terminal-open-pipes","capture-overflow","stream-error","repeated-errors"] as const;
const cwd = "C:\\Example\\workspace";
for (const capture of [captureCheckinCommand,captureBranchCreateCommand,captureSwitchCommand,captureUpdateCommand,captureAddCommand,captureUndoCommand,captureRemovalCommand]) {
  for (const mode of modes) {
    const controller = new AbortController(), timers = new Set<NodeJS.Timeout>(), kills: string[] = [], budgets: number[] = [];
    let dispatches = 0, signalHandlers = 0;
    const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((...args: Parameters<typeof add>) => { signalHandlers++; return add(...args); }) as typeof add;
    controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => { signalHandlers--; return remove(...args); }) as typeof remove;
    const child = Object.assign(new EventEmitter(), { stdout:new PassThrough(),stderr:new PassThrough(),kill(signal:string) { kills.push(signal); if (mode === "timeout-thrown-kill") throw Error("synthetic kill failure"); return false; } });
    const deps = {
      spawn: (() => { dispatches++; queueMicrotask(() => {
        if (mode !== "missing-spawn") child.emit("spawn");
        child.stdout.write(Buffer.from("é-é-日本-😀"));
        if (mode === "terminal-open-pipes") child.emit("close",0,null);
        if (mode === "capture-overflow") child.stdout.write(Buffer.alloc(65537,120));
        if (mode === "stream-error") child.stdout.emit("error",Error("synthetic stream failure"));
        if (mode === "repeated-errors") for (let i=0;i<3;i++) {
          child.emit("error",Error("synthetic process failure")); child.stdout.emit("error",Error("synthetic stream failure")); child.stderr.emit("error",Error("synthetic stream failure"));
        }
        if (mode === "abort-no-terminal") controller.abort();
      }); return child; }) as any,
      setTimeout: ((cb: () => void, delay: number) => { budgets.push(delay); const t = setTimeout(cb,Math.min(delay,3)); timers.add(t); return t; }) as any,
      clearTimeout: ((t:NodeJS.Timeout) => { clearTimeout(t); timers.delete(t); }) as any,
      abortKillDelayMs:mode === "timeout-default-grace"?undefined:3,
    };
    let watchdog:NodeJS.Timeout | undefined;
    const observation = await Promise.race([
      runWithAbortSignal(controller.signal, () => capture(["synthetic"],cwd),deps),
      new Promise<never>((_,reject) => { watchdog = setTimeout(() => reject(Error("Collector exceeded independent 250ms watchdog")),250); }),
    ]).finally(() => clearTimeout(watchdog));
    assert.equal(dispatches,1); assert.equal(observation.capture.complete,false); assert(observation.failed);
    assert.equal(observation.attempt.state,mode === "missing-spawn"?"unknown":"started");
    assert.equal(observation.attempt.terminal,mode === "terminal-open-pipes"?"observed":"not-observed");
    assert.equal(observation.attempt.exitCode,mode === "terminal-open-pipes"?0:null);
    assert.equal(observation.attempt.aborted,mode === "abort-no-terminal");
    assert.deepEqual(kills,mode === "terminal-open-pipes"?[]:["SIGTERM","SIGKILL"]);
    assert.deepEqual(budgets,mode === "timeout-default-grace"?[30000,5000,5000]:[30000,3,3],"Original command deadline, TERM grace, same post-KILL drain grace; no reset");
    assert.equal(observation.capture.stdoutRetainedBytes,mode === "capture-overflow"?65536:Buffer.byteLength("é-é-日本-😀"));
    assert.equal(observation.capture.truncated,mode === "capture-overflow");
    assert(observation.capture.stdoutBytes >= observation.capture.stdoutRetainedBytes);
    assert.equal(timers.size,0); assert.equal(signalHandlers,0); assert(child.stdout.destroyed && child.stderr.destroyed);
    for (const emitter of [child,child.stdout,child.stderr]) {
      for (const event of ["spawn","data","close","end"]) assert.equal(emitter.listenerCount(event),0);
      assert.equal(emitter.listenerCount("error"),1,"Only one inert late-error sink remains on forced retirement");
      assert.equal(emitter.listeners("error")[0].name,"ignoreRetiredError");
    }
    const frozen = JSON.stringify(observation);
    for (let i=0;i<3;i++) {
      child.emit("spawn"); child.stdout.emit("data",Buffer.from("late")); child.stderr.emit("data",Buffer.from("late"));
      for (const emitter of [child,child.stdout,child.stderr]) emitter.emit("error",Error("late synthetic error"));
      child.emit("close",0,null); child.stdout.emit("close"); child.stderr.emit("close");
    }
    controller.abort(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(JSON.stringify(observation),frozen,"Finalized observation cannot change after retirement");
  }
  // Genuinely complete normal terminal/capture leaves zero collector handlers.
  const normal = Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){throw Error("Unexpected kill");}});
  const complete = await runWithAbortSignal(undefined,()=>capture(["synthetic"],cwd),{spawn:(() => {queueMicrotask(()=>{normal.emit("spawn");normal.stdout.end("ok");normal.stderr.end();normal.emit("close",0,null);});return normal;}) as any});
  assert(complete.capture.complete);
  for (const emitter of [normal,normal.stdout,normal.stderr]) for (const event of ["spawn","data","close","end","error"]) assert.equal(emitter.listenerCount(event),0);
}

if (process.platform === "win32") {
  const tools = await loadRegisteredTools();
  for (const [tool,args,validate] of [
    ["plastic_checkin",{message:"Fixture",workdir:cwd},validateCheckinOutput],
    ["plastic_branchCreate",{branch:"/main/fixture",workdir:cwd},validateBranchCreateOutput],
  ] as const) {
    for (const terminal of [false,true]) {
    const calls:string[][]=[];
    const result = await runWithAbortSignal(undefined,()=>tools.get(tool)!.execute("retirement",args),{
      abortKillDelayMs:3,
      setTimeout:((cb:()=>void,ms:number)=>setTimeout(cb,Math.min(ms,3))) as any,
      spawn:((_:string,argv:string[])=>{
        calls.push(argv);const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;}});
        queueMicrotask(()=>{c.emit("spawn");if(argv[0]==="status"){c.stdout.end("STATUS\x1f1\x1fExample Repository\x1fexample@unity\r\n");c.stderr.end();c.emit("close",0,null);}else if(argv[0]==="checkin") { const sep=(k:string)=>argv.find(a=>a.startsWith(k+"="))!.slice(k.length+1);c.stdout.write(sep("--startlineseparator")+"CI_START"+sep("--endlineseparator")+"\r\n"); } if (terminal && argv[0] !== "status") c.emit("close",0,null); });return c;
      }) as any,
    });
    assert(validate(result.structuredContent));assert(result.isError);assert.equal(result.structuredContent.outcome,"uncertain");
    const dto = result.structuredContent;
    const attempt = tool === "plastic_checkin"?dto.data.steps[1].attempt:dto.data.attempt;
    assert.equal(attempt.terminal,terminal?"observed":"not-observed");
    assert.equal(attempt.exitCode,terminal?0:null);
    if (tool === "plastic_checkin") {assert.equal(dto.data.createdChangeset,null);assert.deepEqual(dto.data.observedChangesets,[]);}
    else assert.equal(dto.data.observedCreatedIdentity,null);
    assert.deepEqual(calls.map(a=>a[0]),tool==="plastic_checkin"?["status","checkin"]:["branch"],"No retry/duplicate mutation or verification after forced retirement");
    }
  }
}
console.log("PASS: seven selected collectors finite retirement, truthful missing/genuine terminal facts, false/thrown kills, abort/missing spawn/open pipes/partial overflow/stream errors, immutable late events, inert sinks, complete normal cleanup and native uncertainty/no retry");
