import { TimeoutPolicy } from "./utils/timeout.js";
import { CachePolicy, RetryPolicy } from "./utils/index.js";
import { Runnable, RunnableBinding, RunnableBindingArgs, RunnableConfig, RunnableLike } from "../../core/runnables/index.d.ts";

//#region src/executor/read.d.ts
interface RoiExecutorNodeArgs<RunInput, RunOutput> extends Partial<RunnableBindingArgs<RunInput, RunOutput>> {
  channels: Record<string, string> | string[];
  triggers: Array<string>;
  mapper?: (args: any) => any;
  writers?: Runnable<RunOutput, unknown>[];
  tags?: string[];
  bound?: Runnable<RunInput, RunOutput>;
  kwargs?: Record<string, any>;
  config?: RunnableConfig;
  metadata?: Record<string, unknown>;
  retryPolicy?: RetryPolicy;
  cachePolicy?: CachePolicy;
  timeout?: TimeoutPolicy;
  subgraphs?: Runnable[];
  ends?: string[];
  /** Whether this node is an auto-generated node-level error handler. */
  isErrorHandler?: boolean;
  /** Name of the error handler node to run if this node's execution fails. */
  errorHandlerNode?: string;
}
type RoiExecutorNodeInputType = any;
type RoiExecutorNodeOutputType = any;
declare class RoiExecutorNode<RunInput = RoiExecutorNodeInputType, RunOutput = RoiExecutorNodeOutputType> extends RunnableBinding<RunInput, RunOutput, RunnableConfig> {
  lc_graph_name: string;
  channels: Record<string, string> | string[];
  triggers: string[];
  mapper?: (args: any) => any;
  writers: Runnable[];
  bound: Runnable<RunInput, RunOutput>;
  kwargs: Record<string, any>;
  metadata: Record<string, unknown>;
  tags: string[];
  retryPolicy?: RetryPolicy;
  cachePolicy?: CachePolicy;
  timeout?: TimeoutPolicy;
  subgraphs?: Runnable[];
  ends?: string[];
  isErrorHandler?: boolean;
  errorHandlerNode?: string;
  constructor(fields: RoiExecutorNodeArgs<RunInput, RunOutput>);
  getWriters(): Array<Runnable>;
  getNode(): Runnable<RunInput, RunOutput> | undefined;
  join(channels: Array<string>): RoiExecutorNode<RunInput, RunOutput>;
  pipe<NewRunOutput>(coerceable: RunnableLike): RoiExecutorNode<RunInput, Exclude<NewRunOutput, Error>>;
}
//#endregion
export { RoiExecutorNode };
