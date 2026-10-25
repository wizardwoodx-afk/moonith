import { AsyncLocalStorageProviderSingleton } from "../core/singletons/index.js";
//#region src/writer.ts
function writer(chunk) {
	const config = AsyncLocalStorageProviderSingleton.getRunnableConfig();
	if (!config) throw new Error("Called interrupt() outside the context of a graph.");
	const conf = config.configurable;
	if (!conf) throw new Error("No configurable found in config");
	return conf.writer?.(chunk);
}
//#endregion
export { writer };
