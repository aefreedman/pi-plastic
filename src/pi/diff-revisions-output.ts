import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { assembleDiffRevisionsObservation, presentDiffRevisions, diffRevisionsPayload, validDiffRevisionsSelector, DiffRevisionsError, DIFF_REVISIONS_FILE_BYTES, DIFF_REVISIONS_MAX_BYTES, DIFF_REVISIONS_EXCERPT_MARKER, type DiffRevisionsArgs, type DiffRevisionsErrorCode, type DiffRevisionsStage } from "../operations/diff-revisions";
import { getActiveAbortSignal } from "../execution/context";
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const integer = (max: number) => Type.Integer({ minimum: 0, maximum: max });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const common = { schemaVersion: Type.Literal(1), action: Type.Literal("diff-revisions"), provenance: object({ source: Type.Literal("plastic"), producer: Type.Literal("@aefree/pi-plastic"), contentTrust: Type.Literal("external") }) };
const side = object({ selector: Type.String({ minLength: 1, maxLength: 4096 }), kind: Type.Union([Type.Literal("file-qualified"), Type.Literal("global-revision")]), resolvedIdentity: Type.Null(), bytes: integer(DIFF_REVISIONS_FILE_BYTES), binary: Type.Boolean() });
export const diffRevisionsOutputSchema = Type.Union([
    object({ ...common, ok: Type.Literal(true), completeness: object({ read: Type.Literal("complete"), capture: Type.Literal("complete"), projection: Type.Boolean() }), data: object({
        scope: Type.Literal("explicit_selector_pair"), qualifierVerified: Type.Literal(false), resolvedIdentities: Type.Null(), comparisonKind: Type.Literal("revision-to-revision"), left: side, right: side,
        status: Type.Union([Type.Literal("changed"),Type.Literal("unchanged"),Type.Literal("binary-different")]), changed: Type.Boolean(), binary: Type.Boolean(), comparisonBasis: Type.Union([Type.Literal("byte_equality"),Type.Literal("diff_u")]),
        hunkCount: integer(1048576), capture: object({ diffStdoutBytes: nullable(integer(1048576)), diffExitCode: nullable(integer(1)) }),
        limits: object({ maxChars: Type.Integer({ minimum: 500, maximum: 20000 }), selectorCodeUnits: Type.Literal(4096), materializedBytesPerSide: Type.Literal(4194304), compactUtf8Bytes: Type.Literal(131072) }),
        excerpt: nullable(object({ countBasis: Type.Literal("normalized_diff_utf16"), text: Type.String({ maxLength: 20000 }), observedChars: integer(1060000), sourceChars: integer(20000), returnedChars: integer(20000), omittedChars: integer(1060000), markerChars: integer(100), truncated: Type.Boolean() })),
    }) }),
    object({ ...common, ok: Type.Literal(false), completeness: object({ read: Type.Literal("incomplete"), capture: Type.Literal("unknown"), projection: Type.Literal(false) }), error: object({ code: Type.Union([Type.Literal("invalid_selector"),Type.Literal("invalid_producer_data"),Type.Literal("materialization_failed"),Type.Literal("materialization_limit"),Type.Literal("cleanup_failed"),Type.Literal("invalid_utf8"),Type.Literal("malformed_output"),Type.Literal("command_failed"),Type.Literal("aborted"),Type.Literal("capture_incomplete"),Type.Literal("output_overflow")]), stage: Type.Union([Type.Literal("input"),Type.Literal("left"),Type.Literal("right"),Type.Literal("comparison"),Type.Literal("cleanup"),Type.Literal("producer")]), message: Type.String({ minLength: 1, maxLength: 256 }) }) }),
]);
export type DiffRevisionsOutput = Static<typeof diffRevisionsOutputSchema>;
const failure = (code: DiffRevisionsErrorCode, stage: DiffRevisionsStage): DiffRevisionsOutput => ({ ...{ schemaVersion: 1, action: "diff-revisions", provenance: { source: "plastic", producer: "@aefree/pi-plastic", contentTrust: "external" } } as const, ok: false, completeness: { read: "incomplete", capture: "unknown", projection: false }, error: { code, stage, message: "Historical revision comparison failed (" + code + ", " + stage + "); no verified comparison is available." } });
export function validateDiffRevisionsOutput(value: unknown): DiffRevisionsOutput {
    if (!Check(diffRevisionsOutputSchema,value)) return failure("invalid_producer_data","producer");
    const dto=value as DiffRevisionsOutput;
    if(dto.ok){
        const d=dto.data;
        if([d.left,d.right].some(s=>!validDiffRevisionsSelector(s.selector)||s.kind!==(s.selector.includes("#")?"file-qualified":"global-revision"))
            || d.binary!==(d.left.binary||d.right.binary) || d.status!==(d.changed?d.binary?"binary-different":"changed":"unchanged")) return failure("invalid_producer_data","producer");
        if(d.binary){
            if(d.comparisonBasis!=="byte_equality"||d.excerpt!==null||d.hunkCount!==0||d.capture.diffStdoutBytes!==null||d.capture.diffExitCode!==null||!dto.completeness.projection) return failure("invalid_producer_data","producer");
        }else{
            const e=d.excerpt;
            if(d.comparisonBasis!=="diff_u"||e===null||d.capture.diffStdoutBytes===null||d.capture.diffExitCode!==(d.changed?1:0)
                ||e.returnedChars!==e.text.length||e.returnedChars> d.limits.maxChars||e.returnedChars!==e.sourceChars+e.markerChars
                ||e.observedChars!==e.sourceChars+e.omittedChars||e.truncated!==(e.omittedChars>0)||dto.completeness.projection===e.truncated
                || /[\uD800-\uDFFF]/u.test(e.text)
                || (e.truncated ? !e.text.endsWith(DIFF_REVISIONS_EXCERPT_MARKER)||e.markerChars!==DIFF_REVISIONS_EXCERPT_MARKER.length : e.markerChars!==0)
                || (d.changed ? d.hunkCount<1||e.observedChars<1||d.capture.diffStdoutBytes<1 : d.hunkCount!==0||e.observedChars!==0||d.capture.diffStdoutBytes!==0)) return failure("invalid_producer_data","producer");
        }
    }
    if(Buffer.byteLength(JSON.stringify(dto),"utf8")>DIFF_REVISIONS_MAX_BYTES)return failure("output_overflow","producer");
    return dto;
}
export async function executeDiffRevisionsOutput(args: DiffRevisionsArgs){
    let dto: DiffRevisionsOutput, rawResult: string | undefined;
    try{
        const observation=await assembleDiffRevisionsObservation(args);
        if(getActiveAbortSignal()?.aborted)throw new DiffRevisionsError("aborted","comparison");
        dto=validateDiffRevisionsOutput(diffRevisionsPayload(observation));
        if(dto.ok) rawResult=await presentDiffRevisions(observation,args);
        if(getActiveAbortSignal()?.aborted)throw new DiffRevisionsError("aborted","comparison");
    }catch(error){dto=failure(error instanceof DiffRevisionsError?error.code:"invalid_producer_data",error instanceof DiffRevisionsError?error.stage:"producer");}
    dto=validateDiffRevisionsOutput(dto);
    return { content:[{type:"text" as const,text:dto.ok?rawResult!:dto.error.message}], structuredContent:dto, isError:!dto.ok, details:{exportName:"diffRevisions",rawResult:dto.ok?rawResult:undefined,...(args.workdir?{workdir:args.workdir}:{})} };
}
