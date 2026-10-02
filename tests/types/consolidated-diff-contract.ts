import type { Static } from "typebox";
import { diffInputSchema } from "../../src/pi/diff-output";
import type { DiffRequest } from "../../src/operations/consolidated-diff";
type Input = Static<typeof diffInputSchema>;
const file: Input = {mode:"file",path:"Assets/Example.txt"};
const selected: Input = {mode:"workspace",paths:["Assets/Example.txt"]};
const all: Input = {mode:"workspace",allPending:true,includePrivate:true};
const revisions: Input = {mode:"revisions",leftRevision:"revid:1",rightRevision:"revid:2"};
const runtime: DiffRequest[] = [file,selected,all,revisions];
// @ts-expect-error File requests do not accept workspace fields.
const crossMode: Input = {mode:"file",path:"Assets/Example.txt",allPending:true};
// @ts-expect-error Selected paths do not accept includePrivate.
const crossScope: Input = {mode:"workspace",paths:["Assets/Example.txt"],includePrivate:true};
// @ts-expect-error Explicit true is required.
const falseAll: Input = {mode:"workspace",allPending:false};
function narrow(input: Input) {
 if(input.mode==="file")return input.path;
 if(input.mode==="revisions")return input.leftRevision;
 if(input.paths!==undefined)return input.paths.join(",");
 return input.allPending;
}
void [runtime,crossMode,crossScope,falseAll,narrow];
