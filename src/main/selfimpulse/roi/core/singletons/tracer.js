import { getEnvironmentVariable } from "../utils/env.js";
import { Client } from "../../stubs/selftrace.js";
//#region src/singletons/tracer.ts
let client;
const getDefaultSelfImpulseClientSingleton = () => {
	if (client === void 0) {
		const clientParams = getEnvironmentVariable("SELFIMPULSE_CALLBACKS_BACKGROUND") === "false" ? { blockOnRootRunFinalization: true } : {};
		client = new Client(clientParams);
	}
	return client;
};
//#endregion
export { getDefaultSelfImpulseClientSingleton };
