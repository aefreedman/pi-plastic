import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runWithAbortSignal } from "../src/execution/context";
export const cwd = process.cwd();
export function nativeFixture(options: { mergeCode?: number; checkinCode?: number; prefix?: string; invalidIdentity?: boolean; dirty?: boolean; links?: boolean; unknownOutput?: boolean; malformedAfter?: boolean; streamFailure?: boolean; updateCode?: number; initialTarget?: boolean; stderr?: string } = {}) {
    const calls: string[][] = [], kills: string[] = []; let branch = options.initialTarget ? "/main/target" : "/main/source";
    const deps = { spawn: ((_: string, args: string[]) => {
        calls.push([...args]); const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill(signal: string) { kills.push(signal); return false; } });
        queueMicrotask(() => { child.emit("spawn"); let out = "", code = 0;
            if (args[0] === "status") out = args.includes("--machinereadable") ? "STATUS\x1f42\x1fExample Repository\x1fexample@unity\r\n" + (options.dirty ? "UNKNOWN\x1fexternal pending row\r\n" : "") : `${branch}@Example Repository@example@unity (cs:42 - head)\r\n` + (options.links ? "Pending merge links\r\n" : "");
            else if (args[0] === "find") out = "/main/source|/main\r\n";
            else if (args[0] === "switch") branch = args.at(-1)!;
            else if (args[0] === "update") code = options.updateCode ?? 0;
            else if (args[0] === "merge") { out = options.prefix ?? "Unfamiliar native progress with multiple repositories\n"; code = options.mergeCode ?? 0; }
            else if (args[0] === "checkin") {
                code = options.checkinCode ?? 0;
                const sep = (key: string) => args.find(a => a.startsWith(key + "="))!.slice(key.length + 1);
                const frame = (op: string, value?: string) => sep("--startlineseparator") + op + (value === undefined ? "" : sep("--fieldseparator") + value) + sep("--endlineseparator") + "\r\n";
                out = options.prefix ?? "";
                out += options.unknownOutput ? "Future native output\n" : frame("CI_START") + frame("CHANGESET", options.invalidIdentity ? "unrecognized identity" : `cs:17@br:/main/linked@Linked Repository@example@unity (mount:'/linked'),cs:9007199254740997@br:${branch}@Example Repository@example@unity (mount:'/')`);
                if (options.malformedAfter) out += frame("CHANGESET", "malformed later field");
            } else throw Error("Unexpected command " + args[0]);
            const bytes = Buffer.from(out); for (let i = 0; i < bytes.length; i += 7) child.stdout.write(bytes.subarray(i, i + 7));
            if (options.streamFailure) child.stdout.emit("error", Error("synthetic stream error"));
            child.stdout.end(); child.stderr.end(options.stderr ?? ""); child.emit("close", code, null);
        }); return child;
    }) as typeof import("node:child_process").spawn };
    return { calls, kills, run: <T>(callback: () => Promise<T>) => runWithAbortSignal(undefined, callback, deps) };
}
