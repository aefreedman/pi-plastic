import type {Static} from "typebox";import {shelvesetDeleteOutputSchema,codeReviewDeleteOutputSchema} from "../../src/pi/object-delete-output";declare const shelf:Static<typeof shelvesetDeleteOutputSchema>;declare const review:Static<typeof codeReviewDeleteOutputSchema>;const action:"shelveset-delete"=shelf.action;const other:"code-review-delete"=review.action;const observed:null=shelf.data.observedDeletedObjects;if(shelf.data.requested){const repo:null=shelf.data.requested.repository;void repo;}if(shelf.ok){const outcome:"preflight"|"command-completed"=shelf.outcome;void outcome;
// @ts-expect-error success has no error
shelf.error;}else{const code:string=shelf.error.code;void code;}
// @ts-expect-error identities are not emitted as deletion facts
const identities:string[]=review.data.observedDeletedObjects;
// @ts-expect-error scalar tool schema has exact action
const wrong:"code-review-delete"=shelf.action;
void action;void other;void observed;void identities;void wrong;
