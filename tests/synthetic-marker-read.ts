import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
/** Explicit synthetic native-baseline adaptation for historical state-machine
 * tests. Existing call traces describe their original status/mutation scenario;
 * marker read ordering/failures/counts are tested in marker integration tests. */
export function syntheticClearMarkerRead(argv: string[]) {
 if (argv.length !== 2 || argv[0] !== "merge" || argv[1] !== "--list-conflict-markers") return undefined;
 const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { return false; } });
 queueMicrotask(() => { child.emit("spawn"); child.stdout.end(); child.stderr.end(); child.emit("close", 0, null); });
 return child;
}
