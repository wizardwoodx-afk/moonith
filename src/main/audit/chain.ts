/**
 * The audit hash chain — pure, dependency-free (node:crypto only), and free
 * of any engine or Electron import so it can be tested in isolation.
 *
 * THE SCHEME. Every entry line carries `prev` — the hash of the line before
 * it — together with its own `hash`, computed over the canonical form of
 * `{ i, entry, prev }`. Editing, deleting, inserting or reordering any entry
 * therefore changes every hash from that point on, and verification fails at
 * the exact line where the chain first breaks. The trailer line then carries
 * an HMAC-SHA-256 over the final chain hash, keyed by a secret sealed in the
 * OS keychain: the chain alone would only be self-consistent (anyone could
 * rebuild it), while the HMAC makes the file unforgeable without the key.
 *
 * DETERMINISM. Canonical JSON sorts object keys recursively, timestamps come
 * from the recorded entries (never the clock), and string comparison is
 * plain `<`/`>` (never localeCompare), so the same entries always serialise
 * to identical bytes.
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { AuditEntry } from '@shared/audit'

const ZERO_HASH = '0'.repeat(64)

/* Domain separation for the key derivation: the seal key is derived from the
 * keychain secret rather than being the secret itself, so the stored secret
 * serves exactly one purpose even if this scheme ever changes. */
const KEY_SALT = 'selfimpulse-audit-v1'
const KEY_INFO = 'selfimpulse-audit-chain-seal'

export function deriveSealKey(secret: string): Buffer {
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
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
 * Builds the export: one canonical line per entry, chained, plus the signed
 * trailer. Returns the lines WITHOUT the trailing newline — joining with
 * '\n' and appending a final '\n' is the caller's file-format decision.
 */
export function buildAuditChain(entries: readonly AuditEntry[], sealKey: Buffer): string[] {
  const lines: string[] = []
  let prev = ZERO_HASH
  entries.forEach((entry, i) => {
    const hash = sha256hex(canonicalJson({ i, entry, prev }))
    lines.push(canonicalJson({ i, entry, prev, hash }))
    prev = hash
  })
  const trailer = { trailer: true, entries: entries.length, head: prev }
  const sig = createHmac('sha256', sealKey).update(canonicalJson(trailer)).digest('hex')
  lines.push(canonicalJson({ ...trailer, sig }))
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
 * Re-derives the chain from the file's own bytes and checks the seal. Every
 * failure names the line where the evidence first contradicts the chain, so
 * a single tampered entry is locatable rather than merely detectable.
 */
export function verifyAuditChain(lines: readonly string[], sealKey: Buffer): AuditChainReport {
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
  if (typeof entryCount !== 'number' || typeof head !== 'string' || !isHex64(sig)) {
    return { ok: false, line: lines.length, reason: 'the signature trailer is malformed' }
  }

  const dataCount = lines.length - 1
  let prev = ZERO_HASH
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
    if (sha256hex(canonicalJson(body)) !== hash) {
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
      reason: `the trailer records ${entryCount} entries but the file holds ${dataCount} — the export was truncated`
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
  const expected = createHmac('sha256', sealKey)
    .update(canonicalJson({ trailer: true, entries: entryCount, head }))
    .digest('hex')
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    return {
      ok: false,
      line: null,
      reason:
        'the signature does not verify — the file was not signed by this machine’s key, or it was altered after signing'
    }
  }

  return { ok: true, entries: dataCount }
}
