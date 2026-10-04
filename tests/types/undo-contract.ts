import type { UndoReceipt } from "../../src/operations/undo-receipt";
function consume(dto:UndoReceipt){
 const items:null=dto.data.observedUndoneItems;
 const operandCount:number|null=dto.data.requestedOperandCount;
 if(!dto.ok){const code:string=dto.error.code;void code;}
 else{const outcome:"command-completed"=dto.outcome;void outcome;}
 // @ts-expect-error Requested operands never provide a verified undone count.
 const count:number=dto.data.observedUndoneItems;
 // @ts-expect-error Undone identities are not supplied from opaque output.
 const paths:string[]=dto.data.observedUndoneItems;
 void [items,operandCount,count,paths];
}
void consume;
