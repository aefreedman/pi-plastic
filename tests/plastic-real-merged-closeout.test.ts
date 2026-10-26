import { syntheticClearMarkerRead } from "./synthetic-marker-read";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal } from "../src/execution/context";
import { executeCloseoutOutput, validateCloseoutOutput } from "../src/pi/closeout-output";
import { mergeToBranch } from "../src/operations/closeout";
import { parseSwitchTarget } from "../src/domain/switch-contract";
import { loadRegisteredTools } from "./pi-tool-harness";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/plastic-real-merged-profiles.json", import.meta.url), "utf8")).fixtures as Array<{ label: string; stdout: string }>;
const get = (label: string) => fixtures.find(f => f.label === label)!.stdout;
const cwd = "C:\\Example\\workspace", repo = "Example Repository", server = "example@unity";
// Captured sanitized payloads are positive producer evidence. Failure modes below
// are explicit synthetic derivatives; no native Plastic process is launched.
if (process.platform === "win32") {
    const tools = await loadRegisteredTools();
    for (const [applyLabel, machineLabel, fullLabel, checkinLabel, leaf] of [
        ["089-apply-files", "090-files-merged-machine", "090-files-merged-full", "091-files-merge-checkin", "files-source"],
        ["023-apply-mixed", "024-merged-machine", "024-merged-full", "027-merge-native-checkin", "source"],
    ]) {
        const apply = get(applyLabel), machine = get(machineLabel), full = get(fullLabel), native = get(checkinLabel);
        const source = `/main/evidence/${leaf}@${repo}@${server}`;
        const target = full.split("@")[0], id = /cs:([0-9]+)@br:/.exec(native)![1];
        const clean = machine.split("\r\n")[0] + "\r\n";
        const args = { source, target, message: "Synthetic resolved closeout", workdir: cwd };
        async function invoke(mode: string, route: "typed" | "registered" | "core" = "typed", format: "text" | "json" = "text") {
            let branch = parseSwitchTarget(source)!.branch, pending = false, checked = false, machineReads = 0, fullReads = 0;
            const calls: string[][] = [];
            const deps = { spawn: ((_: string, argv: string[]) => {
                const markerRead=syntheticClearMarkerRead(argv);if(markerRead)return markerRead;calls.push([...argv]);
                const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
                queueMicrotask(() => {
                    child.emit("spawn"); let out = "", err = "", code = 0;
                    if (argv[0] === "status") {
                        if (argv.includes("--machinereadable")) {
                            if (pending) machineReads++;
                            out = pending ? machine : clean;
                            if (pending && mode === "private") out = get("026-with-private-machine");
                            if (pending && mode === "extra-controlled") out += ["CO", cwd + String.fromCharCode(92) + "unrelated.txt", "False", "-1", "NO_MERGES"].join("\x1f") + "\r\n";
                            if (pending && mode === "standalone-race" && machineReads === 4) out = get("048-unresolved-machine");
                            if (pending && (mode === "unresolved" || mode === "readiness-changed" && machineReads === 2)) out = get("048-unresolved-machine");
                            if (checked && mode === "post-fail") { code = 1; err = "Synthetic final observation failure"; }
                        } else {
                            if (pending) fullReads++;
                            out = pending ? full : `${branch}@${repo}@${server} (cs:${checked ? id : "42"} - head)\r\n\r\n`;
                            if (pending && mode === "private") out = get("026-with-private-full");
                            if (pending && mode === "unresolved") out = get("048-unresolved-full");
                            if (pending && mode === "before-checkin-source" && fullReads === 2) out = full.replace(`at /main/evidence/${leaf}`, "at /main/other-source");
                        }
                    } else if (argv[0] === "switch") branch = target;
                    else if (argv[0] === "update") assert.deepEqual(argv, ["update", "--dontmerge", "--noinput"]);
                    else if (argv[0] === "merge" || argv[0] === "checkin") {
                        if (argv[0] === "merge") { pending = true; out = mode === "unresolved" ? get("047-apply-unresolved") : apply; if (mode === "warning") err = "Synthetic unsupported warning"; }
                        else { checked = true; pending = false; out = native; if (mode === "checkin-unknown") out += "unknown"; }
                        for (const [key, old] of [["--startlineseparator", "__EV_S__"], ["--endlineseparator", "__EV_E__"], ["--fieldseparator", "__EV_F__"]]) out = out.replaceAll(old, argv.find(a => a.startsWith(key + "="))!.slice(key.length + 1));
                    } else throw Error("Unexpected command " + JSON.stringify(argv));
                    child.stdout.end(out); child.stderr.end(err); child.emit("close", code, null);
                });
                return child;
            }) as any };
            // Exercise the exact production spelling regression through both
            // registered and core closeout, not only the low-level parser.
            const request = { ...args, workdir: format === "json" ? cwd.replaceAll("\\", "/") : cwd, format };
            const result = await runWithAbortSignal(undefined, () => route === "core"
                ? mergeToBranch.execute(request)
                : route === "registered" ? tools.get("plastic_mergeToBranch")!.execute("synthetic", request)
                    : executeCloseoutOutput(request), deps);
            return { result: result as any, calls };
        }
        for (const format of ["text", "json"] as const) {
            const { result, calls } = await invoke("success", "registered", format);
            const dto = result.structuredContent;
            assert(validateCloseoutOutput(dto)); assert(dto.ok); assert.equal(dto.data.createdChangeset?.id, id);
            assert.equal(dto.data.pendingAfter?.totalPending, 0);
            assert.equal(calls.filter(c => c[0] === "merge").length, 1); assert.equal(calls.filter(c => c[0] === "checkin").length, 1);
            const readiness = dto.data.stages.find(s => s.name === "readiness")!;
            assert.equal(readiness.kind, "read"); if (readiness.kind === "read") assert(readiness.result.argv.includes("--machinereadable"));
            const forged = structuredClone(dto), read = forged.data.stages.find(s => s.name === "readiness")!;
            if (read.kind === "read") read.result.argv = ["status"];
            assert(!validateCloseoutOutput(forged), "merged closeout cannot forge a clean-only readiness transport");
        }
        const core = await invoke("success", "core", "json");
        assert.equal(JSON.parse(core.result).data.createdChangeset.id, id);
        for (const mode of ["unresolved", "readiness-changed", "before-checkin-source", "warning", "checkin-unknown", "post-fail", "private", "extra-controlled", "standalone-race"]) {
            if (mode === "private" && leaf !== "source") continue;
            const { result, calls } = await invoke(mode);
            assert(validateCloseoutOutput(result.structuredContent), mode); assert.equal(!!result.isError, mode !== "private", mode);
            assert.equal(calls.filter(c => c[0] === "merge").length, 1, mode);
            assert.equal(calls.filter(c => c[0] === "checkin").length, ["checkin-unknown", "post-fail", "private"].includes(mode) ? 1 : 0, mode);
            assert(!calls.some(c => ["undo", "shelve"].includes(c[0])), "no compensation/replay");
            if (mode === "post-fail") assert.equal(result.structuredContent.data.createdChangeset?.id, id);
        }
    }
}
console.log("PASS: replacement/changed/mixed registered and core closeout; independent pending/link revalidation; unresolved stop-before-checkin and retained created identity without retry");
