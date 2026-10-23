import type { Static } from "typebox";
import { codeReviewReviewerAddOutputSchema, codeReviewReviewerRemoveOutputSchema, codeReviewReviewerListOutputSchema, codeReviewSetStatusOutputSchema, codeReviewRequestReviewOutputSchema } from "../../src/pi/review-workflow-output";
declare const add:Static<typeof codeReviewReviewerAddOutputSchema>;
declare const remove:Static<typeof codeReviewReviewerRemoveOutputSchema>;
declare const list:Static<typeof codeReviewReviewerListOutputSchema>;
declare const status:Static<typeof codeReviewSetStatusOutputSchema>;
declare const request:Static<typeof codeReviewRequestReviewOutputSchema>;
const addAction:"reviewer-add"=add.action;
const removeAction:"reviewer-remove"=remove.action;
const listAction:"reviewer-list"=list.action;
const statusAction:"set-status"=status.action;
const requestAction:"request-review"=request.action;
const observed:null=list.data.observedMembership;
if(status.data.requested) {const own:"reviewed"|"rework-required"|"under-review"=status.data.requested.status;void own;}
if(request.data.requested) {
    const explicitAll:boolean=request.data.requested.all;
    // @ts-expect-error Re-request never accepts a comment.
    request.data.requested.comment;
    void explicitAll;
}
if(add.data.requested) {
    const users:string[]|null=add.data.requested.users;
    // @ts-expect-error Current reviewer selection is not legacy singular assignee.
    add.data.requested.assignee;
    void users;
}
void [addAction,removeAction,listAction,statusAction,requestAction,observed];
