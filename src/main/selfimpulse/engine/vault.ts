/**
 * SelfImpulse — the owner vault (19.7.1).
 *
 * The 19.7.0 review was right twice: provider API keys sat PLAINTEXT in
 * localStorage, and the new memory graph stored conversation content
 * unencrypted at rest. For a product whose entire position is "the
 * accountable, secure way to run agents", that was the biggest cleanup
 * item left. This module is the answer, and it follows the exact house
 * pattern `secureKeys.ts` set in 18.3.0:
 *
 *   • AES-256-GCM under a key derived from the owner's passphrase
 *     (PBKDF2-HMAC-SHA-256. The shipped 310k cost is a measured desktop-
 *      performance choice, recorded in the vault meta — not a claim about
 *      current third-party guidance, which has since moved higher. New
 *      vaults calibrate against THIS machine and never calibrate below the
 *      shipped floor; existing vaults can be upgraded on unlock —
 *      see upgradeVaultCost. Where the platform offers a memory-hard KDF,
 *      a future re-key moment may adopt it);
 *   • the passphrase and the derived key are NEVER stored — the key lives
 *     in module memory for the session only; nothing decrypts at boot;
 *   • a sealed record is a small JSON envelope: version, salt, iv,
 *     ciphertext, kdf parameters. Plaintext never touches storage when a
 *     passphrase is set;
 *   • without a passphrase the vault is HONEST: callers either keep data
 *     in memory only (provider keys) or state plainly that the record is
 *     unencrypted at rest (memory graph) — it never pretends;
 *   • legacy plaintext records are purgeable by name (`purgePlain`) —
 *     19.7.1 migrates the old `vh.provider.remembered.v1` blob on boot.
 *
 * What this does NOT do, and says so: it does not resist a memory-read
 * after unlock, and it is not a hardware boundary. The native upgrade
 * path (OS keychain behind Tauri IPC) is the same one documented for
 * `secureKeys.ts` — no unverifiable Rust ships pretending to be one.
 */

import { mainStorage } from "../persist/mainStorage";

export const VAULT_FORMAT = "si-vault/1";
const VAULT_META_KEY = "vh.vault.meta.v1";
/* 20.x — the two-phase journal for cost upgrades. A re-seal that wrote its new
   meta BEFORE the records (or the reverse) could be interrupted by process
   death at the one moment the two disagreed, and every remaining record would
   be unreadable forever, under a passphrase the owner still knows. The journal
   holds BOTH metas and the old raw records so any interruption can be un-wound
   the next time the module touches storage. */
const VAULT_UPGRADE_KEY = VAULT_META_KEY + ".upgrading";
const PBKDF_ITERATIONS = 310_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface VaultMeta {
  v: "si-vault-meta/1";
  saltB64: string;
  ivB64: string;
  cipherB64: string;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  createdAt: string;
}

export interface SealedRecord {
  v: typeof VAULT_FORMAT;
  saltB64: string;
  ivB64: string;
  cipherB64: string;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  sealedAt: string;
}

export type VaultOpenResult =
  | { found: false }
  | { found: true; locked: true }
  | { found: true; locked: false; text: string };

export type VaultStatus = "no-passphrase" | "unlocked" | "sealed-locked";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ??
      (typeof process !== "undefined" && process.versions?.electron ? mainStorage() : null);
  } catch {
    return null;
  }
}

const toB64 = (buf: ArrayBuffer | Uint8Array): string => {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let b = 0; b < u8.length; b++) s += String.fromCharCode(u8[b]);
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle(): SubtleCrypto | null {
  const c = globalThis.crypto as Crypto | undefined;
  return c && typeof c.subtle?.deriveKey === "function" ? c.subtle : null;
}

function randomBytes(n: number): Uint8Array {
  const u8 = new Uint8Array(n);
  globalThis.crypto.getRandomValues(u8);
  return u8;
}

/* the session key — module memory ONLY, dropped on lock, never persisted */
let sessionKey: CryptoKey | null = null;
/* the exact params the CURRENT meta record was derived with, so opens match */
let sessionParams: { salt: Uint8Array; meta: VaultMeta } | null = null;

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number = PBKDF_ITERATIONS): Promise<CryptoKey> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto SubtleCrypto is unavailable in this runtime — the vault refuses rather than pretend to encrypt");
  const base = await s.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return s.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Roll an interrupted cost-upgrade back (or forward), before anything reads meta.
 *
 * The upgrade journal guarantees one of two coherent states exists on disk:
 * the ENTIRE old vault (old meta + old sealed records), or the ENTIRE new
 * vault (new meta + all records re-sealed at the new cost). Which one it is is
 * decided by evidence, not hope: a record still carrying its journaled OLD raw
 * bytes is un-re-sealed, so the whole vault is rolled BACK to the journaled old
 * state; every record differing from its journaled old bytes means the
 * re-seal completed, and the journaled NEW meta is committed instead.
 */
function recoverInterruptedUpgrade(): void {
  const s = storage();
  if (!s) return;
  const raw = s.getItem(VAULT_UPGRADE_KEY);
  if (!raw) return;
  try {
    const j = JSON.parse(raw) as { oldMeta?: unknown; newMeta?: unknown; records?: unknown };
    const oldMeta = typeof j.oldMeta === "string" ? j.oldMeta : null;
    const newMeta = typeof j.newMeta === "string" ? j.newMeta : null;
    const records = j.records && typeof j.records === "object" ? j.records as Record<string, unknown> : null;
    if (!oldMeta || !newMeta || !records) throw new Error("journal is not the shape this version wrote");
    let resealed = 0;
    for (const [name, oldRaw] of Object.entries(records)) {
      if (typeof oldRaw !== "string") continue;
      if (s.getItem(name) !== oldRaw) resealed += 1;
      else s.setItem(name, oldRaw); // a record the upgrade never reached — make it certain
    }
    if (resealed === 0) {
      // nothing was re-sealed: the old vault is intact, restore it exactly
      s.setItem(VAULT_META_KEY, oldMeta);
    } else if (Object.keys(records).length === resealed) {
      // every record was re-sealed before the interruption: finish the upgrade
      s.setItem(VAULT_META_KEY, newMeta);
    } else {
      // partially re-sealed: roll everything back to the old state as one hand
      for (const [name, oldRaw] of Object.entries(records)) {
        if (typeof oldRaw === "string") s.setItem(name, oldRaw);
      }
      s.setItem(VAULT_META_KEY, oldMeta);
    }
    s.removeItem(VAULT_UPGRADE_KEY);
  } catch {
    /* A journal this shape cannot parse is one this version did not write —
       but it must not outlive this boot either, or it re-triggers forever. */
    try { s.removeItem(VAULT_UPGRADE_KEY); } catch { /* best effort */ }
  }
}

function readMeta(): VaultMeta | null {
  recoverInterruptedUpgrade();
  const s = storage();
  if (!s) return null;
  try {
    const raw = JSON.parse(s.getItem(VAULT_META_KEY) ?? "null") as VaultMeta | null;
    return raw && raw.v === "si-vault-meta/1" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Set (or replace) the vault passphrase. Creates the meta record with a
 * fresh salt and an encrypted check-string, or verifies the given
 * passphrase against the existing one. The derived key lives in module
 * memory for the session.
 */
export async function setVaultPassphrase(passphrase: string, now: () => Date = () => new Date()): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  if (typeof passphrase !== "string" || passphrase.length < 8) {
    return { ok: false, error: "a vault passphrase needs at least 8 characters — there is no recovery, so length is the only strength that cannot be taken from you" };
  }
  const existing = readMeta();
  try {
    if (!existing) {
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      /* A NEW vault measures this machine and never sets less than the
       * shipped floor: the cost is honest for the hardware it lives on. */
      const iterations = await calibratedIterations();
      const key = await deriveKey(passphrase, salt, iterations);
      const check = await subtle()!.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode("si-vault-check/1"));
      const meta: VaultMeta = { v: "si-vault-meta/1", saltB64: toB64(salt), ivB64: toB64(iv), cipherB64: toB64(check), kdf: "PBKDF2-SHA-256", iterations, createdAt: now().toISOString() };
      const s = storage();
      if (!s) return { ok: false, error: "no storage in this runtime — the vault can exist for this session only; persistence needs a store" };
      s.setItem(VAULT_META_KEY, JSON.stringify(meta));
      sessionKey = key;
      sessionParams = { salt, meta };
      return { ok: true, created: true };
    }
    // existing meta — verify by decrypting the check string
    try {
      const salt = fromB64(existing.saltB64);
      /* the cost the vault was BORN with — an upgraded vault opens at its
         own recorded cost, never at the shipped constant */
      const key = await deriveKey(passphrase, salt, existing.iterations);
      const plain = await subtle()!.decrypt({ name: "AES-GCM", iv: fromB64(existing.ivB64) as BufferSource }, key, fromB64(existing.cipherB64) as BufferSource);
      if (dec.decode(plain) !== "si-vault-check/1") return { ok: false, error: "that passphrase did not open the vault — nothing was changed" };
      sessionKey = key;
      sessionParams = { salt, meta: existing };
      return { ok: true, created: false };
    } catch {
      return { ok: false, error: "that passphrase did not open the vault — nothing was changed" };
    }
  } catch (e) {
    return { ok: false, error: `the vault refused the passphrase: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Drop the session key. Sealed records stay sealed; nothing re-encrypts or decrypts silently. */
export function lockVault(): void {
  sessionKey = null;
  sessionParams = null;
}

export function vaultHasPassphrase(): boolean {
  return sessionKey !== null;
}

/** The vault's hardened derivation parameters (salt + iteration cost) —
 *  readable WITHOUT the session, because the meta record is not secret.
 *  The owner-root derivation rides on exactly these params, so the owner's
 *  key inherits the vault's password hardening instead of inventing its own. */
export function vaultKdfParams(): { saltB64: string; iterations: number } | null {
  const meta = readMeta();
  return meta ? { saltB64: meta.saltB64, iterations: meta.iterations } : null;
}

/** Measured on THIS machine: a PBKDF2 cost worth about `targetMs` of unlock
 *  work. Never returns less than the shipped floor — calibration raises the
 *  cost on fast hardware; it never weakens a vault below it. */
export async function calibratedIterations(targetMs = 250): Promise<number> {
  const s = subtle();
  if (!s) return PBKDF_ITERATIONS;
  try {
    const base = await s.importKey("raw", enc.encode("si-vault-calibration"), "PBKDF2", false, ["deriveBits"]);
    const probeSalt = new Uint8Array(16);
    const t0 = Date.now();
    await s.deriveBits({ name: "PBKDF2", salt: probeSalt as BufferSource, iterations: 20_000, hash: "SHA-256" }, base, 256);
    const per20k = Math.max(1, Date.now() - t0);
    const scaled = Math.round((20_000 * targetMs) / per20k / 1000) * 1000;
    return Math.min(2_000_000, Math.max(PBKDF_ITERATIONS, scaled));
  } catch {
    return PBKDF_ITERATIONS;
  }
}

/** Raise the vault's cost to this machine's measured level — the unlock-time
 *  upgrade. The passphrase re-derives at the new cost with a FRESH salt, every
 *  sealed record is decrypted FIRST (with the still-current key) and re-sealed
 *  under the two-phase journal in `recoverInterruptedUpgrade`; if any record
 *  fails to open, nothing changes. Safe to call on every unlock: an
 *  already-current vault is a no-op. */
export async function upgradeVaultCost(passphrase: string, targetIterations?: number): Promise<{ changed: boolean; iterations?: number; note: string }> {
  const meta = readMeta();
  if (!meta) return { changed: false, note: "no vault on this machine — nothing to upgrade" };
  if (!sessionKey) return { changed: false, note: "the vault is locked — unlock before upgrading its cost" };
  const target = targetIterations ?? await calibratedIterations();
  if (target <= meta.iterations) {
    return { changed: false, note: `the vault's cost (${meta.iterations}) already meets this machine's measured level (${target})` };
  }
  const s = storage();
  if (!s) return { changed: false, note: "no storage in this runtime — nothing to upgrade" };
  // 1 · find every sealed record, decrypt it NOW with the current key, and
  //     capture its current raw bytes for the rollback journal.
  const sealed: string[] = [];
  const oldRaw = new Map<string, string>();
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k) continue;
    const raw = s.getItem(k);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { v?: string };
      if (parsed?.v === VAULT_FORMAT) {
        sealed.push(k);
        oldRaw.set(k, raw);
      }
    } catch { /* not a vault record */ }
  }
  const plain: Array<{ name: string; text: string }> = [];
  for (const name of sealed) {
    const r = await vaultOpenAsync(name);
    if (!r.found || r.locked || r.text === undefined) {
      return { changed: false, note: `a sealed record (${name}) did not open — the cost was not changed` };
    }
    plain.push({ name, text: r.text });
  }
  // 2 · re-derive at the new cost with a fresh salt (in memory — nothing is
  //     written yet, so a crash from here on is just "no upgrade happened").
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const newKey = await deriveKey(passphrase, salt, target);
  const oldKey = sessionKey;
  const oldParams = sessionParams;
  const check = await subtle()!.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, newKey, enc.encode("si-vault-check/1"));
  const newMeta: VaultMeta = { ...meta, saltB64: toB64(salt), ivB64: toB64(iv), cipherB64: toB64(check), iterations: target };
  const oldMetaRaw = s.getItem(VAULT_META_KEY);
  if (oldMetaRaw === null) return { changed: false, note: "the meta record vanished mid-upgrade — nothing was changed" };
  // 3 · the journal commits the rollback state FIRST: old meta + old raw
  //     records under ONE key, so any interruption below has a coherent hand
  //     back to play next boot. The new meta travels with it, so a crash after
  //     every record was re-sealed but before the meta swap can also roll
  //     FORWARD instead of locking the vault.
  try {
    s.setItem(VAULT_UPGRADE_KEY, JSON.stringify({
      oldMeta: oldMetaRaw,
      newMeta: JSON.stringify(newMeta),
      records: Object.fromEntries(oldRaw),
    }));
  } catch (e) {
    return { changed: false, note: `the rollback journal could not be written (${e instanceof Error ? e.message : String(e)}) — the cost was not changed, because an interrupted upgrade would not have been recoverable` };
  }
  // 4 · swap the session, re-seal every record at the new cost, and only when
  //     ALL of them are written, commit the new meta and clear the journal.
  sessionKey = newKey;
  sessionParams = { salt, meta: newMeta };
  let resealed = 0;
  for (const p of plain) {
    const r = await vaultSeal(p.name, p.text);
    if (!r.ok) {
      // Hand back to the journal's coherent old state; the session returns to
      // the key the old records were actually sealed with.
      s.setItem(VAULT_META_KEY, oldMetaRaw);
      for (const [name, raw] of oldRaw) s.setItem(name, raw);
      s.removeItem(VAULT_UPGRADE_KEY);
      sessionKey = oldKey;
      sessionParams = oldParams;
      return { changed: false, note: `${p.name} failed to re-seal (${r.error}) — every record was restored to the old cost; the upgrade did not happen` };
    }
    resealed += 1;
  }
  s.setItem(VAULT_META_KEY, JSON.stringify(newMeta));
  s.removeItem(VAULT_UPGRADE_KEY);
  return { changed: true, iterations: target, note: `cost upgraded to ${target} iterations; ${resealed} sealed record(s) re-sealed` };
}

export type VaultStatusInfo = {
  status: VaultStatus;
  /** a meta record exists on this machine */
  created: boolean;
  kdf: "PBKDF2-SHA-256" | null;
  iterations: number | null;
};

export function vaultStatus(): VaultStatusInfo {
  const meta = readMeta();
  if (!meta) return { status: "no-passphrase", created: false, kdf: null, iterations: null };
  if (sessionKey) return { status: "unlocked", created: true, kdf: meta.kdf, iterations: meta.iterations };
  return { status: "sealed-locked", created: true, kdf: meta.kdf, iterations: meta.iterations };
}

/** Encrypt `text` into a sealed record for the named store. Requires an unlocked session. */
export async function vaultSeal(name: string, text: string, now: () => Date = () => new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sessionKey) return { ok: false, error: "the vault is locked — set or enter the passphrase before anything is sealed" };
  const meta = sessionParams?.meta;
  const salt = sessionParams?.salt;
  if (!meta || !salt) return { ok: false, error: "vault session state is missing — lock and unlock again" };
  try {
    const iv = randomBytes(12);
    const cipher = await subtle()!.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, sessionKey, enc.encode(text));
    const record: SealedRecord = { v: VAULT_FORMAT, saltB64: toB64(salt), ivB64: toB64(iv), cipherB64: toB64(cipher), kdf: "PBKDF2-SHA-256", iterations: meta.iterations, sealedAt: now().toISOString() };
    const s = storage();
    if (!s) return { ok: false, error: "no storage in this runtime — nothing was sealed" };
    s.setItem(name, JSON.stringify(record));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `sealing failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Read a named store. Sealed + no session key ⇒ { locked: true }, never a guess. */
export function vaultOpen(name: string): VaultOpenResult {
  const s = storage();
  if (!s) return { found: false };
  const raw = s.getItem(name);
  if (!raw) return { found: false };
  try {
    const parsed = JSON.parse(raw) as SealedRecord | unknown;
    if (parsed && typeof parsed === "object" && (parsed as SealedRecord).v === VAULT_FORMAT) {
      const rec = parsed as SealedRecord;
      if (!sessionKey) return { found: true, locked: true };
      // decrypt synchronously is impossible — surface via vaultOpenAsync
      void rec;
      return { found: true, locked: true };
    }
    return { found: true, locked: false, text: raw };
  } catch {
    // not JSON — treat as a legacy plaintext record
    return { found: true, locked: false, text: raw };
  }
}

/** Async open: decrypts sealed records when the session is unlocked. */
export async function vaultOpenAsync(name: string): Promise<VaultOpenResult> {
  /* The sync helper cannot decrypt AES-GCM; this is the live path. */
  return vaultDecrypt(name);
}

/** Seal-aware async read that actually decrypts (kept separate so sync probes can pin the locked case). */
export async function vaultDecrypt(name: string): Promise<{ found: false } | { found: true; locked: true } | { found: true; locked: false; text: string }> {
  const s = storage();
  if (!s) return { found: false };
  const raw = s.getItem(name);
  if (!raw) return { found: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { found: true, locked: false, text: raw };
  }
  if (!parsed || typeof parsed !== "object" || (parsed as SealedRecord).v !== VAULT_FORMAT) {
    return { found: true, locked: false, text: raw };
  }
  const rec = parsed as SealedRecord;
  if (!sessionKey) return { found: true, locked: true };
  try {
    const plain = await subtle()!.decrypt({ name: "AES-GCM", iv: fromB64(rec.ivB64) as BufferSource }, sessionKey, fromB64(rec.cipherB64) as BufferSource);
    return { found: true, locked: false, text: dec.decode(plain) };
  } catch {
    return { found: true, locked: true };
  }
}

/** Remove a named store entirely (not just lock it). */
export function vaultRemove(name: string): void {
  const s = storage();
  if (s) s.removeItem(name);
}

/**
 * Read-and-purge a LEGACY PLAINTEXT record — the 18.3.0 discipline: a key
 * written by an older build is treated as compromised and removed, not
 * silently kept. Returns the raw text so the caller can migrate it into
 * the vault or memory, and states what it did.
 */
export function purgePlain(name: string): { found: boolean; text: string | null } {
  const s = storage();
  if (!s) return { found: false, text: null };
  const raw = s.getItem(name);
  if (!raw) return { found: false, text: null };
  s.removeItem(name);
  // if it was actually a sealed record, leave semantics to the caller — purge is only called on known-plaintext keys
  return { found: true, text: raw };
}

/** Destroy the vault: the meta record goes, sealed records become unreadable forever. */
export function destroyVault(): void {
  const s = storage();
  if (s) s.removeItem(VAULT_META_KEY);
  lockVault();
}
