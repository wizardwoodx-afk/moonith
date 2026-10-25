import { SelfRoiRunnableConfig } from "../runnable_types.js";
import { BaseStore } from "../../../checkpoint/index.d.ts";
import { RunnableConfig } from "../../../core/runnables/index.d.ts";

//#region src/executor/utils/config.d.ts
/**
 * A helper utility function that returns the {@link BaseStore} that was set when the graph was initialized
 *
 * @returns a reference to the {@link BaseStore} that was set when the graph was initialized
 */
declare function getStore(config?: SelfRoiRunnableConfig): BaseStore | undefined;
/**
 * A helper utility function that returns the {@link SelfRoiRunnableConfig#writer} if "custom" stream mode is enabled, otherwise undefined.
 *
 * @returns a reference to the {@link SelfRoiRunnableConfig#writer} if "custom" stream mode is enabled, otherwise undefined
 */
declare function getWriter(config?: SelfRoiRunnableConfig): ((chunk: unknown) => void) | undefined;
/**
 * A helper utility function that returns the {@link SelfRoiRunnableConfig} that was set when the graph was initialized.
 *
 * Note: This only works when running in an environment that supports node:async_hooks and AsyncLocalStorage. If you're running this in a
 * web environment, access the SelfRoiRunnableConfig from the node function directly.
 *
 * @returns the {@link SelfRoiRunnableConfig} that was set when the graph was initialized
 */
declare function getConfig(): SelfRoiRunnableConfig;
/**
 * A helper utility function that returns the input for the currently executing
 * task.
 *
 * Note: When called without arguments, this relies on `node:async_hooks` /
 * `AsyncLocalStorage`, which is available in many JavaScript environments
 * (Node.js, Deno, Cloudflare Workers) but not in web browsers. In environments
 * without `AsyncLocalStorage` support, pass the `config` that your node/tool
 * function receives directly, e.g. `getCurrentTaskInput(config)`.
 *
 * Tip: Inside a tool run by a `ToolNode`, prefer reading graph state from
 * `runtime.state` on the second tool argument (typed as `ToolRuntime` from
 * `@selfimpulse/core/tools`). It works in every runtime, including web browsers.
 *
 * @param config - Optional {@link SelfRoiRunnableConfig} to read the task
 * input from. Provide this when running in an environment without
 * `AsyncLocalStorage` support (e.g. web browsers).
 * @returns the input for the currently executing task
 */
declare function getCurrentTaskInput<T = unknown>(config?: SelfRoiRunnableConfig): T;
//#endregion
export { getConfig, getCurrentTaskInput, getStore, getWriter };
