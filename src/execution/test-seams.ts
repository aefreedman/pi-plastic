import { ExecutableEnvironment, resolveExecutable, spawnAndCollect } from "./process";
import { runCm, runCmRaw } from "./cm";

export const __plasticProcessInternals = {
    resolveCmExecutable: (environment: ExecutableEnvironment = process.env): string => resolveExecutable(environment, "PI_PLASTIC_CM_EXECUTABLE", "cm"),
    resolveDiffExecutable: (environment: ExecutableEnvironment = process.env): string => resolveExecutable(environment, "PI_PLASTIC_DIFF_EXECUTABLE", "diff"),
    spawnAndCollect,
    runCm,
    runCmRaw,
};
