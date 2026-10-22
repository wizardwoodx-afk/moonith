/**
 * AUTHORITY CORE — runtime-agnostic primitives (browser + node).
 *
 * The canonical mandate shape and serialization live here so BOTH the
 * WebCrypto portable signer (authorityWeb.ts — the live runtime path) and
 * the node-side legacy HMAC verifier (authority.ts) speak ONE canonical
 * language. No node imports, no browser imports.
 */
export interface Mandate {
  agentId: string;
  owner: string;            // the human who signs — accountability anchor
  scope: string[];          // permitted tool/action classes
  budgetCap: number;        // authority units granted
  maxDepth: number;         // delegation depth permitted
  issuedAt: number;
  expiresAt: number;
  signature?: string;       // scheme-prefixed signature over the canonical mandate
}

export type MandateCheck =
  | { ok: true; mandate: Mandate }
  | { ok: false; reason: "missing" | "expired" | "bad-signature" | "no-owner"; detail: string };

export const mandateCanonical = (m: Omit<Mandate, "signature">) =>
  JSON.stringify({
    v: "vh.mandate.v1", agentId: m.agentId, owner: m.owner, scope: [...m.scope].sort(),
    budgetCap: m.budgetCap, maxDepth: m.maxDepth, issuedAt: m.issuedAt, expiresAt: m.expiresAt,
  });

/** base64 over bytes without Buffer — works in every runtime. */
export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64");
}
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(new ArrayBuffer(s.length)) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
