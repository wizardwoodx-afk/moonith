import { messagesDeltaReducer, messagesStateReducer } from "../../graph/messages_reducer.js";
import { ReducedValue } from "../values/reduced.js";
import { DeltaValue } from "../values/delta.js";
import { z } from "zod/v4";
//#region src/state/prebuilt/messages.ts
const messagesValueSchema = z.custom().default(() => []);
const messagesInputSchema = z.custom();
const MessagesValue = new ReducedValue(messagesValueSchema, {
	inputSchema: messagesInputSchema,
	reducer: messagesStateReducer,
	jsonSchemaExtra: {
		self_roi_type: "messages",
		description: "A list of chat messages"
	}
});
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
const MessagesDeltaValue = new DeltaValue(messagesValueSchema, {
	inputSchema: messagesInputSchema,
	reducer: messagesDeltaReducer,
	jsonSchemaExtra: {
		self_roi_type: "messages",
		description: "A list of chat messages"
	}
});
//#endregion
export { MessagesDeltaValue, MessagesValue };
