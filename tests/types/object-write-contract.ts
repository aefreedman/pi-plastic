import type {Static} from "typebox";
import {shelvesetCreateOutputSchema,shelvesetApplyOutputSchema,codeReviewCreateOutputSchema,codeReviewUpdateOutputSchema} from "../../src/pi/object-write-output";
declare const shelf:Static<typeof shelvesetCreateOutputSchema>;declare const apply:Static<typeof shelvesetApplyOutputSchema>;declare const review:Static<typeof codeReviewCreateOutputSchema>;declare const update:Static<typeof codeReviewUpdateOutputSchema>;
if(shelf.data.requested){const p:string[]|null=shelf.data.requested.paths;void p;}
if(apply.data.requested){const p:boolean=apply.data.requested.preview;void p;}
if(review.data.requested){const f:string|null=review.data.requested.format;void f;}
const state:null=update.data.observedUpdatedState;void state;
// @ts-expect-error no fabricated updated status
const status:string=update.data.observedUpdatedState;
void status;
