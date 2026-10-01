import { AsyncLocalStorage } from "node:async_hooks";
import type { SpawnAndCollectDependencies } from "./process";

const abortSignalStorage = new AsyncLocalStorage<AbortSignal | undefined>();
export const commandExecutionStorage = new AsyncLocalStorage<SpawnAndCollectDependencies | undefined>();

export const getActiveAbortSignal = (): AbortSignal | undefined => abortSignalStorage.getStore();

export const runWithAbortSignal = async <T>(
    signal: AbortSignal | undefined,
    fn: () => Promise<T>,
    commandExecution?: SpawnAndCollectDependencies,
): Promise<T> =>
{
    const inheritedSignal = getActiveAbortSignal();
    const inheritedExecution = commandExecutionStorage.getStore();
    // Nested public-tool execution must retain an injected process seam and the
    // outer abort signal instead of silently dropping either boundary.
    return abortSignalStorage.run(signal ?? inheritedSignal, () => commandExecutionStorage.run(commandExecution ?? inheritedExecution, fn));
};
