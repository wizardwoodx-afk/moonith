/**
 * A no-op stand-in for js-tiktoken.
 *
 * WHY THIS EXISTS
 * ---------------
 * The upstream loader fetches an encoding table from the network
 * (tiktoken.pages.dev) the first time an encoding is asked for. A desktop app
 * that runs on-device, under an egress guard, with a receipt for every
 * network action, cannot quietly fetch a token table. And it does not need to:
 * SelfImpulse counts tokens on its own, in src/engine/tokenOptim.ts.
 *
 * So this module refuses in words rather than reaching out.
 */
export class Tiktoken {
  constructor() {
    throw new Error("token counting by tiktoken is not available in SelfImpulse — the engine counts tokens itself (src/engine/tokenOptim.ts).");
  }
}

/** No model maps to a tiktoken encoding here; the engine does its own counting. */
export function getEncodingNameForModel() { return null; }

export default { Tiktoken, getEncodingNameForModel };
