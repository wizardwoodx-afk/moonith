/**
 * PATCHED BY SELFIMPULSE — the upstream file reached out to the network.
 *
 * The upstream loader fetched an encoding table the first time an encoding was
 * asked for:
 *
 *     caller.fetch(`https://tiktoken.pages.dev/js/${encoding}.json`)
 *
 * A desktop product that runs on-device, under an egress guard, with a
 * receipt for every network action, cannot quietly fetch a token table — and
 * it does not need to: SelfImpulse counts tokens on its own, in
 * src/engine/tokenOptim.ts.
 *
 * So the network call is gone and the module refuses in words. The export
 * names are unchanged, so the two upstream importers
 * (core/language_models/base.js and core/load/import_map.js) are untouched.
 *
 * @see vendor/graphruntime/PROVENANCE.json — "patched"
 */
import { Tiktoken, getEncodingNameForModel } from "../../stubs/tiktoken.js";

export { Tiktoken, getEncodingNameForModel };

export const tiktoken_exports = {
	encodingForModel: () => encodingForModel,
	getEncoding: () => getEncoding,
};

export async function getEncoding(encoding) {
	throw new Error(
		`token counting by tiktoken is not available in SelfImpulse — the engine counts tokens itself (src/engine/tokenOptim.ts). Asked for encoding "${encoding}".`,
	);
}

export async function encodingForModel(model) {
	throw new Error(
		`token counting by tiktoken is not available in SelfImpulse — the engine counts tokens itself (src/engine/tokenOptim.ts). Asked for model "${model}".`,
	);
}
