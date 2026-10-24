import { StateGraph } from "./state.js";
import { Messages } from "./messages_reducer.js";
import { RunnableConfig } from "../../core/runnables/index.d.ts";
import * as _selfimpulse_core_messages0 from "../../core/messages/index.d.ts";
import { BaseMessage, BaseMessageLike } from "../../core/messages/index.d.ts";

//#region src/graph/message.d.ts
/** @ignore */
declare class MessageGraph extends StateGraph<BaseMessage[], BaseMessage[], Messages> {
  constructor();
}
/**
 * Manually push a message to a message stream.
 *
 * This is useful when you need to push a manually created message before the node
 * has finished executing.
 *
 * When a message is pushed, it will be automatically persisted to the state after the node has finished executing.
 * To disable persisting, set `options.stateKey` to `null`.
 *
 * @param message The message to push. The message must have an ID set, otherwise an error will be thrown.
 * @param options RunnableConfig / Runtime coming from node context.
 */
declare function pushMessage(message: BaseMessage | BaseMessageLike, options?: RunnableConfig & {
  /**
   * The key of the state to push the message to. Set to `null` to avoid persisting.
   * @default "messages"
   */
  stateKey?: string | null;
}): BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>;
//#endregion
export { MessageGraph, pushMessage };
