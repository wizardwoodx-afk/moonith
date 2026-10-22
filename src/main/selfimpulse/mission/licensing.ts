/**
 * §COMMERCIAL LICENSING — the founder's product gate (VH 11.9.4-Commercial).
 *
 * Editions
 *   personal — free forever, noncommercial (the heritage free tier)
 *   trial    — 14 days of Pro from first launch, no card, no email (PLG rule:
 *              never gate first value; time-to-value beats signup friction)
 *   pro      — HMAC-signed key issued by founder tooling (tools/issue-license.mjs),
 *              verified OFFLINE so local-first stays local-first
 *
 * HONESTY RULES (same standard as the rest of VH)
 *   1. This is a SOFT gate by design: verification is client-side HMAC, which a
 *      determined attacker can bypass. Hard enforcement (signed native builds +
 *      server attestation) is on the commercial roadmap; the soft gate is what
 *      honest customers actually need, and pretending otherwise would violate
 *      the house rule that nothing is claimed that isn't true.
 *   2. The trial clock starts on first launch and is stored, not inferred per
 *      session; deleting storage resets it and the UI says "trial (fresh)"
 *      rather than pretending to know.
 *   3. Gating is narrow and declared: Pro unlocks AUTONOMOUS evolution and
 *      elastic caps above 5 seats. Everything that makes VH VH — canvas,
 *      harnesses, verification, SUGGEST-mode evolution — is free forever.
 */

export type Edition = "personal" | "trial" | "pro";

export interface LicensePayload {
  edition: "pro";
  org: string;
  issued: string;
  /** ISO date or null for perpetual. */
  expires: string | null;
  maxSeats: number;
}

export type VerifyResult = { ok: true; payload: LicensePayload } | { ok: false; reason: string };

/** Embedded offline-verification secret (see honesty rule 1). */
export const VERIFY_SECRET = "si-commercial-v1-offline";
/* Legacy wire secret — receipts sealed before 16.1.0 (formats mj-proof-receipt/1|2).
   NEVER rename: already-issued receipts must stay verifiable forever. */
export const LEGACY_SEAL_SECRET = "mj-commercial-v1-offline";
/* Each wire format is sealed with the constant published when that wire shipped. */
export const SEAL_SECRET_BY_FORMAT = {
  "si-proof-receipt/2": VERIFY_SECRET,
  "mj-proof-receipt/2": LEGACY_SEAL_SECRET,
  "mj-proof-receipt/1": LEGACY_SEAL_SECRET,
} as const;
export const TRIAL_DAYS = 14;

const LS_LICENSE = "vh.license.v1";
const LS_TRIAL = "vh.trial.start";

const b64u = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64uStr = (s: string): string => b64u(new TextEncoder().encode(s));
const unb64u = (s: string): string => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "===".slice((pad.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

async function hmacB64u(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64u(new Uint8Array(sig));
}

/** Founder-side issuance (also used by the licensing probe). */
export async function issueLicenseKey(payload: LicensePayload, secret: string = VERIFY_SECRET): Promise<string> {
  const body = b64uStr(JSON.stringify(payload));
  return `${body}.${await hmacB64u(body, secret)}`;
}

export async function verifyLicenseKey(key: string, nowMs: number = Date.now(), secret: string = VERIFY_SECRET): Promise<VerifyResult> {
  const [body, sig] = key.split(".");
  if (!body || !sig) return { ok: false, reason: "malformed key" };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(unb64u(body)) as LicensePayload;
  } catch {
    return { ok: false, reason: "payload not readable" };
  }
  const expect = await hmacB64u(body, secret);
  if (expect !== sig) return { ok: false, reason: "signature mismatch" };
  if (payload.edition !== "pro") return { ok: false, reason: "not a pro payload" };
  if (payload.expires && Date.parse(payload.expires) < nowMs) return { ok: false, reason: `expired ${payload.expires}` };
  return { ok: true, payload };
}

/* ── storage-guarded state ─────────────────────────────────────────────── */

const mem: { license: LicensePayload | null; trialStart: string | null } = { license: null, trialStart: null };
const hasLS = typeof localStorage !== "undefined";

function lsGet(k: string): string | null {
  try {
    return hasLS ? localStorage.getItem(k) : null;
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    if (hasLS) localStorage.setItem(k, v);
  } catch {
    /* memory only */
  }
}

export function storedLicense(): LicensePayload | null {
  if (mem.license) return mem.license;
  const raw = lsGet(LS_LICENSE);
  if (!raw) return null;
  try {
    mem.license = JSON.parse(raw) as LicensePayload;
    return mem.license;
  } catch {
    return null;
  }
}

export function rememberLicense(p: LicensePayload): void {
  mem.license = p;
  lsSet(LS_LICENSE, JSON.stringify(p));
}

export function trialStart(nowMs: number = Date.now()): string {
  if (mem.trialStart) return mem.trialStart;
  const stored = lsGet(LS_TRIAL);
  if (stored) {
    mem.trialStart = stored;
    return stored;
  }
  const fresh = new Date(nowMs).toISOString();
  mem.trialStart = fresh;
  lsSet(LS_TRIAL, fresh);
  return fresh;
}

/** Pure, probe-friendly edition resolution. */
export function computeEdition(nowMs: number, license: LicensePayload | null, trialStartedAt: string | null): Edition {
  if (license && (!license.expires || Date.parse(license.expires) >= nowMs)) return "pro";
  if (trialStartedAt) {
    const days = (nowMs - Date.parse(trialStartedAt)) / 86_400_000;
    if (days >= 0 && days < TRIAL_DAYS) return "trial";
  }
  return "personal";
}

export function currentEdition(nowMs: number = Date.now()): Edition {
  return computeEdition(nowMs, storedLicense(), hasLS || mem.trialStart ? trialStart(nowMs) : null);
}

export function proUnlocked(nowMs: number = Date.now()): boolean {
  const e = currentEdition(nowMs);
  return e === "pro" || e === "trial";
}

export function trialDaysLeft(nowMs: number = Date.now()): number {
  const started = mem.trialStart ?? lsGet(LS_TRIAL);
  if (!started) return TRIAL_DAYS;
  return Math.max(0, Math.ceil(TRIAL_DAYS - (nowMs - Date.parse(started)) / 86_400_000));
}
