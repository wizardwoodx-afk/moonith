import { CONFIG_KEY_RESUMING, Command } from "../constants.js";
import { isGraphBubbleUp, isParentCommand } from "../errors.js";
import { getParentCheckpointNamespace } from "./utils/config.js";
import { patchConfigurable } from "./utils/index.js";
import { runAttemptWithTimeout } from "./timeout.js";
const DEFAULT_STATUS_NO_RETRY = [
	400,
	401,
	402,
	403,
	404,
	405,
	406,
	407,
	409
];
const DEFAULT_RETRY_ON_HANDLER = (error) => {
	if (error.message.startsWith("Cancel") || error.message.startsWith("AbortError") || error.name === "AbortError") return false;
	if (error.name === "GraphValueError") return false;
	if (error?.code === "ECONNABORTED") return false;
	const status = error?.response?.status ?? error?.status;
	if (status && DEFAULT_STATUS_NO_RETRY.includes(+status)) return false;
	if (error?.error?.code === "insufficient_quota") return false;
	return true;
};
async function _runWithRetry(executorTask, retryPolicy, configurable, signal) {
	const resolvedRetryPolicy = executorTask.retry_policy ?? retryPolicy;
	let attempts = 0;
	let error;
	let result;
	let config = executorTask.config ?? {};
	if (configurable) config = patchConfigurable(config, configurable);
	config = {
		...config,
		signal
	};
	const firstAttemptTime = Date.now();
	if (config.executionInfo != null) config.executionInfo = {
		...config.executionInfo,
		nodeFirstAttemptTime: firstAttemptTime
	};
	while (true) {
		if (signal?.aborted) break;
		executorTask.writes.splice(0, executorTask.writes.length);
		error = void 0;
		try {
			if (executorTask.timeout !== void 0) result = await runAttemptWithTimeout(executorTask, config, executorTask.timeout, (scopedConfig) => executorTask.proc.invoke(executorTask.input, scopedConfig));
			else result = await executorTask.proc.invoke(executorTask.input, config);
			break;
		} catch (e) {
			error = e;
			error.executorTaskId = executorTask.id;
			if (isParentCommand(error)) {
				const ns = config?.configurable?.checkpoint_ns;
				const cmd = error.command;
				if (cmd.graph === ns) {
					for (const writer of executorTask.writers) await writer.invoke(cmd, config);
					error = void 0;
					break;
				} else if (cmd.graph === Command.PARENT) {
					const parentNs = getParentCheckpointNamespace(ns);
					error.command = new Command({
						...error.command,
						graph: parentNs
					});
				}
			}
			if (isGraphBubbleUp(error)) break;
			if (resolvedRetryPolicy === void 0) break;
			attempts += 1;
			if (attempts >= (resolvedRetryPolicy.maxAttempts ?? 3)) break;
			if (!(resolvedRetryPolicy.retryOn ?? DEFAULT_RETRY_ON_HANDLER)(error)) break;
			const initialInterval = resolvedRetryPolicy.initialInterval ?? 500;
			const interval = Math.min(resolvedRetryPolicy.maxInterval ?? 128e3, initialInterval * (resolvedRetryPolicy.backoffFactor ?? 2) ** (attempts - 1));
			const sleepMs = resolvedRetryPolicy.jitter ?? true ? interval + Math.random() * 1e3 : interval;
			await new Promise((resolve) => setTimeout(resolve, sleepMs));
			const errorName = error.name ?? error.constructor.unminifiable_name ?? error.constructor.name;
			if (resolvedRetryPolicy?.logWarning ?? true) console.log(`Retrying task "${String(executorTask.name)}" after ${sleepMs.toFixed(2)}ms (attempt ${attempts}) after ${errorName}: ${error}`);
			config = patchConfigurable(config, { [CONFIG_KEY_RESUMING]: true });
			if (config.executionInfo != null) config.executionInfo = {
				...config.executionInfo,
				nodeAttempt: attempts + 1,
				nodeFirstAttemptTime: firstAttemptTime
			};
		}
	}
	return {
		task: executorTask,
		result,
		error,
		signalAborted: signal?.aborted
	};
}
//#endregion
export { _runWithRetry };
