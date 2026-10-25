import { ReducedValue } from "../values/reduced.js";
import { DeltaValue } from "../values/delta.js";
import { Messages } from "../../graph/messages_reducer.js";
import * as _selfimpulse_core_messages0 from "../../../core/messages/index.d.ts";
import { BaseMessage } from "../../../core/messages/index.d.ts";

//#region src/state/prebuilt/messages.d.ts
declare const MessagesValue: ReducedValue<BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[], Messages>;
/**
 * **Experimental.** A messages state field backed by a `DeltaChannel`.
 *
 * A drop-in alternative to {@link MessagesValue} that persists only per-step
 * message deltas (plus periodic snapshots) instead of the full accumulated
 * history in every checkpoint blob. Useful for long-running threads where
 * re-serializing the entire message list on each step is costly.
 *
 * @example
 * ```ts
 * import { StateSchema, MessagesDeltaValue } from "@selfimpulse/self_roi";
 *
 * const State = new StateSchema({ messages: MessagesDeltaValue });
 * ```
 */
declare const MessagesDeltaValue: DeltaValue<BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[], Messages>;
//#endregion
export { MessagesDeltaValue, MessagesValue };
