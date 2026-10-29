/**
 * The audit hash chain — pure, dependency-free (node:crypto plus the audit
 * identity type), and free of any engine or Electron import so it can be
 * tested in isolation.
 *
 * THE SCHEME. Every entry line carries `prev` — the hash of the line before
 * it — together with its own `hash`, computed over the canonical form of
 * `{ i, entry, prev }`. Editing, deleting, inserting or reordering any entry
 * therefore changes every hash from that point on, and verification fails at
 * the exact line where the chain first breaks. The trailer line then carries
 * an Ed25519 signature over the final chain hash, made with the private seed
 * sealed in the OS keychain (see `identity.ts`).
 *
 * WHY THE SIGNATURE IS ASYMMETRIC. A hash chain alone is only self-consistent
 * — anyone can rebuild one around tampered entries. The old design closed that
 * gap with an HMAC keyed by the same secret used to sign, which meant
 * verifying evidence required handing over the signing key (and left no way to
 * tell forger from auditor). Ed25519 makes the file unforgeable without the
 * seed while leaving verification to the public key alone.
 *
 * DETERMINISM. Canonical JSON sorts object keys recursively, timestamps come
 * from the recorded entries (never the clock), and string comparison is
 * plain `<`/`>` (never localeCompare), so the same entries always serialise
 * to identical bytes.
 */
import { createHash, hkdfSync } from 'node:crypto'
import type { AuditEntry } from '@shared/audit'
import { AUDIT_SIGNATURE_HEX, type AuditIdentity } from './identity'

/** The chain root: the `prev` of the very first line. */
export const AUDIT_ZERO_HASH = '0'.repeat(64)

/* Domain separation for the key derivation: the signing seed is derived from
 * the keychain secret rather than being the secret itself, so the stored
 * secret serves exactly one purpose even if this scheme ever changes. */
const KEY_SALT = 'selfimpulse-audit-v1'
const KEY_INFO = 'selfimpulse-audit-ed25519-seed'

/**
 * The 32-byte Ed25519 seed for a profile's sealed audit secret. HKDF keeps the
 * seed one-way-derived, so the keychain secret is never key material as stored.
 */
export function deriveSigningSeed(secret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), KEY_SALT, KEY_INFO, 32)
  )
}

/** Deterministic canonical form: object keys sorted RECURSIVELY, so key
 *  insertion order and map iteration order cannot change the bytes. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export function canonicalAuditJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isSignature(value: unknown): value is string {
  return typeof value === 'string' && AUDIT_SIGNATURE_HEX.test(value)
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * One chained line: `hash` over the canonical `{ i, entry, prev }`, plus the
 * canonical serialisation of `{ i, entry, prev, hash }` — the bytes a signature
 * is later made over. Shared by the export builder and the live ledger so the
 * two can never drift apart.
 */
export function createChainedAuditLine(
  entry: AuditEntry,
  i: number,
  prev: string
): { line: string; hash: string; unsigned: Record<string, unknown> } {
  const body = { i, entry, prev }
  const hash = sha256hex(canonicalAuditJson(body))
  const unsigned = { ...body, hash }
  return { line: canonicalAuditJson(unsigned), hash, unsigned }
}

/** Sign any canonicalisable audit payload (a line body, a trailer, an anchor). */
export function signAuditPayload(value: unknown, identity: AuditIdentity): string {
  return identity.sign(canonicalAuditJson(value))
}

/** Verify it with the public key alone — no secret needed, and never throws. */
export function verifyAuditPayload(
  value: unknown,
  signature: unknown,
  identity: AuditIdentity
): boolean {
  if (typeof signature !== 'string') return false
  return identity.verify(canonicalAuditJson(value), signature)
}

/**
 * Builds the export: one canonical line per entry, chained, plus the signed
 * trailer. Returns the lines WITHOUT the trailing newline — joining with
 * '\n' and appending a final '\n' is the caller's file-format decision.
 */
export function buildAuditChain(
  entries: readonly AuditEntry[],
  identity: AuditIdentity
): string[] {
  const lines: string[] = []
  let prev = AUDIT_ZERO_HASH
  entries.forEach((entry, i) => {
    const chained = createChainedAuditLine(entry, i, prev)
    lines.push(chained.line)
    prev = chained.hash
  })
  const trailer = { trailer: true, entries: entries.length, head: prev }
  lines.push(canonicalAuditJson({ ...trailer, sig: signAuditPayload(trailer, identity) }))
  return lines
}

export interface AuditChainReport {
  ok: boolean
  entries?: number
  /** 1-based line number of the first problem, or null when the failure is
   *  not attributable to a single line (signature, head mismatch). */
  line?: number | null
  reason?: string
}

/**
 * Re-derives the chain from the file's own bytes and checks the signature.
 * Every failure names the line where the evidence first contradicts the chain,
 * so a single tampered entry is locatable rather than merely detectable.
 */
export function verifyAuditChain(
  lines: readonly string[],
  identity: AuditIdentity
): AuditChainReport {
  if (lines.length === 0) {
    return { ok: false, line: null, reason: 'the file is empty' }
  }

  const last = parseLine(lines[lines.length - 1])
  if (!last || last.trailer !== true) {
    return {
      ok: false,
      line: lines.length,
      reason:
        'the signature trailer is missing — the file was truncated, or it is not a SelfImpulse audit export'
    }
  }
  const entryCount = last.entries
  const head = last.head
  const sig = last.sig
  if (typeof entryCount !== 'number' || !isHex64(head) || !isSignature(sig)) {
    return { ok: false, line: lines.length, reason: 'the signature trailer is malformed' }
  }

  const dataCount = lines.length - 1
  let prev = AUDIT_ZERO_HASH
  for (let index = 0; index < dataCount; index += 1) {
    const lineNumber = index + 1
    const parsed = parseLine(lines[index])
    if (!parsed) {
      return { ok: false, line: lineNumber, reason: `line ${lineNumber} is not valid JSON` }
    }
    const { hash, ...body } = parsed
    if (!isHex64(hash)) {
      return { ok: false, line: lineNumber, reason: `line ${lineNumber} carries no chain hash` }
    }
    if (parsed.prev !== prev) {
      return {
        ok: false,
        line: lineNumber,
        reason: `the chain breaks at line ${lineNumber} — an entry was deleted, inserted or reordered`
      }
    }
    if (sha256hex(canonicalAuditJson(body)) !== hash) {
      return {
        ok: false,
        line: lineNumber,
        reason: `line ${lineNumber} was modified after the export was signed`
      }
    }
    prev = hash
  }

  if (entryCount !== dataCount) {
    return {
      ok: false,
      line: lines.length,
      reason:
        dataCount < entryCount
          ? `the trailer records ${entryCount} entries but the file holds ${dataCount} — the export was truncated`
          : `the trailer records ${entryCount} entries but the file holds ${dataCount} — entries were added after the export was signed`
    }
  }
  if (head !== prev) {
    return {
      ok: false,
      line: null,
      reason: 'the final chain hash does not match the trailer — an entry was inserted, deleted or reordered'
    }
  }

  /* Signed over the same trailer shape buildAuditChain signed. */
  if (!verifyAuditPayload({ trailer: true, entries: entryCount, head }, sig, identity)) {
    return {
      ok: false,
      line: null,
      reason:
        'the signature does not verify — the file was not signed by this machine’s key, or it was altered after signing'
    }
  }

  return { ok: true, entries: dataCount }
}
