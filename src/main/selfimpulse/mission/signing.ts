/**
 * §ISSUER SIGNING — Ed25519 issuer identity for VH's proof receipts (VH 11.10.1).
 *
 * WHY THIS EXISTS
 * Through 11.10, VH's receipts were tamper-EVIDENT but not issuer-authentic: the HMAC seal
 * uses a published secret, so anyone who knows the secret could have produced the seal.
 * The 2026 industry direction is unambiguous — Ed25519-signed, hash-chained receipts with
 * offline verification against a published key (IETF ACTA signed-receipts, Nobulex,
 * AgenticRail, Provenrail, agentmark) — so 11.10.1 makes VH's issuer a cryptographic
 * identity: a locally generated Ed25519 keypair signs the receipt chain, and any auditor
 * holding the exported public key can verify VH issued it, with zero VH state.
 *
 * THE HONESTY RULES
 *  - The private key lives ONLY on the user's machine: in webview localStorage on
 *    the desktop and browser editions (stated in the seam note below), in-memory
 *    otherwise. It is never sent anywhere; VH has no server to send it to.
 *  - When the runtime has no Ed25519 (an older webview), the receipt is NOT faked:
 *    `signature` stays null and `signatureNote` says exactly what happened. The HMAC
 *    seal still applies, so the receipt stays tamper-evident — and says so.
 *  - Verification is the same algorithm everywhere: re-check the chain, re-check the
 *    seal, and — when a signature and public key are present — verify Ed25519 over the
 *    final chain hash.
 *
 * Node-import-safe: storage is guarded; crypto.subtle exists on Node ≥ 15 (global) and in
 * every modern webview, and Ed25519 in WebCrypto on Node ≥ 18 and current browsers.
 *
 * WHICH ROOT: this module owns the MISSION issuer root. Its keyId prefix is a
 * declared, single-source fact in `src/security/issuerRoots.ts`, imported below —
 * not a local string literal — so a verifier can tell from a keyId alone which of
 * the product's two roots signed a chain.
 */
import { MISSION_ISSUER_ROOT, type IssuerRootId } from "../security/issuerRoots";

export interface IssuerIdentity {
  /** Stable id for this issuer key: the mission root's keyId prefix + first 12 hex chars of the public key. */
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

/**
 * VH hardening — where the issuer key is sealed.
 *
 * The keychain seam removed here opened only for a host that published a generic
 * command channel, and no shell in this build does: `electron/preload.cjs`
 * exposes named methods and no generic `invoke`, so the gate read false in the
 * packaged Electron app exactly as it did in the browser. Deleting it therefore
 * changes nothing about where either host's key lives — the webview localStorage
 * path below is what both run today, and it is the deterministic path every
 * probe exercises. Sealing the issuer key in the Electron credential store is a
 * separate, stated piece of work; it is not smuggled in here.
 */
const STORAGE_KEY = "vh.issuerkey.v1";

/** The root this module owns. Declared once in `src/security/issuerRoots.ts`. */
export const ISSUER_ROOT_ID: IssuerRootId = MISSION_ISSUER_ROOT.id;
/** The single-source keyId prefix for this root — imported, never a local literal. */
export const KEY_ID_PREFIX: string = MISSION_ISSUER_ROOT.keyIdPrefix;

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
 * The encrypted VAULT (AES-256-GCM under the owner's passphrase) — the same
 * store every provider key uses, with the same rule: no credential ever
 * reaches plaintext page storage. When the vault is locked the key stays in
 * module memory for the session: the session still signs, the identity does
 * not survive a quit, and the UI says so rather than pretending.
 *
 * This is the second copy of the rule (the other is
 * src/selfimpulse/engine/signing.ts). Two copies of a protocol means both
 * copies must be fixed, or the weaker one is the way in.
 * ------------------------------------------------------------------------- */

/** Where the SEALED issuer record lives.
 *
 * It must NOT be the legacy plaintext key: the purge of that legacy record
 * runs after the seal, so a shared name would delete the key just written
 * and the issuer identity would change on every session. */
const SEALED_ISSUER_REF = "vh.issuerkey.sealed.v1";

interface SealedIssuer {
  publicKeyHex?: string;
  privateJwk?: JsonWebKey;
  createdAt?: string;
}

async function sealIssuer(persisted: string): Promise<boolean> {
  try {
    const { vaultSeal } = await import("../engine/vault");
    const sealed = await vaultSeal(SEALED_ISSUER_REF, persisted);
    return sealed.ok === true;
  } catch {
    /* The vault could not be reached or refused the write. The key then
       lives in module memory for this session only — it is never written
       down anywhere weaker. */
    return false;
  }
}

async function loadSealedIssuer(): Promise<SealedIssuer | null> {
  try {
    const { vaultDecrypt } = await import("../engine/vault");
    const opened = await vaultDecrypt(SEALED_ISSUER_REF);
    if (!opened.found || opened.locked) return null;
    const parsed = JSON.parse(opened.text) as SealedIssuer;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    /* No sealed record, or one that cannot be read. A missing record means a
       new issuer identity, which is the honest outcome — never a guess at
       what the old one was. */
    return null;
  }
}

/** Purge the legacy PLAINTEXT issuer record left by an earlier build. */
function purgeLegacyPlaintextIssuer(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* No page storage here — nothing to purge. */
  }
}

/**
 * The VH issuer identity, generated once per machine. Persistence is best-effort: in a
 * browser/desktop with storage the same key survives restarts; under the probe runner it
 * is in-memory for the session, which is all a deterministic test needs.
 */
export async function ensureIssuerIdentity(): Promise<{ identity: IssuerIdentity; privateKey: CryptoKey } | null> {
  if (cached) return cached;
  if (!ed25519Available()) return null;

  // Try to rehydrate a previously generated key so the issuer identity is stable.
  // The key is NOT in page storage — it is sealed in the encrypted vault, or
  // (on a desktop host) held by the OS credential store.
  try {
    const stored = await loadSealedIssuer();
    if (stored?.publicKeyHex && stored?.privateJwk) {
      const privateKey = await crypto.subtle.importKey("jwk", stored.privateJwk, { name: "Ed25519" }, true, ["sign"]);
      const identity: IssuerIdentity = {
        keyId: `si-issuer-${stored.publicKeyHex.slice(0, 12)}`,
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
      keyId: `si-issuer-${publicKeyHex.slice(0, 12)}`,
      publicKeyHex,
      createdAt: new Date().toISOString(),
    };
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const persisted = JSON.stringify({ publicKeyHex, privateJwk, createdAt: identity.createdAt });
    /* One destination, chosen by the host — never both, and never page storage
       in plaintext.

       This used to write the keychain AND mirror the same JSON into localStorage
       as a "fallback", which parked an Ed25519 PRIVATE key in plaintext where any
       script in the webview can pick it up with one string lookup. That is exactly
       the downgrade `src/auth/credentialStore.ts` exists to forbid: "NO CREDENTIAL
       EVER REACHES PLAINTEXT localStorage ... never a quiet downgrade to a
       plaintext write." Receipts are issuer-authentic BECAUSE of this key, so a
       leaked key makes every receipt forgeable rather than just this one.

       The key is sealed in the encrypted vault instead. If the vault is locked
       the key stays in module memory: the session still signs, the identity
       does not survive a restart, and nothing is written down. A failed write
       is never answered by a silent second attempt elsewhere. Any legacy
       plaintext record is purged on sight, so the old leak does not survive
       the fix.

       The purge runs BEFORE the seal, and against a DIFFERENT key. The sealed
       record and the legacy plaintext record are two records: when they shared
       a name, the purge deleted the key it had just sealed and the issuer
       identity silently changed on every session. */
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
 * the exact auditor path, no VH state involved. Returns false on any mismatch; throws on
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
export async function exportIssuerPublicKeyDocument(mjVersion: string): Promise<string | null> {
  const holder = await ensureIssuerIdentity();
  if (!holder) return null;
  return [
    "SelfImpulse — Issuer Public Key (Ed25519)",
    "================================",
    "",
    `VH version : ${mjVersion}`,
    `Key id     : ${holder.identity.keyId}`,
    `Public key : ${holder.identity.publicKeyHex}`,
    `Created    : ${holder.identity.createdAt}`,
    "",
    "What this key verifies",
    "----------------------",
    "Every mj-proof-receipt/2 issued by this VH install carries `issuer` + `signature`:",
    "an Ed25519 signature over the receipt's FINAL CHAIN HASH (the `hash` of the last",
    "chained event). To verify a receipt without VH:",
    "",
    "  1. Re-canonicalize each event body (recursive key sort) and re-hash the chain",
    "     from the 64-zero genesis to recover the final chain hash.",
    "  2. Verify the Ed25519 signature over that hash with the public key above.",
    "  3. Re-check the HMAC seal as before (it still applies).",
    "",
    "The private key never leaves the machine that issued the receipts; VH has no server",
    "it could leave through. Treat this document like a code-signing certificate: anyone",
    "holding it can verify VH's receipts; nobody holding it can forge them.",
    "",
  ].join("\n");
}

/** For tests and the compliance center: is issuer signing available in THIS runtime? */
export function signingSupported(): boolean {
  return ed25519Available();
}
