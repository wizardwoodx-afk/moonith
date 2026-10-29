/**
 * The audit signing key, held the way this app holds every other secret
 * (see sealSecret/openSecret in store.ts): a random secret sealed with
 * Electron's safeStorage and persisted under userData, from which the Ed25519
 * signing seed is derived (chain.ts `deriveSigningSeed`).
 *
 * SETTINGS AND AUDIT BOTH FAIL CLOSED WHEN THE KEYCHAIN IS UNAVAILABLE.
 * The audit log must never be produced unsigned, so there is no plaintext
 * fallback here — when the key cannot be opened we refuse and say so, rather
 * than emit a file whose signature would prove nothing.
 *
 * AND IT NEVER ROTATES SILENTLY. A stored key that cannot be decrypted is
 * evidence of a keychain problem, not an invitation to mint a replacement: a
 * second key would leave every line already signed under the first one
 * unverifiable, which is worse than no new line at all, because the file would
 * still look like an intact trail. So an unreadable/undecryptable stored key
 * throws and names itself, and only a genuinely absent key file is created.
 */
import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../paths'
import { deriveSigningSeed } from './chain'
import { auditIdentityFromSeed, type AuditIdentity } from './identity'
import { writeAuditFileDurably } from './durableWrite'

const SEAL_KEY_FILE = 'audit-seal-key.json'

/* The shape of Electron's safeStorage that this module actually uses. Typed
 * loosely because a headless (non-Electron) process resolves `electron` to a
 * path string and leaves this undefined — and an absent keychain is exactly
 * the case the refusal messages are written for. */
interface KeychainStorage {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

const storage = safeStorage as unknown as KeychainStorage | undefined

function keychainUsable(): boolean {
  try {
    return storage?.isEncryptionAvailable() === true
  } catch {
    return false
  }
}

/* One in-flight load per process: two exports racing on first run must not
 * each mint a key and leave the earlier export unverifiable. A rejected load
 * is dropped from the cache so a later attempt can succeed once the keychain
 * comes back — nothing was minted, so no evidence can be stranded by retrying. */
let cached: Promise<AuditIdentity> | null = null

function seal(secret: string): string {
  if (!storage) throw new Error('the operating system keychain is unavailable')
  return `enc:${storage.encryptString(secret).toString('base64')}`
}

function open(sealed: unknown): string | undefined {
  if (typeof sealed !== 'string' || !sealed.startsWith('enc:')) return undefined
  try {
    return storage?.decryptString(Buffer.from(sealed.slice(4), 'base64'))
  } catch {
    return undefined
  }
}

/** The production entry point — the profile root is `getPaths().root`. */
export function loadAuditSigningKey(): Promise<AuditIdentity> {
  if (!cached) {
    cached = readOrCreateFrom(getPaths().root).catch((error) => {
      cached = null
      throw error
    })
  }
  return cached
}

/** The testable seam: the same load-or-create against an explicit profile root. */
export async function loadAuditSigningKeyFrom(profileRoot: string): Promise<AuditIdentity> {
  return readOrCreateFrom(profileRoot)
}

async function readOrCreateFrom(profileRoot: string): Promise<AuditIdentity> {
  const file = join(profileRoot, SEAL_KEY_FILE)
  let raw: string | null = null
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code && code !== 'ENOENT') {
      throw new Error(
        `The existing audit signing key at ${file} could not be read: ${(error as Error).message}. ` +
          'Refusing to mint a replacement, because every line already signed under it would become unverifiable.'
      )
    }
  }

  if (raw !== null) {
    /* A stored key file exists. Nothing below may create a new key. */
    let encoded: unknown
    try {
      encoded = (JSON.parse(raw) as { secret?: unknown }).secret
    } catch (error) {
      throw new Error(
        `The existing audit signing key at ${file} is corrupt and could not be parsed ` +
          `(${(error as Error).message}); refusing to mint a new key so prior signed evidence stays verifiable.`
      )
    }
    const stored = open(encoded)
    if (!stored) {
      throw new Error(
        `The existing audit signing key at ${file} could not be decrypted; refusing to mint a new key ` +
          'so prior signed evidence stays verifiable. Restore the OS keychain that sealed it (or recover ' +
          'the profile holding it) and try again — an audit log signed under a second key would prove nothing.'
      )
    }
    return auditIdentityFromSeed(deriveSigningSeed(stored))
  }

  if (!keychainUsable()) {
    throw new Error(
      'The operating system keychain is unavailable, so the audit log cannot be signed. ' +
        'Sign in to a desktop session with a keychain (or enable one) and try again — ' +
        'an unsigned audit log would prove nothing.'
    )
  }

  const secret = randomBytes(32).toString('hex')
  /* Owner-only, fsynced, and renamed into place: a half-written key file is a
   * lost key, and a world-readable one is a leaked signing secret. */
  await writeAuditFileDurably(file, JSON.stringify({ secret: seal(secret) }), { mode: 0o600 })
  return auditIdentityFromSeed(deriveSigningSeed(secret))
}
