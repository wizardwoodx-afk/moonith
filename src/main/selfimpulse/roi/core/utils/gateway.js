/**
 * PATCHED BY SELFIMPULSE — the upstream file pointed at a hosted gateway.
 *
 * The upstream resolver read SELFTRACE_GATEWAY, SELFTRACE_GATEWAY_API_KEY and
 * SELFTRACE_API_KEY from the environment and produced a base URL on
 * gateway.smith.selfimpulse.com, so a model class in this tree could have been
 * pointed at a hosted service with a key read out of the owner's environment.
 *
 * SelfImpulse has no hosted gateway and no reason to want one: every provider
 * call in this product goes through src/engine/providers.ts, which owns the
 * key, the redaction and the token ledger. A second path to a provider is a
 * second path that is not receipted.
 *
 * So the resolver refuses in words. The export names are unchanged, so
 * core/load/import_map.js is untouched.
 *
 * @see selfimpulse/roi/PROVENANCE.json — "patched"
 */
export const DEFAULT_SELFTRACE_GATEWAY = null;

export const gateway_exports = {
	DEFAULT_SELFTRACE_GATEWAY: () => DEFAULT_SELFTRACE_GATEWAY,
	resolveSelfTraceGatewayConfig: () => resolveSelfTraceGatewayConfig,
};

export function resolveSelfTraceGatewayConfig() {
	throw new Error(
		"the hosted SelfTrace gateway is not available in SelfImpulse — every provider call goes through the engine's own provider seam (src/engine/providers.ts), which owns the key and the receipt.",
	);
}
