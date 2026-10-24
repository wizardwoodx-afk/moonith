import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { atomicWriteFileSync } from '../atomic'

/**
 * Backend security.
 *
 *  - Secrets at rest require the OS keychain; plaintext fallback is disabled.
 *  - The local gateway requires a bearer token and rejects rebound hosts.
 *  - The "ask" permission actually asks: the renderer is prompted and a denial
 *    is the default when nobody answers.
 *
 * Ported from the earlier desktop shell.
 */

export const SECRET_KEYS = ['apiKey', 'connectorsApiKey', 'connectorsToken', 'subscriptionToken']

interface StoredSecret {
  enc?: string
  plain?: string
}

export class SecretStore {
  readonly file: string
  private cache: Record<string, StoredSecret> | null = null

  constructor(file: string) {
    this.file = file
  }

  read(): Record<string, StoredSecret> {
    if (this.cache) return this.cache
    if (!existsSync(this.file)) {
      this.cache = {}
      return this.cache
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (error) {
      throw new Error(`Credential storage is unreadable or corrupt at ${this.file}; refusing to replace it. ${(error as Error).message}`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Credential storage is invalid at ${this.file}; refusing to replace it.`)
    }
    this.cache = parsed as Record<string, StoredSecret>
    return this.cache
  }

  write(data: Record<string, StoredSecret>): void {
    mkdirSync(dirname(this.file), { recursive: true })
    atomicWriteFileSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 })
    this.cache = data
  }

  /** Empty values remove a secret. Non-empty values require OS encryption. */
  put(key: string, value: string): boolean {
    if (!value) {
      this.remove(key)
      return false
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The operating system credential store is unavailable; the credential was not written.')
    }
    const data = this.read()
    data[key] = { enc: safeStorage.encryptString(value).toString('base64') }
    this.write(data)
    return true
  }

  get(key: string): string {
    const entry = this.read()[key]
    if (!entry) return ''
    if (!entry.enc || entry.plain !== undefined) {
      throw new Error(`Credential "${key}" is plaintext or invalid; re-enter it to migrate to OS encryption.`)
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The operating system credential store is unavailable; encrypted credentials cannot be opened.')
    }
    try {
      return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'))
    } catch (error) {
      throw new Error(`Credential "${key}" cannot be decrypted; it was not returned. ${(error as Error).message}`)
    }
  }

  remove(key: string): void {
    const data = this.read()
    delete data[key]
    this.write(data)
  }

  has(key: string): boolean {
    return Boolean(this.read()[key])
  }
}

/**
 * The gateway's bearer token. Generated once per install, stored encrypted, and
 * required on every request — otherwise any process on the machine could drive
 * the agent (which can write files and run commands).
 */
export class GatewayToken {
  private readonly secrets: SecretStore
  private value = ''

  constructor(secrets: SecretStore) {
    this.secrets = secrets
  }

  ensure(): string {
    if (this.value) return this.value
    let token = this.secrets.get('gatewayToken')
    if (!token) {
      token = randomBytes(32).toString('base64url')
      this.secrets.put('gatewayToken', token)
    }
    this.value = token
    return token
  }
}

/** A tiny fixed-window rate limiter, per client address. */
export class RateLimiter {
  private readonly windowMs: number
  private readonly max: number
  private readonly hits = new Map<string, { start: number; count: number }>()

  constructor(options: { windowMs?: number; max?: number } = {}) {
    this.windowMs = options.windowMs ?? 60_000
    this.max = options.max ?? 120
  }

  check(key: string): boolean {
    const now = Date.now()
    const entry = this.hits.get(key)
    if (!entry || now > entry.start + this.windowMs) {
      this.hits.set(key, { start: now, count: 1 })
      return true
    }
    entry.count += 1
    if (this.hits.size > 500) this.hits.clear()
    return entry.count <= this.max
  }
}

export interface PermissionRequest {
  name?: string
  description?: string
  args?: unknown
  [key: string]: unknown
}

export interface PermissionAnswer {
  allowed: boolean
  reason: string
}

/**
 * The "ask" permission broker. The tool waits for the user to answer; if
 * nobody answers within the timeout the action is refused.
 */
export class PermissionBroker {
  private readonly emit: (event: string, payload: unknown) => void
  private readonly timeoutMs: number
  private readonly pending = new Map<string, (answer: PermissionAnswer) => void>()

  constructor(options: { emit?: (event: string, payload: unknown) => void; timeoutMs?: number } = {}) {
    this.emit = options.emit ?? (() => {})
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  ask(request: PermissionRequest): Promise<PermissionAnswer> {
    const id = `perm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ allowed: false, reason: 'No answer — refused by default.' })
      }, this.timeoutMs)
      this.pending.set(id, (answer) => {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve({ allowed: Boolean(answer?.allowed), reason: answer?.reason || '' })
      })
      this.emit('permission:request', { id, ...request })
    })
  }

  answer(id: string, allowed: boolean, reason = ''): { ok: boolean } {
    const resolver = this.pending.get(id)
    if (!resolver) return { ok: false }
    resolver({ allowed, reason })
    return { ok: true }
  }
}

/** Reject anything that is not a plain, safe identifier (skill slugs, refs…). */
const SAFE_REF = /^[A-Za-z0-9@._\-/:]{1,160}$/

export function isSafeRef(ref: unknown): boolean {
  return typeof ref === 'string' && SAFE_REF.test(ref) && !ref.includes('..')
}

const ENV_DROP =
  /^(OPENAI|GEMINI|MISTRAL|COHERE|CEREBRAS|GROQ|SAMBA|NVIDIA|DEEPSEEK|GROK|GITHUB|ANTHROPIC|NEXT_PUBLIC).*(KEY|TOKEN|SECRET)|^OPENAI_API_KEY$|^OPENAI_BASE_URL$|^OPENAI_MODEL$/i

/** Strip credentials from an environment before handing it to a child process. */
export function scrubEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_DROP.test(key)) continue
    env[key] = value
  }
  return { ...env, ...extra }
}

export function secretFileExists(file: string): boolean {
  return existsSync(file)
}
