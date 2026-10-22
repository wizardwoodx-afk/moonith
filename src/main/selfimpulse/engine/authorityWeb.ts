/**
 * AUTHORITY WEB — the portable, runtime-agnostic trust root (19.5.1).
 *
 * ECDSA P-256 via WebCrypto: the human owner's keypair signs mandates;
 * ANYONE verifies with the exported public key. This is the LIVE runtime
 * authority path — it runs identically in the browser front door and in
 * node. The node-side HMAC signer in authority.ts remains as a local
 * legacy-compatibility path only.
 *
 * Signatures use the raw P1363 (r‖s) form WebCrypto produces; the scheme
 * prefix "ecdsa-p256:" marks portable authority wherever it travels.
 */
import { mandateCanonical, bytesToB64, b64ToBytes } from "./authorityCore";
import type { Mandate, MandateCheck } from "./authorityCore";

export type { Mandate, MandateCheck };
export { mandateCanonical };

export interface OwnerKeyPairWeb {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyPem: string;   // SPKI — the portable verifier
}

const EC = { name: "ECDSA", namedCurve: "P-256" } as const;

export async function generateOwnerKeysWeb(): Promise<OwnerKeyPairWeb> {
  const pair = await crypto.subtle.generateKey(EC, true, ["sign", "verify"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyPem: pem("PUBLIC KEY", spki) };
}

function pem(label: string, der: ArrayBuffer): string {
  const b64 = bytesToB64(new Uint8Array(der));
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export async function importPublicKeyWeb(publicKeyPem: string): Promise<CryptoKey> {
  const b64 = publicKeyPem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  return crypto.subtle.importKey("spki", b64ToBytes(b64).buffer as ArrayBuffer, EC, false, ["verify"]);
}

export async function signMandateWeb(m: Omit<Mandate, "signature">, keys: OwnerKeyPairWeb): Promise<Mandate> {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, (new TextEncoder().encode(mandateCanonical(m))).buffer as ArrayBuffer);
  return { ...m, signature: `ecdsa-p256:${bytesToB64(new Uint8Array(sig))}` };
}

export async function verifyMandateWeb(m: Mandate, publicKeyPem: string, now = Date.now()): Promise<MandateCheck> {
  if (!m) return { ok: false, reason: "missing", detail: "no mandate passport — the agent does not act" };
  if (!m.owner) return { ok: false, reason: "no-owner", detail: "a mandate without a named human owner is not authority" };
  if (now > m.expiresAt) return { ok: false, reason: "expired", detail: "mandate expired — re-issue it" };
  if (!m.signature?.startsWith("ecdsa-p256:")) {
    return { ok: false, reason: "bad-signature", detail: "not an asymmetric signature — refusing to treat symmetric HMAC as portable authority" };
  }
  try {
    const pub = await importPublicKeyWeb(publicKeyPem);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64ToBytes(m.signature.slice("ecdsa-p256:".length)), (new TextEncoder().encode(mandateCanonical(m))).buffer as ArrayBuffer);
    if (!ok) return { ok: false, reason: "bad-signature", detail: "asymmetric signature does not verify — treating as forged" };
    return { ok: true, mandate: m };
  } catch {
    return { ok: false, reason: "bad-signature", detail: "public key or signature malformed — treating as forged" };
  }
}

// ── authority  receipt binding (portable) ──────────────────────────────────
export interface AuthorityBinding {
  receiptDigest: string;
  /** Review fix — the binding itself commits to the EXACT mandate. */
  mandateDigest: string | null; // null only for legacy hop-bindings
  hopDigest: string | null;     // null = root mandate action
  mandateOwner: string;
  digest: string;
}

export const sha256HexWeb = async (t: string) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export async function bindAuthorityToReceiptWeb(receiptDigest: string, hopDigest: string | null, mandateOwner: string, mandateDigest: string | null = null): Promise<AuthorityBinding> {
  /* legacy hop-bindings carry no mandateDigest — their material stays the
     pre-commit shape; new bindings commit to the exact mandate. */
  const base = mandateDigest == null
    ? { receiptDigest, hopDigest, mandateOwner }
    : { receiptDigest, mandateDigest, hopDigest, mandateOwner };
  return { receiptDigest, mandateDigest, hopDigest, mandateOwner, digest: await sha256HexWeb(JSON.stringify(base)) };
}

export async function verifyAuthorityBindingWeb(binding: AuthorityBinding, receiptDigest: string, hopDigest: string | null, expectedMandateDigest: string | null = null): Promise<boolean> {
  /* Recompute the binding material EXACTLY as minted — legacy bindings
     (pre-mandate-commit) carried no mandateDigest and keep their material;
     new bindings commit to the exact mandate inside the digest itself. */
  const legacy = binding.mandateDigest == null;
  const base = legacy
    ? { receiptDigest, hopDigest, mandateOwner: binding.mandateOwner }
    : { receiptDigest, mandateDigest: binding.mandateDigest, hopDigest, mandateOwner: binding.mandateOwner };
  const want = await sha256HexWeb(JSON.stringify(base));
  if (want !== binding.digest || binding.receiptDigest !== receiptDigest) return false;
  if (expectedMandateDigest !== null && !legacy && binding.mandateDigest !== expectedMandateDigest) return false;
  return true;
}
