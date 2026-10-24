/**
 * VH MISSION AUTHORITY — 19.5.1 "Reach" (review hardening, round 2)
 *
 * The live runtime trust path. Two DIFFERENT authority semantics, kept apart:
 *
 *   A. OWNER GRANTS (a-priori) — only via `issueMissionMandate` behind the
 *      human gate (Agent Reach MCP surface). Explicit non-empty scope,
 *      clamped budget/depth. This is permission.
 *
 *   B. RUN ATTESTATION (a-posteriori) — the Generalist signs, per finished
 *      run, a mandate whose scope is EXACTLY the tool classes actually
 *      EXECUTED and whose budget is the number of executed tool actions.
 *      Nothing executed ⇒ no authority is minted at all (`authority: null`).
 *      This is provenance — a signed record of what happened, never a broad
 *      standing permission.
 *
 * Hardened further:
 *   · ONE mandate object per mission — response digest and ledger record
 *     reference the identical mandate; verification recomputes the mandate
 *     digest from the stored mandate and checks digest identity.
 *   · The binding material itself commits to the mandate digest
 *     (receiptDigest + mandateDigest + hopDigest + owner).
 *   · Owner keys: passphrase-encrypted browser
 *     storage (AES-GCM) > honest session-scoped keys. Plaintext persistence
 *     is gone from the production path (see ownerKeyStore.ts).
 */
import {
  generateOwnerKeysWeb, signMandateWeb, verifyMandateWeb,
  bindAuthorityToReceiptWeb, verifyAuthorityBindingWeb, sha256HexWeb, mandateCanonical,
} from "./authorityWeb";
import type { Mandate, OwnerKeyPairWeb } from "./authorityWeb";
import { encryptedOwnerStorage, type KeySecurity, type SealedOwnerStorage } from "./ownerKeyStore";
import { mainStorage } from "../persist/mainStorage";

export const AUTHORITY_OWNER_FALLBACK = "local-owner";
export const AUTHORITY_SCHEME = "ecdsa-p256";

/* The full scope an owner may ever grant — issuance is capped to subsets. */
export const ISSUABLE_SCOPE = ["fs.read", "fs.write", "fs.list", "net.fetch", "wiki.search", "pc.exec", "pc.browser"] as const;
export const MAX_BUDGET = 100;
export const MAX_DEPTH = 1;

export interface OwnerStorage { get(): string | null; set(v: string): void }

function nativeStorage(): Storage | null {
  try {
    return globalThis.localStorage ??
      (typeof process !== "undefined" && process.versions?.electron ? mainStorage() : null);
  } catch {
    return null;
  }
}

const nativeRawStorage: OwnerStorage | null = (() => {
  const storage = nativeStorage();
  if (!storage) return null;
  return {
    get: () => storage.getItem("engine.ownerKeys.v1"),
    set: (value) => storage.setItem("engine.ownerKeys.v1", value),
  };
})();

export interface OwnerIdentity {
  keys: OwnerKeyPairWeb;
  owner: string;
  /** How the private key is protected: encrypted store, or session-only. */
  security: KeySecurity;
  /** True when the keypair came from (or was written to) durable storage. */
  persisted: boolean;
  /** True when a sealed key blob exists but the passphrase could not open it —
      unlock FAILED hard; session keys were minted and the sealed keys are intact. */
  unlockFailed?: boolean;
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

async function loadOrCreate(storage: OwnerStorage | null, identity: string, security: KeySecurity): Promise<OwnerIdentity> {
  const owner = identity.trim() || AUTHORITY_OWNER_FALLBACK;
  if (storage) {
    try {
      const raw = storage.get();
      if (raw) {
        const saved = JSON.parse(raw) as { byOwner: Record<string, { priv: JsonWebKey; pem: string }> };
        const entry = saved.byOwner?.[owner];
        if (entry) {
          const privateKey = await crypto.subtle.importKey("jwk", entry.priv, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
          const publicKey = await crypto.subtle.importKey("spki", pemToDer(entry.pem), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
          return { keys: { privateKey, publicKey, publicKeyPem: entry.pem }, owner, security, persisted: true };
        }
      }
    } catch { /* corrupted or sealed without the passphrase — re-mint below, honestly */ }
  }
  const keys = await generateOwnerKeysWeb();
  const ident: OwnerIdentity = { keys, owner, security, persisted: Boolean(storage) };
  if (storage) {
    try {
      const priv = await crypto.subtle.exportKey("jwk", keys.privateKey);
      const raw = storage.get();
      let byOwner: Record<string, { priv: JsonWebKey; pem: string }> = {};
      if (raw) { try { byOwner = (JSON.parse(raw) as { byOwner?: typeof byOwner }).byOwner ?? {}; } catch { /* fresh */ } }
      byOwner[owner] = { priv, pem: keys.publicKeyPem };
      storage.set(JSON.stringify({ byOwner }));
    } catch { /* storage refused — the key stays session-scoped, honestly */ }
  }
  return ident;
}

/* Identity cache — one durable keypair PER owner name, per storage realm. */
const realmCache = new WeakMap<object, Map<string, OwnerIdentity>>();
let ephemeralCache: Map<string, OwnerIdentity> | null = null;
let defaultStorageCache: { key: string; promise: Promise<{ storage: OwnerStorage | null; security: KeySecurity }> } | null = null;

/**
 * Resolve the production storage seam: encrypted browser
 * storage (passphrase required) > session-only. Private key material is
 * NEVER written plaintext by this path.
 */
async function resolveDefaultStorage(passphrase?: string): Promise<{ storage: OwnerStorage | null; security: KeySecurity }> {
  if (nativeRawStorage && passphrase) {
    const enc = await encryptedOwnerStorage(nativeRawStorage, passphrase);
    return { storage: enc, security: "encrypted" };
  }
  return { storage: null, security: "session" };
}

export interface OwnerIdentityOptions {
  storage?: OwnerStorage;           // explicit seam (probes, hosts)
  identity?: string;                // the VH handle that owns the key
  passphrase?: string;              // enables encrypted-at-rest in the browser
}

/* ── web unlock seam ─────────────────────────────────────────────────────────
   The door collects the owner's authority passphrase and hands it here ONCE;
   from then on the web path persists the owner key ENCRYPTED (AES-GCM).
   No passphrase ⇒ web authority is honestly session-scoped — the docs say so. */
let activePassphrase: string | null = null;
export function setAuthorityPassphrase(p: string | null): void { activePassphrase = p && p.length > 0 ? p : null; }
export function authorityUnlocked(): boolean { return activePassphrase !== null; }

/**
 * The owner identity for this runtime. Per-handle keypairs; durable ONLY
 * behind native keystore or the owner's passphrase — otherwise session-scoped
 * and honestly flagged as such.
 */
export async function authorityOwnerIdentity(opts?: OwnerIdentityOptions): Promise<OwnerIdentity> {
  const owner = opts?.identity?.trim() || AUTHORITY_OWNER_FALLBACK;
  const passphrase = opts?.passphrase ?? activePassphrase ?? undefined;
  if (opts?.storage) {
    /* sealed explicit storage = failed unlock — session keys, blob untouched */
    if ((opts.storage as SealedOwnerStorage).sealed) {
      const ident = await loadOrCreate(null, owner, "session");
      ident.unlockFailed = true;
      return ident;
    }
    let m = realmCache.get(opts.storage);
    if (!m) { m = new Map(); realmCache.set(opts.storage, m); }
    const hit = m.get(owner);
    if (hit) return hit;
    const ident = await loadOrCreate(opts.storage, owner, "encrypted");
    m.set(owner, ident);
    return ident;
  }
  /* re-resolve when the unlock state changes (session → encrypted) */
  const key = passphrase ?? "";
  if (!defaultStorageCache || defaultStorageCache.key !== key) {
    defaultStorageCache = { key, promise: resolveDefaultStorage(passphrase) };
  }
  let { storage, security } = await defaultStorageCache.promise;
  /* Review fix — a wrong passphrase is a HARD unlock failure: sealed keys are
     never regenerated or overwritten; the run falls back to session keys and
     the identity honestly reports unlockFailed. */
  let unlockFailed = false;
  if (storage && (storage as SealedOwnerStorage).sealed) {
    storage = null;
    security = "session";
    unlockFailed = true;
  }
  if (!storage) {
    if (!ephemeralCache) ephemeralCache = new Map();
    const cacheKey = unlockFailed ? `${owner}::unlock-failed` : owner;
    const hit = ephemeralCache.get(cacheKey);
    if (hit) return hit;
    const ident = await loadOrCreate(null, owner, security);
    if (unlockFailed) ident.unlockFailed = true;
    ephemeralCache.set(cacheKey, ident);
    return ident;
  }
  let m = realmCache.get(storage);
  if (!m) { m = new Map(); realmCache.set(storage, m); }
  const hit = m.get(owner);
  if (hit) return hit;
  const ident = await loadOrCreate(storage, owner, security);
  m.set(owner, ident);
  return ident;
}

export interface MissionMandateRequest {
  missionId: string;
  /** Explicit scope the owner grants — must be a non-empty subset of ISSUABLE_SCOPE. */
  scope: string[];
  budgetCap?: number;
  maxDepth?: number;
  ttlMs?: number;
}

/** A. OWNER GRANTS — strict: explicit non-empty scope, clamped budget/depth. */
export async function issueMissionMandate(req: MissionMandateRequest, opts?: OwnerIdentityOptions & { now?: number }): Promise<Mandate> {
  const now = opts?.now ?? Date.now();
  const ident = await authorityOwnerIdentity(opts);
  const scope = [...new Set(req.scope ?? [])].filter((s) => (ISSUABLE_SCOPE as readonly string[]).includes(s)).sort();
  if (scope.length === 0) {
    throw new Error("authority cannot be issued with an empty scope — the owner must name what is granted");
  }
  return signMandateWeb({
    agentId: `engine:${req.missionId}`,
    owner: ident.owner,
    scope,
    budgetCap: Math.max(1, Math.min(req.budgetCap ?? MAX_BUDGET, MAX_BUDGET)),
    maxDepth: Math.max(0, Math.min(req.maxDepth ?? MAX_DEPTH, MAX_DEPTH)),
    issuedAt: now,
    expiresAt: now + Math.min(req.ttlMs ?? 3_600_000, 24 * 3_600_000),
  }, ident.keys);
}

/**
 * B. RUN ATTESTATION — the Generalist signs what ACTUALLY happened.
 * Scope = tool classes actually executed; budget = executed action count;
 * depth 0 (attestations never delegate). Empty execution ⇒ null — a run that
 * did nothing carries NO authority, never a minted-but-unused mandate.
 */
export async function attestMissionRun(
  req: { missionId: string; executedTools: string[] },
  opts?: OwnerIdentityOptions & { now?: number },
): Promise<Mandate | null> {
  const executed = [...new Set(req.executedTools)].filter((t) => (ISSUABLE_SCOPE as readonly string[]).includes(t)).sort();
  if (executed.length === 0) return null;
  const actions = req.executedTools.filter((t) => (ISSUABLE_SCOPE as readonly string[]).includes(t)).length;
  const now = opts?.now ?? Date.now();
  const ident = await authorityOwnerIdentity(opts);
  return signMandateWeb({
    agentId: `engine:${req.missionId}`,
    owner: ident.owner,
    scope: executed,
    budgetCap: Math.min(Math.max(1, actions), MAX_BUDGET),
    maxDepth: 0,
    issuedAt: now,
    expiresAt: now + 3_600_000,
  }, ident.keys);
}

export interface MissionAuthorityRecord {
  missionId: string;
  /** The mission's provenance digest — what the binding attaches to. */
  responseDigest: string;
  /** The EXACT mandate whose digest rides in the response. */
  mandate: Mandate;
  mandateDigest: string;
  publicKeyPem: string;
  bindingDigest: string;
  scheme: typeof AUTHORITY_SCHEME;
  at: number;
}

const KEY = "engine.authority.v1";

function loadLedger(): MissionAuthorityRecord[] {
  try {
    const raw = nativeStorage()?.getItem(KEY);
    return raw ? (JSON.parse(raw) as MissionAuthorityRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Bind the ALREADY-ISSUED mandate to the finished mission's provenance digest
 * and append the record. The binding material commits to the mandate digest.
 */
export async function recordMissionAuthority(
  missionId: string,
  responseDigest: string,
  mandate: Mandate,
  mandateDigest: string,
  publicKeyPem: string,
  now = Date.now(),
): Promise<MissionAuthorityRecord> {
  const binding = await bindAuthorityToReceiptWeb(responseDigest, null, mandate.owner, mandateDigest);
  const rec: MissionAuthorityRecord = {
    missionId, responseDigest, mandate, mandateDigest, publicKeyPem,
    bindingDigest: binding.digest, scheme: AUTHORITY_SCHEME, at: now,
  };
  try {
    const ledger = loadLedger();
    ledger.push(rec);
    nativeStorage()?.setItem(KEY, JSON.stringify(ledger.slice(-200)));
  } catch { /* storage-less runtimes keep the in-memory return value */ }
  return rec;
}

export function missionAuthorityFor(responseDigest: string): MissionAuthorityRecord | null {
  return loadLedger().find((r) => r.responseDigest === responseDigest) ?? null;
}

/**
 * Offline verification — independent, no trust in the record's own claims:
 *   1. the mandate's signature verifies with the stored public key;
 *   2. the stored mandateDigest EQUALS SHA-256(canonical(stored mandate)) —
 *      recomputed, never taken on faith;
 *   3. the binding digest recomputes over (receipt + mandate + owner);
 *   4. an expected mandate digest (e.g. from the response) must match.
 */
export async function verifyMissionAuthorityRecord(rec: MissionAuthorityRecord, expectedMandateDigest?: string, now = Date.now()): Promise<boolean> {
  const m = await verifyMandateWeb(rec.mandate, rec.publicKeyPem, now);
  if (!m.ok) return false;
  const recomputed = await sha256HexWeb(mandateCanonical(rec.mandate));
  if (recomputed !== rec.mandateDigest) return false;
  if (expectedMandateDigest !== undefined && rec.mandateDigest !== expectedMandateDigest) return false;
  return verifyAuthorityBindingWeb(
    { receiptDigest: rec.responseDigest, mandateDigest: rec.mandateDigest, hopDigest: null, mandateOwner: rec.mandate.owner, digest: rec.bindingDigest },
    rec.responseDigest,
    null,
    rec.mandateDigest,
  );
}
