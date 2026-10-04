import type { RemovalReceipt } from "../../src/operations/removal-receipt";
function consume(dto:RemovalReceipt){
 const items:null=dto.data.observedResolvedItems;
 const resolution:null=dto.data.observedResolution;
 const operandCount:number|null=dto.data.requestedOperandCount;
 if(!dto.ok){const code:string=dto.error.code;void code;}
 else{const outcome:"command-completed"|"preflight"=dto.outcome;void outcome;}
 // @ts-expect-error Requested operands never provide verified resolution counts.
 const count:number=dto.data.observedResolvedItems;
 // @ts-expect-error Resolved identities are not supplied from opaque output.
 const paths:string[]=dto.data.observedResolvedItems;
 void [items,resolution,operandCount,count,paths];
}
void consume;
