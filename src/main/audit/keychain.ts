/**
 * The audit signing key, held the way this app holds every other secret
 * (see sealSecret/openSecret in store.ts): a random secret sealed with
 * Electron's safeStorage and persisted under userData.
 *
 * SETTINGS AND AUDIT BOTH FAIL CLOSED WHEN THE KEYCHAIN IS UNAVAILABLE.
 * The additional audit rule is that a log must never be produced unsigned:
 * when the key cannot be opened we refuse rather than emit a file whose
 * signature would prove nothing.
 */
import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../paths'
import { deriveSealKey } from './chain'
import { atomicWriteFile } from '../atomic'

const SEAL_KEY_FILE = 'audit-seal-key.json'

/* One in-flight load per process: two exports racing on first run must not
 * each mint a key and leave the earlier export unverifiable. */
let cached: Promise<Buffer> | null = null

function seal(secret: string): string {
  return `enc:${safeStorage.encryptString(secret).toString('base64')}`
}

function open(sealed: unknown): string | undefined {
  if (typeof sealed !== 'string' || !sealed.startsWith('enc:')) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(sealed.slice(4), 'base64'))
  } catch {
    return undefined
  }
}

export function loadAuditSigningKey(): Promise<Buffer> {
  if (!cached) cached = readOrCreate()
  return cached
}

async function readOrCreate(): Promise<Buffer> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'The operating system keychain is unavailable, so the audit log cannot be signed. ' +
        'Sign in to a desktop session with a keychain (or enable one) and try again — ' +
        'an unsigned audit log would prove nothing.'
    )
  }
  const file = join(getPaths().root, SEAL_KEY_FILE)
  let raw: string | null = null
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`The audit signing key cannot be read: ${(error as Error).message}`)
    }
  }
  if (raw !== null) {
    let encoded: unknown
    try {
      encoded = (JSON.parse(raw) as { secret?: unknown }).secret
    } catch (error) {
      throw new Error(`The audit signing key is corrupt; refusing to replace it: ${(error as Error).message}`)
    }
    const stored = open(encoded)
    if (!stored) {
      throw new Error('The audit signing key is invalid or cannot be decrypted; refusing to replace it.')
    }
    return deriveSealKey(stored)
  }

  const secret = randomBytes(32).toString('hex')
  await atomicWriteFile(file, JSON.stringify({ secret: seal(secret) }), { mode: 0o600 })
  return deriveSealKey(secret)
}
