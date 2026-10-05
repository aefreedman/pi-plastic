import type { Static } from "typebox";
import { patchOutputSchema } from "../../src/pi/patch-output";
declare const d: Static<typeof patchOutputSchema>;
const a: "patch"=d.action;
if (d.ok && d.data.artifact) { const b: number=d.data.artifact.bytes; void b; }
if (!d.ok) { const m: string=d.error.message; void m; }
// @ts-expect-error no guessed changeset identity
void d.data.createdChangeset;
void a;
