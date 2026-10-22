/**
 * HOST BOUNDARY — the Electron main-process implementation of the SelfImpulse
 * engine's host boundary.
 *
 * The engine was written for a renderer: every native fact (storage, secrets,
 * notifications, app identity, provider calls) went through `window.*`. In
 * SelfImpulse the engine runs in the MAIN process, so this module is the one
 * place that answers those questions with Electron APIs. The vendored modules
 * (`app/desktop.ts`, `ipc/localDb.ts`, `persist/quotaSafe.ts`,
 * `selfimpulse/ipc/client.ts`) delegate here; no engine file talks to
 * `window` when this host is the one running.
 *
 * Honesty rules kept from the engine: a refused write is reported as refused,
 * a missing provider is a sentence and not an empty string, and nothing is
 * silently downgraded to plaintext unless the OS keychain is unavailable — in
 * which case the receipt says `location: "plain-file"` and names the file.
 */
import { app, Notification, safeStorage } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/* ── where the engine's durable state lives ──────────────────────────────── */

/**
 * `<userData>/selfimpulse`. Resolved lazily: `app.getPath` throws before the
 * app is ready, and the engine imports modules (and builds its tool table)
 * before that point in some boots.
 */
export function selfImpulseDir(): string {
  try {
    return join(app.getPath('userData'), 'selfimpulse')
  } catch {
    return join(process.cwd(), '.selfimpulse')
  }
}

function storeFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(selfImpulseDir(), 'store', `${safe}.json`)
}

/** One file per engine key: the engine's large JSON stores stay readable on disk. */
export const nodeStorage = {
  getItem(key: string): string | null {
    try {
      return readFileSync(storeFile(key), 'utf8')
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    const file = storeFile(key)
    mkdirSync(join(selfImpulseDir(), 'store'), { recursive: true })
    writeFileSync(file, value, 'utf8')
  },
  removeItem(key: string): void {
    rmSync(storeFile(key), { force: true })
  }
}

/* ── secrets: OS keychain first, a named file only when encryption is absent ── */

interface SecretRow {
  enc?: string
  plain?: string
}

function secretsFile(): string {
  return join(selfImpulseDir(), 'secrets.json')
}

function readSecrets(): Record<string, SecretRow> {
  try {
    return JSON.parse(readFileSync(secretsFile(), 'utf8')) as Record<string, SecretRow>
  } catch {
    return {}
  }
}

function writeSecrets(data: Record<string, SecretRow>): void {
  mkdirSync(selfImpulseDir(), { recursive: true })
  writeFileSync(secretsFile(), JSON.stringify(data, null, 2), 'utf8')
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function knightSecretSet(ref: string, value: string) {
  if (!value) {
    knightSecretDelete(ref)
    return { stored: false, location: 'absent' as const, survivesRestart: false, warning: 'an empty value removes the credential; nothing was stored.' }
  }
  const data = readSecrets()
  const encrypted = canEncrypt()
  data[ref] = encrypted
    ? { enc: safeStorage.encryptString(value).toString('base64') }
    : { plain: value }
  writeSecrets(data)
  return {
    stored: true,
    location: encrypted ? ('keychain' as const) : ('absent' as const),
    survivesRestart: true,
    warning: encrypted
      ? undefined
      : `the OS credential store is unavailable, so the credential was written to ${secretsFile()} — readable by this user account.`
  }
}

export function knightSecretGet(ref: string): string | null {
  const row = readSecrets()[ref]
  if (!row) return null
  if (row.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(row.enc, 'base64'))
    } catch {
      return null
    }
  }
  return row.plain ?? null
}

export function knightSecretDelete(ref: string) {
  const data = readSecrets()
  if (!(ref in data)) return { removed: false }
  delete data[ref]
  writeSecrets(data)
  return { removed: true }
}

export function knightSecretExists(refs: string[]) {
  const data = readSecrets()
  const encrypted = canEncrypt()
  return Object.fromEntries(
    refs.map((ref) => [
      ref,
      data[ref]
        ? {
            exists: true,
            location: encrypted || data[ref].enc ? ('keychain' as const) : ('absent' as const),
            survivesRestart: true
          }
        : { exists: false, location: 'absent' as const, survivesRestart: false }
    ])
  )
}

/* ── filesystem + process: what the engine's mission core actually uses ────── */

export function knightFsRead(path: string) {
  try {
    const buf = readFileSync(path)
    return { ok: true, path, content: buf.toString('utf8'), bytesRead: buf.length }
  } catch (e) {
    return { ok: false, path, content: '', bytesRead: 0, reason: String((e as Error)?.message ?? e) }
  }
}

export function knightFsList(path: string) {
  try {
    const entries = readdirSync(path, { withFileTypes: true }).map((d) => ({
      name: d.name,
      path: join(path, d.name),
      dir: d.isDirectory()
    }))
    return { ok: true, path, entries }
  } catch (e) {
    return { ok: false, path, entries: [], reason: String((e as Error)?.message ?? e) }
  }
}

export function knightFsWrite(path: string, content: string) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
    return { ok: true, path, bytesWritten: Buffer.byteLength(content) }
  } catch (e) {
    return { ok: false, path, bytesWritten: 0, reason: String((e as Error)?.message ?? e) }
  }
}

export function knightFsMkdir(path: string) {
  try {
    mkdirSync(path, { recursive: true })
    return { ok: true, path }
  } catch (e) {
    return { ok: false, path, reason: String((e as Error)?.message ?? e) }
  }
}

export function knightFsRemove(path: string, recursive: boolean) {
  try {
    rmSync(path, { recursive, force: false })
    return { ok: true, path }
  } catch (e) {
    return { ok: false, path, reason: String((e as Error)?.message ?? e) }
  }
}

export function knightExists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/* ── the engine workspace: real files, on this machine ────────────────────── */

let workspaceOverride: string | null = null

/** The facade points this at `<userData>/selfimpulse/workspace` before tools run. */
export function setEngineWorkspace(dir: string): void {
  workspaceOverride = dir
}

export function engineWorkspace(): string {
  return workspaceOverride ?? join(selfImpulseDir(), 'workspace')
}

/* One segment, no traversal, no Windows-reserved punctuation. A file the engine
 * cannot name plainly is refused by name rather than silently rewritten: the
 * caller asked for something specific, so it must hear that it did not happen. */
const PLAIN_FILE_NAME = /^[^<>:"/\\|?*\u0000-\u001f]+$/

function workspaceFile(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 200) return null
  if (trimmed === '.' || trimmed === '..') return null
  if (!PLAIN_FILE_NAME.test(trimmed)) return null
  return join(engineWorkspace(), trimmed)
}

function charsIn(file: string, fallback: number): number {
  try {
    return readFileSync(file, 'utf8').length
  } catch {
    return fallback
  }
}

export function engineWorkspaceList(): Array<{ name: string; chars: number; updated: string }> {
  const dir = engineWorkspace()
  try {
    mkdirSync(dir, { recursive: true })
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = join(dir, entry.name)
        const stat = statSync(file)
        return { name: entry.name, chars: charsIn(file, stat.size), updated: stat.mtime.toISOString() }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** `null` when the file is absent or the name is not a plain file name. */
export function engineWorkspaceStat(name: string): { chars: number } | null {
  const file = workspaceFile(name)
  if (!file) return null
  try {
    const stat = statSync(file)
    if (!stat.isFile()) return null
    return { chars: charsIn(file, stat.size) }
  } catch {
    return null
  }
}

export function engineWorkspaceRead(name: string): string | null {
  const file = workspaceFile(name)
  if (!file) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function engineWorkspaceWrite(
  name: string,
  content: string
): { ok: true; name: string; chars: number } | { ok: false; reason: string } {
  const trimmed = name.trim()
  const file = workspaceFile(trimmed)
  if (!file) {
    return {
      ok: false,
      reason: `"${trimmed || name}" is not a plain file name — nothing was written`
    }
  }
  try {
    mkdirSync(engineWorkspace(), { recursive: true })
    writeFileSync(file, content, 'utf8')
    return { ok: true, name: trimmed, chars: content.length }
  } catch (error) {
    return { ok: false, reason: (error as Error)?.message ?? String(error) }
  }
}

export function knightShellExec(program: string, args: string[], cwd?: string, timeoutSecs?: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    execFile(
      program,
      args,
      {
        cwd: cwd || undefined,
        timeout: Math.max(1, timeoutSecs ?? 120) * 1000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const code = error ? Number((error as { code?: unknown }).code) : 0
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: Number.isFinite(code) ? code : 1
        })
      }
    )
  })
}

/* ── build facts + the human-gate notification ───────────────────────────── */

export function knightAppInfo() {
  return {
    name: app.getName() || 'SelfImpulse',
    version: app.getVersion() || 'unknown',
    platform: process.platform,
    native: true
  }
}

export function knightNotify(title: string, body: string) {
  try {
    if (!Notification.isSupported()) {
      return { sent: false, supported: false, reason: 'this operating system exposes no notification service' }
    }
    new Notification({ title, body }).show()
    return { sent: true, supported: true }
  } catch (e) {
    return { sent: false, supported: false, reason: String((e as Error)?.message ?? e) }
  }
}

/* ── the model call: SelfImpulse's provider is the one that spends the key ─────── */

export interface KnightChatRequest {
  provider: string
  base_url?: string
  model: string
  messages: Array<{ role: string; content: string }>
  system?: string
  max_tokens?: number
  temperature?: number
  secret_ref: string
}

export interface KnightChatResponse {
  content: string
  model: string
  usage: { input_tokens: number; output_tokens: number }
  duration_ms: number
}

type ChatImpl = (req: KnightChatRequest) => Promise<KnightChatResponse>

let chatImpl: ChatImpl | null = null

/**
 * The wiring layer injects the provider here once, at boot. The engine never
 * reaches into SelfImpulse's settings itself — that keeps one owner for the key and
 * one place where failover happens.
 */
export function setKnightChat(fn: ChatImpl | null): void {
  chatImpl = fn
}

export async function knightChat(req: KnightChatRequest): Promise<KnightChatResponse> {
  if (!chatImpl) {
    throw new Error(
      'no model provider is wired to the SelfImpulse engine yet — the run refused instead of answering with nothing.'
    )
  }
  return chatImpl(req)
}
