/**
 * §ISSUER SIGNING — Ed25519 issuer identity for SelfImpulse's proof receipts.
 *
 * WHY THIS EXISTS
 * Receipts are tamper-EVIDENT (HMAC seal over a published secret) but not
 * issuer-authentic — anyone who knows the secret could have produced the seal.
 * The 2026 industry direction is unambiguous — Ed25519-signed, hash-chained
 * receipts with offline verification against a published key (IETF ACTA
 * signed-receipts, Nobulex, AgenticRail, Provenrail, agentmark) — so SelfImpulse's
 * issuer is a cryptographic identity: a locally generated Ed25519 keypair
 * signs the receipt chain, and any auditor holding the exported public key
 * can verify SelfImpulse issued it, with zero SelfImpulse state. Same shared standard
 * ships: one verifier covers the current and the legacy wire formats.
 *
 * THE HONESTY RULES
 *  - The private key lives ONLY on the user's machine: in webview localStorage on
 *    the desktop and browser editions (stated in the seam note below), in-memory
 *    otherwise. It is never sent anywhere; this product has no server to send it to.
 *  - When the runtime has no Ed25519 (an older webview), the receipt is NOT faked:
 *    `signature` stays null and `signatureNote` says exactly what happened. The HMAC
 *    seal still applies, so the receipt stays tamper-evident — and says so.
 *  - Verification is the same algorithm everywhere: re-check the chain, re-check the
 *    seal, and — when a signature and public key are present — verify Ed25519 over the
 *    final chain hash.
 *
 * Node-import-safe: storage is guarded; crypto.subtle exists on Node ≥ 15 (global) and in
 * every modern webview, and Ed25519 in WebCrypto on Node ≥ 18 and current browsers.
 */

export interface IssuerIdentity {
  /** Stable id for this issuer key: "selfimpulse-issuer-" + first 12 hex chars of the public key. */
  keyId: string;
  /** Hex-encoded 32-byte Ed25519 public key. This is what auditors receive. */
  publicKeyHex: string;
  createdAt: string;
}

export interface IssuerSignature {
  alg: "EdDSA";
  keyId: string;
  publicKeyHex: string;
  /** Hex-encoded 64-byte Ed25519 signature over the final receipt chain hash. */
  sigHex: string;
}

const STORAGE_KEY = "selfimpulse.issuerkey.v1";

/**
 * THE NATIVE SEAM — deleted, and the reason is recorded here.
 *
 * `keychainBridge()` sealed the issuer key through a generic host command
 * channel that only the old Tauri shell published. `electron/preload.cjs`
 * exposes named methods and no generic `invoke`, so the gate read false in the
 * packaged Electron app exactly as it did in the browser: both hosts ran the
 * localStorage path below, which is also the deterministic path every probe
 * exercises. Removing the gate therefore removes nothing that ran. Sealing this
 * key in the Electron credential store (`ipc.secretSet`, which does reach the OS
 * store there) is a separate, stated piece of work — not something to slip in
 * under a dependency removal.
 */
/** The credential-store ref issuer signing would seal this key under. */
export const KEYCHAIN_REF = STORAGE_KEY;

let cached: { identity: IssuerIdentity; privateKey: CryptoKey } | null = null;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function ed25519Available(): boolean {
  try {
    return typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof crypto.subtle.generateKey === "function";
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * WHERE THE ISSUER KEY RESTS.
 *
 * Two places, in this order, and NEVER page storage in plaintext:
 *
 *   1. the encrypted VAULT (AES-256-GCM under the owner's passphrase) — the
 *      same store every provider key uses, with the same rule: "no credential
 *      ever reaches plaintext localStorage";
 *   2. the OS CREDENTIAL STORE on a desktop host, under KEYCHAIN_REF — which
 *      is what that constant was named for in the first place.
 *
 * If neither is available the key lives in module memory for the session. The
 * session still signs; the identity simply does not survive a quit, and the
 * UI says so rather than pretending.
 * ------------------------------------------------------------------------- */

interface SealedIssuer {
  publicKeyHex?: string;
  privateJwk?: JsonWebKey;
  createdAt?: string;
}

/** Where the SEALED issuer record lives.
 *
 * It must NOT be the legacy plaintext key. The legacy record was the same
 * string, and the purge of that legacy record ran AFTER the seal — so the
 * purge deleted the key it had just sealed, and the issuer identity silently
 * changed on every session. Two different records, two different names. */
const SEALED_ISSUER_REF = "selfimpulse.issuerkey.sealed.v1";

/** Seal the issuer record into the vault. False when the vault is locked. */
async function sealIssuer(persisted: string): Promise<boolean> {
  try {
    const { vaultSeal } = await import("../../engine/vault");
    const sealed = await vaultSeal(SEALED_ISSUER_REF, persisted);
    return sealed.ok === true;
  } catch {
    /* The vault could not be reached or refused the write. The key then
       lives in module memory for this session only — it is never written
       down anywhere weaker. */
    return false;
  }
}

/** Read the issuer record back out of the vault. Null when absent or locked. */
async function loadSealedIssuer(): Promise<SealedIssuer | null> {
  try {
    const { vaultDecrypt } = await import("../../engine/vault");
    const opened = await vaultDecrypt(SEALED_ISSUER_REF);
    if (!opened.found || opened.locked) return null;
    const parsed = JSON.parse(opened.text) as SealedIssuer;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    /* No sealed record, or one that cannot be read. A missing record means
       a new issuer identity, which is the honest outcome — never a guess at
       what the old one was. */
    return null;
  }
}

/** Purge the legacy PLAINTEXT issuer record.
 *
 * An earlier build wrote the Ed25519 private key into page storage in the
 * clear. Leaving that record on disk would keep the very leak this module
 * exists to remove alive, so it is deleted the moment this module runs. */
function purgeLegacyPlaintextIssuer(): void {
  try {
    globalThis.localStorage?.removeItem(KEYCHAIN_REF);
  } catch {
    /* No page storage here — nothing to purge. */
  }
}

/**
 * The SelfImpulse issuer identity, generated once per machine. Persistence is best-effort: in a
 * browser/desktop with storage the same key survives restarts; under the probe runner it
 * is in-memory for the session, which is all a deterministic test needs.
 */
export async function ensureIssuerIdentity(): Promise<{ identity: IssuerIdentity; privateKey: CryptoKey } | null> {
  if (cached) return cached;
  if (!ed25519Available()) return null;

  /* Try to rehydrate a previously generated key so the issuer identity is stable.
     The key is NOT in page storage: it is sealed in the encrypted vault
     (AES-256-GCM under the owner's passphrase) or held by the OS credential
     store on a desktop host. What this comment used to add — "used as a
     mirrored fallback on native, too" — described the leak the write below no
     longer performs. */
  try {
    const stored = await loadSealedIssuer();
    if (stored?.publicKeyHex && stored?.privateJwk) {
      const privateKey = await crypto.subtle.importKey("jwk", stored.privateJwk, { name: "Ed25519" }, true, ["sign"]);
      const identity: IssuerIdentity = {
        keyId: `selfimpulse-issuer-${stored.publicKeyHex.slice(0, 12)}`,
        publicKeyHex: stored.publicKeyHex,
        createdAt: stored.createdAt ?? new Date(0).toISOString(),
      };
      cached = { identity, privateKey };
      return cached;
    }
  } catch {
    /* fall through to generation */
  }

  try {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const publicKeyHex = toHex(rawPub);
    const identity: IssuerIdentity = {
      keyId: `selfimpulse-issuer-${publicKeyHex.slice(0, 12)}`,
      publicKeyHex,
      createdAt: new Date().toISOString(),
    };
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const persisted = JSON.stringify({ publicKeyHex, privateJwk, createdAt: identity.createdAt });
    /* One destination — never both, and never page storage in plaintext.
     *
     * The keychain write used to be followed by an unconditional mirror into
     * localStorage, which parked an Ed25519 PRIVATE key in plaintext where any
     * script in the webview can pick it up with one string lookup — the exact
     * downgrade `src/auth/credentialStore.ts` forbids ("NO CREDENTIAL EVER REACHES
     * PLAINTEXT localStorage ... never a quiet downgrade to a plaintext write").
     * Receipts are issuer-authentic because of this key, so a leaked key makes
     * every receipt forgeable rather than just this one.
     *
     * So the key goes to the VAULT — sealed with AES-256-GCM under the owner's
     * passphrase — and, on a desktop host, to the OS credential store under
     * KEYCHAIN_REF. If neither is available the key stays in module memory for
     * this session only: the session still signs, the identity simply does not
     * survive quit. A refused write is not answered with a retry somewhere
     * weaker.
     *
     * Any legacy plaintext record from an earlier build is purged on sight —
     * leaving it on disk would keep the very leak this removes alive. The
     * purge runs BEFORE the seal, and against a DIFFERENT key: the sealed
     * record and the legacy record are two records, and a purge that shares a
     * name with the seal deletes the key it just wrote. */
    purgeLegacyPlaintextIssuer();
    await sealIssuer(persisted);
    cached = { identity, privateKey: pair.privateKey };
    return cached;
  } catch {
    // WebCrypto exists but Ed25519 is refused (older webview). Honest null, never a fake.
    return null;
  }
}

/**
 * Sign an arbitrary hex digest (32 bytes of hex) with the issuer key. This is the
 * primitive; signChainHash below is the receipt-specific name for the same operation.
 */
export async function signHexDigest(hexDigest: string): Promise<IssuerSignature | null> {
  const holder = await ensureIssuerIdentity();
  if (!holder) return null;
  try {
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, holder.privateKey, fromHex(hexDigest)));
    return { alg: "EdDSA", keyId: holder.identity.keyId, publicKeyHex: holder.identity.publicKeyHex, sigHex: toHex(sig) };
  } catch {
    return null;
  }
}

/** Sign the final chain hash of a receipt. Null when the runtime cannot sign. */
export async function signChainHash(chainHashHex: string): Promise<IssuerSignature | null> {
  return signHexDigest(chainHashHex);
}

/**
 * Verify an issuer signature with ONLY the message, the signature and the public key —
 * the exact auditor path, no product state involved. Returns false on any mismatch; throws on
 * malformed input only when the runtime cannot even attempt Ed25519 (also reported as
 * false by callers that wrap this).
 */
export async function verifyIssuerSignature(chainHashHex: string, sigHex: string, publicKeyHex: string): Promise<boolean> {
  if (!ed25519Available()) return false;
  try {
    const publicKey = await crypto.subtle.importKey("raw", fromHex(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, fromHex(sigHex), fromHex(chainHashHex));
  } catch {
    return false;
  }
}

/**
 * The public document an auditor receives: who the issuer is, the public key, and how to
 * verify. Plain text on purpose — it must survive email, tickets and print.
 */
export async function exportIssuerPublicKeyDocument(version: string): Promise<string | null> {
  const holder = await ensureIssuerIdentity();
  if (!holder) return null;
  return [
    "SelfImpulse — Issuer Public Key (Ed25519)",
    "================================",
    "",
    `Version    : ${version}`,
    `Key id     : ${holder.identity.keyId}`,
    `Public key : ${holder.identity.publicKeyHex}`,
    `Created    : ${holder.identity.createdAt}`,
    "",
    "What this key verifies",
    "----------------------",
    "Every receipt issued by this SelfImpulse install (current si-proof-receipt/2, legacy",
    "mj-proof-receipt/1|2) carries `issuer` + `signature`:",
    "an Ed25519 signature over the receipt's FINAL CHAIN HASH (the `hash` of the last",
    "chained event). To verify a receipt without this product:",
    "",
    "  1. Re-canonicalize each event body (recursive key sort) and re-hash the chain",
    "     from the 64-zero genesis to recover the final chain hash.",
    "  2. Verify the Ed25519 signature over that hash with the public key above.",
    "  3. Re-check the HMAC seal as before (it still applies).",
    "",
    "The private key never leaves the machine that issued the receipts; there is no server",
    "it could leave through. Treat this document like a code-signing certificate: anyone",
    "holding it can verify the receipts; nobody holding it can forge them.",
    "",
  ].join("\n");
}

/** For tests and the compliance center: is issuer signing available in THIS runtime? */
export function signingSupported(): boolean {
  return ed25519Available();
}
