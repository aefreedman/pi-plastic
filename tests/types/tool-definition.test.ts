import { tool } from "../../src/tool-definition";
import type { branchCreate, checkin, merge } from "../../src/plastic-core";
import type { PLASTIC_TOOL_REGISTRY } from "../../src/pi/tool-registry";
import type { branchCreate as ownedBranchCreate } from "../../src/operations/branches";
import type { checkin as ownedCheckin } from "../../src/operations/checkin";
import type { StatusObservation } from "../../src/operations/status";

type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const sample = tool({
  description: "Compile-only argument inference contract",
  args: {
    branch: tool.schema.string().min(1).describe("Required"),
    paths: tool.schema.array(tool.schema.string()).optional().max(5).describe("Optional array"),
    mode: tool.schema.enum(["auto", "source", "destination"]).optional(),
    limit: tool.schema.number().int().min(1).optional().describe("Optional integer"),
    force: tool.schema.boolean().optional(),
    value: tool.schema.any(),
    choice: tool.schema.union([tool.schema.string(), tool.schema.boolean()]),
  },
  execute(args) {
    const branch: string = args.branch;
    args.paths?.map(path => path.toUpperCase());
    // @ts-expect-error Contextual arguments must not degrade to any.
    args.branch.toFixed();
    // @ts-expect-error Enum values remain a literal union.
    const invalidMode: "invalid" = args.mode;
    // @ts-expect-error Arbitrary input must be narrowed before use.
    args.value.toString();
    return branch;
  },
});

type Arguments = Parameters<typeof sample.execute>[0];
type Branch = Expect<Equal<Arguments["branch"], string>>;
type Paths = Expect<Equal<Arguments["paths"], string[] | undefined>>;
type Mode = Expect<Equal<Arguments["mode"], "auto" | "source" | "destination" | undefined>>;
type Limit = Expect<Equal<Arguments["limit"], number | undefined>>;
type Force = Expect<Equal<Arguments["force"], boolean | undefined>>;
type Choice = Expect<Equal<Arguments["choice"], string | boolean>>;
type Result = Expect<Equal<ReturnType<typeof sample.execute>, string>>;

const valid: Arguments = { branch: "/main", value: {}, choice: true };
// @ts-expect-error Required schema fields cannot be omitted.
const missingBranch: Arguments = { value: {}, choice: false };
// @ts-expect-error Unknown-valued fields are still required unless explicitly optional.
const missingValue: Arguments = { branch: "/main", choice: "x" };
// @ts-expect-error Arrays retain element types.
const invalidPaths: Arguments = { ...valid, paths: [1] };
// @ts-expect-error Only declared enum values are accepted.
const invalidMode: Arguments = { ...valid, mode: "invalid" };

type CoreBranch = Expect<Equal<Parameters<typeof branchCreate.execute>[0]["branch"], string>>;
type CoreCheckinPaths = Expect<Equal<Parameters<typeof checkin.execute>[0]["paths"], string[] | undefined>>;
type CoreMergeStrategy = Expect<Equal<Parameters<typeof merge.execute>[0]["strategy"], "auto" | "source" | "destination" | undefined>>;
type CoreResult = Expect<Equal<ReturnType<typeof checkin.execute>, Promise<string>>>;

// Extraction and explicit registry wiring must retain the same inferred definitions.
type FacadeBranchOwner = Expect<Equal<typeof branchCreate, typeof ownedBranchCreate>>;
type FacadeCheckinOwner = Expect<Equal<typeof checkin, typeof ownedCheckin>>;
type RegistryBranch = Expect<Equal<typeof PLASTIC_TOOL_REGISTRY.branchCreate, typeof branchCreate>>;
type RegistryCheckin = Expect<Equal<typeof PLASTIC_TOOL_REGISTRY.checkin, typeof checkin>>;
type RegistryMerge = Expect<Equal<typeof PLASTIC_TOOL_REGISTRY.merge, typeof merge>>;
type ObservationKinds = Expect<Equal<StatusObservation["kind"], "machine" | "standard" | "xml">>;

function narrowStatusObservation(observation: StatusObservation): void {
  if (observation.kind === "machine") {
    observation.pendingItems.map(item => item.workspacePath);
    // @ts-expect-error Machine observations do not contain standard status output.
    const shortOutput: string = observation.shortOutput;
  } else if (observation.kind === "standard") {
    const output: string = observation.shortOutput;
    // @ts-expect-error Standard observations do not contain parsed pending records.
    observation.pendingItems.map(item => item.workspacePath);
  }
}

// Public status schema must retain discriminants and exact fields, not never/any or an index signature.
import type { StatusOutput } from "../../src/pi/status-output";
type StatusFailure = Extract<StatusOutput, { ok: false }>;
type StatusErrorCodes = Expect<Equal<StatusFailure["error"]["code"], "command_failed" | "aborted" | "capture_incomplete" | "invalid_producer_data" | "output_overflow">>;
type StatusSuccess = Extract<StatusOutput, { ok: true }>;
type StatusModes = Expect<Equal<StatusSuccess["data"]["mode"], "machine" | "standard" | "xml">>;
type MachineData = Extract<StatusSuccess["data"], { mode: "machine" }>;
type ParseKeys = Expect<Equal<keyof MachineData["parse"], "valid" | "blank" | "header" | "unsupported" | "malformed" | "ambiguousLegacyMove">>;
type ItemKinds = Expect<Equal<MachineData["items"][number]["kind"], "added" | "changed" | "moved" | "deleted" | "private" | "other">>;
