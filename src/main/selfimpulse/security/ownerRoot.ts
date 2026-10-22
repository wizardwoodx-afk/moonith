/**
 * §OWNER ROOT — the live binding of the human's key.
 *
 * The sovereign's root is BINDABLE (`bindOwnerSigner`); this file is where
 * the running product binds and unbinds it. The owner's presence proof on
 * this machine is the vault passphrase — the one secret only the owner
 * should know — so the root's lifecycle IS the vault's lifecycle:
 *
 *     vault unlock  →  derive owner key  →  bind as THE root
 *     vault lock    →  unbind + sweep    →  back to labelled bootstrap
 *
 * THE LAWS THIS FILE ENFORCES
 *  1. THE PASSPHRASE NEVER PERSISTS. It arrives, it derives, it is gone.
 *     Only the derived key lives, in memory, for the session.
 *  2. THE DERIVATION IS HARDENED, NOT RAW. The passphrase never becomes a
 *     key directly: it first runs through the vault's own hardened KDF
 *     (PBKDF2-SHA-256 with the vault's random salt and cost), and only
 *     that high-entropy output is domain-separated (HKDF) into the
 *     Ed25519 root seed. One derivation scheme, reused — no invented
 *     crypto. Where no vault exists (headless probe runtimes), the file
 *     says so and derives the honest weaker path.
 *  3. THE DERIVATION IS STABLE PER VAULT. The same vault (same salt) and
 *     the same passphrase yield the same owner key across sessions — the
 *     owner's authority has a stable identity, like the person it belongs
 *     to. A different passphrase yields a different key: no guessing.
 *  4. LOCK LOCKS. Locking the vault unbinds the root and sweeps every
 *     capability minted under it — a key that is gone cannot vouch, nothing
 *      dead survives it, and the dead stay dead. Until the owner returns,
 *     the sovereign is the labelled bootstrap: able to read, powerless
 *     to effect (no effectful capability mints under bootstrap).
 *  5. BINDING IS HONEST OR ABSENT. If derivation or binding fails, the
 *     sovereign keeps its labelled "bootstrap" root — the product never
 *     claims an owner it cannot verify.
 */
import { createHash, createPrivateKey, createPublicKey, hkdfSync, pbkdf2Sync, sign as edSign, verify as edVerify } from "node:crypto";
import { sovereign, type Signer } from "./sovereign";
import { invalidateCapabilitiesForRoot } from "./capability";
import { vaultKdfParams } from "../engine/vault";

/** Domain separation for the final step — never reused elsewhere. */
const OWNER_ROOT_SALT = "si.owner-root.v1";
const OWNER_ROOT_INFO = "ed25519 root seed";
/** RFC 8032 PKCS#8 prefix for a 32-byte Ed25519 private key seed.
 *
 * 19.7.14 — built by a FUNCTION, not a module-level `const`. `Buffer` is a Node
 * global, not an import, so `Buffer.from(...)` at top level raised
 * `ReferenceError: Buffer is not defined` in the WebView — during import-graph
 * evaluation, before React ever mounted. Same shape as the `process.cwd()`
 * fault in `sovereign.ts`, and for the same reason: the `node:buffer` alias in
 * vite.config.ts rewrites the SPECIFIER `node:buffer` and cannot reach a bare
 * global.
 *
 * Lazy is the correct fix rather than a shim, because this prefix is only ever
 * needed on the key-derivation path, which the browser cannot perform anyway
 * (`node:crypto` is a throwing stub there). Deferring keeps the module
 * importable so the import graph completes, while the actual derivation still
 * fails loudly with a stated cause if it is ever reached. */
function ed25519Pkcs8Prefix(): Buffer {
  return Buffer.from("302e020100300506032b657004220420", "hex");
}

/** Derive the owner's root signer from their passphrase. Where the vault
 *  exists, the passphrase is hardened by the vault's own KDF first; the
 *  HKDF step is pure domain separation over that output. */
export function deriveOwnerSigner(passphrase: string): Signer {
  let material: Buffer;
  const kdf = vaultKdfParams();
  if (kdf) {
    /* The vault's hardened path: PBKDF2-SHA-256 over the vault's stored
     * salt and cost — the same work factor the vault itself demands. */
    material = pbkdf2Sync(passphrase, Buffer.from(kdf.saltB64, "base64"), kdf.iterations, 32, "sha256");
  } else {
    /* No vault meta in this runtime (headless probe/dev runs): the honest
     * weaker path — the passphrase IS the input material, domain-separated.
     * The desktop always takes the hardened path above. */
    material = Buffer.from(passphrase, "utf8");
  }
  const seed = Buffer.from(hkdfSync("sha256", material, OWNER_ROOT_SALT, OWNER_ROOT_INFO, 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([ed25519Pkcs8Prefix(), seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const pubDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const id = createHash("sha256").update(pubDer).digest("hex").slice(0, 16);
  return {
    id,
    sign: (data) => edSign(null, Buffer.from(data, "utf8"), privateKey).toString("base64"),
    verify: (data, sig) => {
      try {
        return edVerify(null, Buffer.from(data, "utf8"), publicKey, Buffer.from(sig, "base64"));
      } catch {
        return false;
      }
    },
  };
}

/** Bind the live root: derive the owner's key from the vault passphrase and
 *  make it THE sovereign root (mandates AND capabilities sign with it from
 *  here on). Capabilities minted under any previous root are swept — they
 *  were vouches from a key that is no longer the root. Idempotent: the same
 *  passphrase binds the same key. */
export function bindOwnerRoot(passphrase: string): { ok: true; signerId: string } | { ok: false; error: string } {
  try {
    const previous = sovereign.signerId;
    const signer = deriveOwnerSigner(passphrase);
    sovereign.bindOwnerSigner(signer);
    /* A root CHANGE kills the old root's outstanding capabilities (marked,
     * not deleted — redeem-once memory survives). Re-binding the SAME key
     * invalidates nothing: unlock must not resurrect what the lock already
     * killed, and it must not kill what is still alive. */
    if (previous !== signer.id) invalidateCapabilitiesForRoot(previous);
    return { ok: true, signerId: signer.id };
  } catch (e) {
    return { ok: false, error: `the owner root could not be bound: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Headless boot: the operator who LAUNCHED an engine is the owner present
 *  in that room, and they vouch through the environment. No secret in the
 *  environment, no owner — the engine stays the labelled bootstrap, where
 *  the gate refuses every effectful approval. Nothing is defaulted: a
 *  headless engine without an operator vouch has no authority to effect. */
export function bindOwnerRootFromEnv(env?: NodeJS.ProcessEnv): boolean {
  /* 19.7.14 — `= process.env` as a DEFAULT PARAMETER is evaluated at CALL time,
   * not at import, so it never caused the blank page. It is made optional here
   * anyway because that default is a bare Node global: any browser caller would
   * have thrown a `ReferenceError` from inside what is documented as a boolean
   * predicate. Reading it through a guard keeps the answer honest — no
   * environment, no owner. */
  const source =
    env ?? (typeof process !== "undefined" && process.env ? process.env : ({} as NodeJS.ProcessEnv));
  const secret = source.SI_OWNER_SECRET;
  if (typeof secret !== "string" || secret.length === 0) return false;
  return bindOwnerRoot(secret).ok;
}

/** The vault-lock act: the owner's authority leaves memory. The root
 *  reverts to the labelled bootstrap; every capability minted under the
 *  departing root is INVALIDATED — marked dead for good, so nothing
 *  outstanding can be redeemed after the owner returns. */
export function lockOwnerRoot(): void {
  const departing = sovereign.signerId;
  sovereign.unbindOwnerSigner();
  invalidateCapabilitiesForRoot(departing);
}
