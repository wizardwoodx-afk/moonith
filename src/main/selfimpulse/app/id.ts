/**
 * VH ID — 19.5.3 final-freeze.
 *
 * Ids ride the security-sensitive mission plane, so they come from a CSPRNG:
 * crypto.randomUUID() when present, crypto.getRandomValues() otherwise — each
 * id carries 122 bits of cryptographic randomness, so collisions are not a
 * planning concern. If an environment has no Web Crypto at all, the fallback
 * is a labelled deterministic counter — never a non-cryptographic RNG.
 */
let degradedSeq = 0;

function cryptoToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  degradedSeq += 1;
  return `nocrypto-fallback-${degradedSeq.toString(36)}`;
}

export function uid(prefix: string): string {
  return `${prefix}-${cryptoToken()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function fmtRemaining(ms: number): string {
  return `T-${fmtDuration(ms)}`;
}

export function fmtUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function clamp(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, n));
}
