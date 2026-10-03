import type { AddReceipt } from "../../src/operations/add-receipt";
function consume(dto:AddReceipt){
 const items:null=dto.data.observedAddedItems;
 const operandCount:number|null=dto.data.requestedOperandCount;
 if(!dto.ok){const code:string=dto.error.code;void code;}
 else{const outcome:"command-completed"=dto.outcome;void outcome;}
 // @ts-expect-error Requested operands never provide a verified added count.
 const count:number=dto.data.observedAddedItems;
 // @ts-expect-error Added identities are not supplied from opaque output.
 const paths:string[]=dto.data.observedAddedItems;
 void [items,operandCount,count,paths];
}
void consume;
