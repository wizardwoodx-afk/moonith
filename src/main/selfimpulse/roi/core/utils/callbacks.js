import { getEnvironmentVariable } from "./env.js";
//#region src/utils/callbacks.ts
const isTracingEnabled = (tracingEnabled) => {
	if (tracingEnabled !== void 0) return tracingEnabled;
	return !![
		"SELFTRACE_TRACING_V2",
		"SELFIMPULSE_TRACING_V2",
		"SELFTRACE_TRACING",
		"SELFIMPULSE_TRACING"
	].find((envVar) => getEnvironmentVariable(envVar) === "true");
};
//#endregion
export { isTracingEnabled };
