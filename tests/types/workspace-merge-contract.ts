import type { Static } from "typebox";
import { workspaceMergeOutputSchema } from "../../src/pi/workspace-merge-output";
import type { WorkspaceMergeReceipt } from "../../src/domain/workspace-merge-contract";
type Expect<T extends true> = T;
type Same<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Native = Expect<Same<Static<typeof workspaceMergeOutputSchema>,WorkspaceMergeReceipt>>;
function facts(d:WorkspaceMergeReceipt){const finalized:null=d.data.observedFinalizedMetadata;const preserved:null=d.data.observedPreservation;const readiness:"unknown"|"blocked"|"supported-no-unresolved-signals"=d.data.checkinReadiness; if(!d.ok){const error:string=d.error.message;return error;} return {finalized,preserved,readiness};}
void facts;
