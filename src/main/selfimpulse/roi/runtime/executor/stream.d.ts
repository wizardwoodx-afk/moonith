import { StreamMode } from "./types.js";
import { BaseCallbackHandler } from "../../core/callbacks/base.d.ts";
import { IterableReadableStream } from "../../core/utils/stream.d.ts";

//#region src/executor/stream.d.ts
type StreamChunk = [string[], StreamMode, unknown];
//#endregion
export { StreamChunk };
