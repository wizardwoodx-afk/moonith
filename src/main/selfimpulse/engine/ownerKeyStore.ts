/**
 * OWNER KEYSTORE — 19.5.1 "Reach" (review hardening #3)
 *
 * A private authority key must never sit in plaintext at rest. This module
 * provides the hardened storage seams, in order of preference:
 *
 *   1. ENCRYPTED BROWSER — AES-256-GCM envelope over the JWK, with a PBKDF2
 *      key derived from the owner's passphrase (150k iterations, random salt
 *      + IV stored alongside the ciphertext). Nothing plaintext touches
 *      localStorage.
 *   2. SESSION — no durable private key at all. The owner is still named and
 *      signs for the session; the identity is HONESTLY flagged `session`.
 *
 * The plain `OwnerStorage` seam (get/set strings) stays injectable for
 * probes; production code never calls it with raw private key material.
 */
import type { OwnerStorage } from "./missionAuthority";

export type KeySecurity = "native" | "encrypted" | "session";

export const keySecurityOf = (s: OwnerStorage | null): KeySecurity =>
  s === null ? "session" : ((s as { security?: KeySecurity }).security ?? "encrypted");

/* ── 1 · encrypted browser storage (passphrase envelope) ─────────────────── */
/* V-hardening: PBKDF2-SHA-256 iteration count aligned with the vault's
 * OWASP-2023 baseline (310k). Records written before this fix used 150k;
 * decrypt tries the current count first and falls back to the legacy count
 * so existing sealed records still open. A successful read is transparently
 * re-sealed at the new count on the next write. */
const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_ITERATIONS_LEGACY = 150_000;

function bytesToB64Local(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64");
}
function b64ToBytesLocal(b64: string): Uint8Array {
  const s = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    iterations === PBKDF2_ITERATIONS ? ["encrypt", "decrypt"] : ["decrypt"],
  );
}

/**
 * Wrap any string store in an AES-GCM envelope keyed by the owner passphrase.
 * Decryption happens eagerly at construction; `set` re-encrypts with fresh
 * salt + IV every time. A wrong passphrase yields an EMPTY store (the caller
 * re-mints or stays session-scoped — never plaintext, never a crash).
 */
export interface SealedOwnerStorage extends OwnerStorage {
  /** true when a sealed blob exists but the passphrase could not open it —
      a WRONG PASSPHRASE IS A HARD FAILURE: reads yield nothing and writes
      are refused, so the existing owner keys can never be replaced. */
  sealed: boolean;
}

export async function encryptedOwnerStorage(base: OwnerStorage, passphrase: string): Promise<SealedOwnerStorage> {
  let memory: string | null = null;
  let sealed = false;
  const raw = base.get();
  if (raw) {
    try {
      const env = JSON.parse(raw) as { v: 1; salt: string; iv: string; data: string };
      if (env.v !== 1 || !env.salt || !env.iv || !env.data) throw new Error("not an envelope");
      const salt = b64ToBytesLocal(env.salt);
      const ivBuf = b64ToBytesLocal(env.iv).buffer as ArrayBuffer;
      const dataBuf = b64ToBytesLocal(env.data).buffer as ArrayBuffer;
      // Try current iterations first, then fall back to legacy 150k so
      // pre-hardening records still open. Both counts share the same salt/iv
      // envelope; only the KDF stretch differs.
      let plain: ArrayBuffer | null = null;
      for (const iters of [PBKDF2_ITERATIONS, PBKDF2_ITERATIONS_LEGACY]) {
        try {
          const key = await deriveKey(passphrase, salt, iters);
          plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, key, dataBuf);
          break;
        } catch {
          // try next iteration count
        }
      }
      if (!plain) throw new Error("decrypt failed at both iteration counts");
      memory = new TextDecoder().decode(plain);
    } catch {
      memory = null;
      sealed = true; // blob exists, passphrase failed — HARD lock, no regeneration
    }
  }
  return {
    sealed,
    get: () => memory,
    set: sealed ? () => { /* refuse — sealed keys are never overwritten by a failed unlock */ } : (v: string) => {
      memory = v;
      void (async () => {
        try {
          const salt = crypto.getRandomValues(new Uint8Array(16));
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const key = await deriveKey(passphrase, salt);
          const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, new TextEncoder().encode(v));
          base.set(JSON.stringify({ v: 1, salt: bytesToB64Local(salt), iv: bytesToB64Local(iv), data: bytesToB64Local(new Uint8Array(ct)) }));
        } catch { /* storage refused — memory copy keeps the session alive */ }
      })();
    },
  };
}
