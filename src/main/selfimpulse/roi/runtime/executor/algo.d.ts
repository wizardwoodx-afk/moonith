import { All, BaseCheckpointSaver, BaseStore, Checkpoint, CheckpointPendingWrite, PendingWrite, ReadonlyCheckpoint } from "../../checkpoint/index.d.ts";
import { RunnableConfig } from "../../core/runnables/index.d.ts";
import { CallbackManagerForChainRun } from "../../core/callbacks/manager.d.ts";

//#region src/executor/algo.d.ts
/**
 * Construct a type with a set of properties K of type T
 */
type StrRecord<K extends string, T> = { [P in K]: T };
//#endregion
export { StrRecord };
