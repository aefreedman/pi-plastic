import type { Static } from "typebox";
import { closeoutOutputSchema } from "../../src/pi/closeout-output";
import type { CloseoutReceipt } from "../../src/domain/closeout-contract";
type Expect<T extends true> = T;
type Same<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Native = Expect<Same<Static<typeof closeoutOutputSchema>,CloseoutReceipt>>;
function facts(d:CloseoutReceipt){for(const s of d.data.stages){if(s.kind==="read"||s.kind==="command"){const complete:boolean=s.result.commandCompleted;void complete;}else {const ok:boolean=s.result.ok;void ok;}}return d.data.createdChangeset?.id??null;}
void facts;
