/**
 * The audit signing key, held the way this app holds every other secret
 * (see sealSecret/openSecret in store.ts): a random secret sealed with
 * Electron's safeStorage and persisted under userData.
 *
 * THE ONE DIFFERENCE FROM store.ts IS DELIBERATE. Settings secrets fall back
 * to plaintext when the OS keychain is unavailable; an audit log must never
 * be produced unsigned, so there is no fallback here — when the keychain
 * cannot be used we refuse and say so, rather than emit a file whose
 * signature would prove nothing.
 */
import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../paths'
import { deriveSealKey } from './chain'

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
  const stored = await fs
    .readFile(file, 'utf8')
    .then((text) => open((JSON.parse(text) as { secret?: unknown }).secret))
    .catch(() => undefined)
  if (stored) return deriveSealKey(stored)

  const secret = randomBytes(32).toString('hex')
  await fs.writeFile(file, JSON.stringify({ secret: seal(secret) }), 'utf8')
  return deriveSealKey(secret)
}
