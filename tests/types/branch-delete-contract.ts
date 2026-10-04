import type { BranchDeleteReceipt } from "../../src/domain/branch-delete-contract";
import type { Static } from "typebox";
import { branchDeleteOutputSchema } from "../../src/pi/branch-delete-output";
declare const dto: Static<typeof branchDeleteOutputSchema>;
const receipt: BranchDeleteReceipt = dto;
if (!receipt.ok) { const message: string = receipt.error.message; void message; }
const deleted: null = receipt.data.observedDeletedBranch;
void deleted;
