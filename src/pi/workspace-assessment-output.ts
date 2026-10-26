import { Type } from "typebox";
export const workspaceAssessmentSchema = Type.Object({
    ready: Type.Boolean(), complete: Type.Boolean(), rowCount: Type.Integer({ minimum: 0, maximum: 499 }), mergeRowCount: Type.Integer({ minimum: 0, maximum: 499 }), ordinaryRowCount: Type.Integer({ minimum: 0, maximum: 499 }), linkCount: Type.Integer({ minimum: 0, maximum: 20000 }),
    blockers: Type.Array(Type.Object({ code: Type.String({ minLength: 1, maxLength: 64 }), path: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]) }, { additionalProperties: false }), { maxItems: 8 }),
}, { additionalProperties: false });
