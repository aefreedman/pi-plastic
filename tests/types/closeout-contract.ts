import type { Static } from "typebox";
import { closeoutOutputSchema } from "../../src/pi/closeout-output";
import type { CloseoutReceipt } from "../../src/domain/closeout-contract";
type Expect<T extends true> = T;
type Same<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Native = Expect<Same<Static<typeof closeoutOutputSchema>,CloseoutReceipt>>;
function facts(d:CloseoutReceipt){const unverified:"unverified"=d.data.sourceLink;const changeset:string|null=d.data.createdChangeset?.id??null;for(const s of d.data.stages){if(s.kind==="read"){const complete:boolean|undefined=s.result.capture?.complete;void complete;}else {const ok:boolean=s.result.ok;void ok;}}if(!d.ok){const error:string=d.error.message;return error;}return{unverified,changeset};}
void facts;
