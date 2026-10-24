import { BaseChannel } from "../channels/base.js";
import { OverwriteValue } from "../constants.js";
import { ReducedZodChannel, SchemaMeta } from "./zod/meta.js";
import { AnnotationRoot } from "./annotation.js";
import { Messages } from "./messages_reducer.js";
import * as _selfimpulse_core_messages0 from "../../core/messages/index.d.ts";
import { BaseMessage } from "../../core/messages/index.d.ts";
import * as _selfimpulse_core_utils_types0 from "../../core/utils/types/index.d.ts";
import { z } from "zod/v3";

//#region src/graph/messages_annotation.d.ts
/**
 * Prebuilt state annotation that combines returned messages.
 * Can handle standard messages and special modifiers like {@link RemoveMessage}
 * instances.
 *
 * Specifically, importing and using the prebuilt MessagesAnnotation like this:
 *
 * @example
 * ```ts
 * import { MessagesAnnotation, StateGraph } from "@selfimpulse/self_roi";
 *
 * const graph = new StateGraph(MessagesAnnotation)
 *   .addNode(...)
 *   ...
 * ```
 *
 * Is equivalent to initializing your state manually like this:
 *
 * @example
 * ```ts
 * import { BaseMessage } from "../../core/messages/index.d.ts";
 * import { Annotation, StateGraph, messagesStateReducer } from "@selfimpulse/self_roi";
 *
 * export const StateAnnotation = Annotation.Root({
 *   messages: Annotation<BaseMessage[]>({
 *     reducer: messagesStateReducer,
 *     default: () => [],
 *   }),
 * });
 *
 * const graph = new StateGraph(StateAnnotation)
 *   .addNode(...)
 *   ...
 * ```
 */
declare const MessagesAnnotation: AnnotationRoot<{
  messages: BaseChannel<BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[], OverwriteValue<BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[]> | Messages, unknown>;
}>;
/**
 * Prebuilt schema meta for Zod state definition.
 *
 * @example
 * ```ts
 * import { z } from "zod/v4-mini";
 * import { MessagesZodState, StateGraph } from "@selfimpulse/self_roi";
 *
 * const AgentState = z.object({
 *   messages: z.custom<BaseMessage[]>().register(registry, MessagesZodMeta),
 * });
 * ```
 */
declare const MessagesZodMeta: SchemaMeta<BaseMessage[], Messages>;
/**
 * Prebuilt state object that uses Zod to combine returned messages.
 * This utility is synonymous with the `MessagesAnnotation` annotation,
 * but uses Zod as the way to express messages state.
 *
 * You can use import and use this prebuilt schema like this:
 *
 * @example
 * ```ts
 * import { MessagesZodState, StateGraph } from "@selfimpulse/self_roi";
 *
 * const graph = new StateGraph(MessagesZodState)
 *   .addNode(...)
 *   ...
 * ```
 *
 * Which is equivalent to initializing the schema object manually like this:
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import type { BaseMessage, BaseMessageLike } from "../../core/messages/index.d.ts";
 * import { StateGraph, messagesStateReducer } from "@selfimpulse/self_roi";
 * import "@selfimpulse/self_roi/zod";
 *
 * const AgentState = z.object({
 *   messages: z
 *     .custom<BaseMessage[]>()
 *     .default(() => [])
 *     .self_roi.reducer(
 *        messagesStateReducer,
 *        z.custom<BaseMessageLike | BaseMessageLike[]>()
 *     ),
 * });
 * const graph = new StateGraph(AgentState)
 *   .addNode(...)
 *   ...
 * ```
 */
declare const MessagesZodState: z.ZodObject<{
  messages: ReducedZodChannel<z.ZodType<BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[], z.ZodTypeDef, BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[]>, _selfimpulse_core_utils_types0.InteropZodType<Messages>>;
}, "strip", z.ZodTypeAny, {
  messages: BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[];
}, {
  messages: BaseMessage<_selfimpulse_core_messages0.MessageStructure<_selfimpulse_core_messages0.MessageToolSet>, _selfimpulse_core_messages0.MessageType>[];
}>;
//#endregion
export { MessagesAnnotation, MessagesZodMeta, MessagesZodState };
