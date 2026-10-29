/**
 * ImpCodes: the coding-engine access that used to live only in the external
 * coding CLI. This module reads that access file (read-only), exposes a
 * sanitized summary for the UI, and imports providers plus tool servers into
 * the local provider registry — where the keys are sealed by the OS keychain
 * through `store.saveSettings`.
 *
 * Nothing here ever logs or returns a key, an env value, or a header. The
 * private config stays in memory for the duration of an import only.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { REA_PRESET_TOOLS } from '@shared/constants'
import type {
  ImpCodesAccess,
  ImpCodesAccessProvider,
  ImpCodesAccessServer,
  ImpCodesImportResult,
  McpServerConfig,
  McpTransport,
  ProviderInput,
  ProviderKind,
  ProviderPublic
} from '@shared/types'

/* ── shapes ──────────────────────────────────────────────────────────────── */

/** One provider as found in the access file. Carries the key for import only. */
export interface ImpCodesProviderConfig {
  key: string
  name: string
  npm?: string
  baseUrl: string
  apiKey?: string
  models: string[]
  /** The engine's interleaved-reasoning hint; carried, never surfaced as a secret. */
  interleaved?: boolean
}

/** One tool server as found in the access file. Env and headers are import-only. */
export interface ImpCodesServerConfig {
  name: string
  transport: McpTransport
  command: string
  args: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  enabled: boolean
}

export interface ImpCodesConfig {
  providers: ImpCodesProviderConfig[]
  servers: ImpCodesServerConfig[]
  defaultModel?: string
}

export interface ImpCodesScanOptions {
  configPath?: string
  env?: NodeJS.ProcessEnv
}

export interface ImpCodesServerMergeResult {
  servers: McpServerConfig[]
  imported: number
  updated: number
}

const MISSING_FILE =
  'No ImpCodes access file was found. Finish setup in ImpCodes, then refresh.'
const UNREADABLE_FILE = 'The ImpCodes access file could not be read.'
const INVALID_JSON = 'The ImpCodes access file is not valid JSON. Fix the syntax and try again.'
const EMPTY_FILE = 'The ImpCodes access file is empty.'

/** Env keys with any of these words are secrets and never leave the importer. */
const SECRET_ENV_KEY = /key|token|secret|password|auth/i

/* ── JSONC ───────────────────────────────────────────────────────────────── */

/**
 * Strip `//` and block comments outside strings. Escapes inside strings are
 * preserved verbatim, so a URL like "https://…" survives untouched.
 */
function stripComments(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 1
      out += ' '
      continue
    }
    out += char
  }
  return out
}

/** Drop commas directly before `}` or `]`, again without touching strings. */
function stripTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += char
  }
  return out
}

/* ── tolerant helpers ────────────────────────────────────────────────────── */

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/* ── parse ───────────────────────────────────────────────────────────────── */

/**
 * Parse an ImpCodes access file. Tolerant of JSONC comments and trailing
 * commas; throws a friendly, content-free Error on anything else.
 */
export function parseImpCodesConfig(text: string): ImpCodesConfig {
  if (typeof text !== 'string' || !text.trim()) throw new Error(EMPTY_FILE)

  let raw: unknown
  try {
    raw = JSON.parse(stripTrailingCommas(stripComments(text.replace(/^\uFEFF/, ''))))
  } catch {
    throw new Error(INVALID_JSON)
  }
  if (!isObject(raw)) throw new Error('The ImpCodes access file must contain a JSON object.')

  const providers: ImpCodesProviderConfig[] = []
  if (isObject(raw.provider)) {
    for (const [key, value] of Object.entries(raw.provider)) {
      if (!isObject(value)) continue
      const options = isObject(value.options) ? value.options : {}
      const npm = nonEmptyString(value.npm)
      const apiKey =
        nonEmptyString(options.apiKey) ??
        nonEmptyString(options.api_key) ??
        nonEmptyString(value.apiKey)
      const baseUrl =
        nonEmptyString(options.baseURL) ??
        nonEmptyString(options.baseUrl) ??
        nonEmptyString(value.baseUrl) ??
        ''
      providers.push({
        key,
        name: nonEmptyString(value.name) ?? key,
        ...(npm ? { npm } : {}),
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
        models: isObject(value.models) ? Object.keys(value.models) : [],
        ...(options.interleaved === true || value.interleaved === true
          ? { interleaved: true }
          : {})
      })
    }
  }

  const servers: ImpCodesServerConfig[] = []
  if (isObject(raw.mcp)) {
    for (const [name, value] of Object.entries(raw.mcp)) {
      if (!isObject(value)) continue
      const url = nonEmptyString(value.url)
      const type = nonEmptyString(value.type)?.toLowerCase()
      const hasCommand = typeof value.command === 'string' || Array.isArray(value.command)
      const isRemote = type === 'remote' || (Boolean(url) && !hasCommand)
      const env = stringRecord(value.environment) ?? stringRecord(value.env)
      const headers = stringRecord(value.headers)
      const enabled = value.enabled !== false

      if (isRemote) {
        servers.push({
          name,
          transport: 'http',
          command: '',
          args: [],
          ...(url ? { url } : {}),
          ...(env ? { env } : {}),
          ...(headers ? { headers } : {}),
          enabled
        })
        continue
      }

      const parts = stringArray(value.command)
      const command = typeof value.command === 'string' ? value.command : (parts[0] ?? '')
      const args =
        typeof value.command === 'string' ? stringArray(value.args) : parts.slice(1)
      servers.push({
        name,
        transport: 'stdio',
        command,
        args,
        ...(url ? { url } : {}),
        ...(env ? { env } : {}),
        ...(headers ? { headers } : {}),
        enabled
      })
    }
  }

  const defaultModel = nonEmptyString(raw.model)
  return { providers, servers, ...(defaultModel ? { defaultModel } : {}) }
}

/* ── config resolution / scan ────────────────────────────────────────────── */

/**
 * First explicit path wins, then OPENCODE_CONFIG, then XDG, then `~/.config`.
 * Explicit paths are returned even when missing so the caller reports *that*
 * file rather than silently falling back to another profile.
 */
export function resolveImpCodesConfigPath(options: ImpCodesScanOptions = {}): string | undefined {
  const env = options.env ?? process.env
  const explicit = nonEmptyString(options.configPath)
  if (explicit) return explicit
  const fromEnv = nonEmptyString(env.OPENCODE_CONFIG)
  if (fromEnv) return fromEnv

  const candidates: string[] = []
  const xdg = nonEmptyString(env.XDG_CONFIG_HOME)
  if (xdg) {
    candidates.push(join(xdg, 'opencode', 'opencode.jsonc'), join(xdg, 'opencode', 'opencode.json'))
  }
  const home = homedir()
  candidates.push(
    join(home, '.config', 'opencode', 'opencode.jsonc'),
    join(home, '.config', 'opencode', 'opencode.json')
  )
  return candidates.find((candidate) => existsSync(candidate))
}

function unavailable(error: string): ImpCodesAccess {
  return { available: false, providers: [], servers: [], error }
}

/** The safe, displayable view. No key, env value, or header crosses this line. */
export function toPublicAccess(config: ImpCodesConfig): ImpCodesAccess {
  const defaultModel = pickDefaultModel(config)
  const providers: ImpCodesAccessProvider[] = config.providers.map((provider) => ({
    name: provider.name,
    baseUrl: provider.baseUrl,
    models: [...provider.models],
    hasKey: Boolean(provider.apiKey)
  }))
  const servers: ImpCodesAccessServer[] = config.servers.map((server) => ({
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: [...server.args],
    ...(server.url ? { url: server.url } : {})
  }))
  return { available: true, providers, servers, ...(defaultModel ? { defaultModel } : {}) }
}

/** The model portion of `config.model`, when it names a discovered provider. */
function pickDefaultModel(config: ImpCodesConfig): string | undefined {
  const declared = config.defaultModel?.trim()
  if (declared) {
    const slash = declared.indexOf('/')
    if (slash > 0 && slash < declared.length - 1) {
      const providerKey = declared.slice(0, slash)
      if (config.providers.some((provider) => provider.key === providerKey)) {
        return declared.slice(slash + 1)
      }
    } else if (config.providers.some((provider) => provider.models.includes(declared))) {
      return declared
    }
  }
  for (const provider of config.providers) {
    if (provider.models.length > 0) return provider.models[0]
  }
  return undefined
}

interface LoadedAccess {
  config: ImpCodesConfig
}

interface FailedAccess {
  access: ImpCodesAccess
}

async function loadAccess(options: ImpCodesScanOptions): Promise<LoadedAccess | FailedAccess> {
  const path = resolveImpCodesConfigPath(options)
  if (!path) return { access: unavailable(MISSING_FILE) }

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
    return { access: unavailable(missing ? MISSING_FILE : UNREADABLE_FILE) }
  }

  try {
    return { config: parseImpCodesConfig(text) }
  } catch (error) {
    return {
      access: unavailable(error instanceof Error ? error.message : INVALID_JSON)
    }
  }
}

/**
 * Read the access file (never writing to it) and return only safe fields.
 * Missing or broken files come back as `available: false` with a plain error.
 */
export async function scanImpCodesAccess(
  options: ImpCodesScanOptions = {}
): Promise<ImpCodesAccess> {
  const loaded = await loadAccess(options)
  if ('access' in loaded) return loaded.access
  return toPublicAccess(loaded.config)
}

/* ── providers ───────────────────────────────────────────────────────────── */

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\/+$/, '')
}

function isImpCodesName(name: string, preferredName: string): boolean {
  return name === preferredName || name.startsWith(`${preferredName} ·`)
}

function providerKind(provider: ImpCodesProviderConfig): ProviderKind {
  const npm = (provider.npm ?? '').toLowerCase()
  const key = provider.key.toLowerCase()
  const baseUrl = provider.baseUrl.toLowerCase()
  if (npm.includes('anthropic') || key.includes('anthropic') || baseUrl.includes('anthropic')) {
    return 'anthropic'
  }
  const openAiSdk = npm === '@ai-sdk/openai' || npm.startsWith('@ai-sdk/openai@')
  const openAiHost =
    baseUrl === '' || /^https?:\/\/api\.openai\.com(?::\d+)?(\/|$)/i.test(baseUrl)
  return openAiSdk && openAiHost ? 'openai' : 'compatible'
}

/**
 * Turn discovered providers into registry inputs. Ids are reused only when an
 * existing provider is an ImpCodes provider with the same base URL, so a
 * re-import updates in place instead of duplicating.
 */
export function buildImportedProviders(
  config: ImpCodesConfig,
  existing: ProviderPublic[],
  preferredName = 'ImpCodes'
): ProviderInput[] {
  const claimed = new Set<string>()
  return config.providers.map((provider, index) => {
    const match = existing.find(
      (candidate) =>
        isImpCodesName(candidate.name, preferredName) &&
        normalizeBaseUrl(candidate.baseUrl) === normalizeBaseUrl(provider.baseUrl) &&
        !claimed.has(candidate.id)
    )
    if (match) claimed.add(match.id)
    const models =
      provider.models.length > 0 ? [...provider.models] : match ? [...match.models] : []
    return {
      ...(match ? { id: match.id } : {}),
      name: index === 0 ? preferredName : `${preferredName} · ${provider.name}`,
      kind: providerKind(provider),
      baseUrl: provider.baseUrl || undefined,
      models,
      enabled: true,
      /* Carried so `store.saveSettings` seals it; never stored by this module. */
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {})
    }
  })
}

/* ── servers ─────────────────────────────────────────────────────────────── */

function slugServerName(name: string): string {
  const slug = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'server'
}

function uniqueServerId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * A local command signature with a leading `cmd.exe /d /c` (or `cmd /c`)
 * wrapper removed, so the same launcher compares equal across shells.
 */
function commandSignature(command: string, args: string[]): string {
  const parts = [command, ...args].filter((part) => part !== '')
  const head = (parts[0] ?? '').toLowerCase()
  let start = 0
  if (head === 'cmd' || head === 'cmd.exe') {
    start = 1
    while (start < parts.length && parts[start].startsWith('/')) start += 1
  }
  return parts
    .slice(start)
    .map((part) => part.toLowerCase())
    .join('\u0000')
}

function hasReaArgs(args: string[]): boolean {
  return args.some((arg) => arg.includes('rea-agents'))
}

function serversMatch(existing: McpServerConfig, incoming: ImpCodesServerConfig): boolean {
  if (incoming.url) {
    return existing.url ? normalizeUrl(existing.url) === normalizeUrl(incoming.url) : false
  }
  if (
    commandSignature(existing.command, existing.args) ===
    commandSignature(incoming.command, incoming.args)
  ) {
    return true
  }
  /* The rea preset is commonly registered twice by different tools (sometimes
   * behind a cmd.exe wrapper), and its args can differ in version. When both
   * sides name rea-agents, they are the same server. */
  return hasReaArgs(existing.args) && hasReaArgs(incoming.args)
}

/** Env values are kept only when the name does not look like a secret. */
export function filterSafeEnv(env: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    if (SECRET_ENV_KEY.test(key)) continue
    out[key] = value
  }
  return out
}

function cloneServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    args: [...server.args],
    ...(server.env ? { env: { ...server.env } } : {}),
    ...(server.headers ? { headers: { ...server.headers } } : {})
  }
}

function mergeServer(existing: McpServerConfig, incoming: ImpCodesServerConfig): McpServerConfig {
  const env = { ...(existing.env ?? {}), ...filterSafeEnv(incoming.env) }
  const rea = hasReaArgs(existing.args) || hasReaArgs(incoming.args)
  return {
    ...existing,
    transport: existing.transport ?? incoming.transport,
    url: existing.url ?? incoming.url,
    ...(Object.keys(env).length > 0 ? { env } : {}),
    /* A bare rea registration exposes every tool and overflows a long-context
     * model on the first turn; the curated preset list keeps it usable. */
    ...(rea && !existing.toolAllowlist?.length
      ? { toolAllowlist: [...REA_PRESET_TOOLS] }
      : {}),
    args: [...existing.args]
  }
}

function createServer(id: string, incoming: ImpCodesServerConfig): McpServerConfig {
  const env = filterSafeEnv(incoming.env)
  return {
    id,
    name: incoming.name,
    transport: incoming.transport,
    command: incoming.command,
    args: [...incoming.args],
    ...(incoming.url ? { url: incoming.url } : {}),
    /* Headers are deliberately not imported: they would be persisted in
     * plaintext, outside the OS keychain. */
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(hasReaArgs(incoming.args) ? { toolAllowlist: [...REA_PRESET_TOOLS] } : {}),
    enabled: incoming.enabled !== false,
    source: 'manual'
  }
}

/**
 * Fold discovered servers into the configured list. Matching servers are
 * updated in place (id, name, command, args, preset and allowlist survive);
 * everything else is added under a stable `impcodes-<slug>` id.
 */
export function mergeImportedServers(
  config: ImpCodesConfig,
  existing: McpServerConfig[]
): ImpCodesServerMergeResult {
  const servers = existing.map(cloneServer)
  const used = new Set(servers.map((server) => server.id))
  let imported = 0
  let updated = 0

  for (const incoming of config.servers) {
    const index = servers.findIndex((server) => serversMatch(server, incoming))
    if (index >= 0) {
      servers[index] = mergeServer(servers[index], incoming)
      updated += 1
      continue
    }
    const id = uniqueServerId(`impcodes-${slugServerName(incoming.name)}`, used)
    used.add(id)
    servers.push(createServer(id, incoming))
    imported += 1
  }

  return { servers, imported, updated }
}

/** Convenience view for tests and callers that only need the merged list. */
export function buildImportedServers(
  config: ImpCodesConfig,
  existing: McpServerConfig[]
): McpServerConfig[] {
  return mergeImportedServers(config, existing).servers
}

/* ── import ──────────────────────────────────────────────────────────────── */

function toExistingInput(provider: ProviderPublic): ProviderInput {
  /* No apiKey: mergeProvider keeps the already-sealed secret untouched. */
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    models: [...provider.models],
    enabled: provider.enabled
  }
}

/**
 * Import the access file into the local registry in one patch. Idempotent:
 * matching providers and servers are updated in place, never duplicated.
 */
export async function importImpCodesAccess(): Promise<ImpCodesImportResult> {
  /* Loaded lazily so parsing and builder tests never boot Electron's store. */
  const { store } = await import('../store')

  const before = store.getPublicSettings()
  const loaded = await loadAccess({})
  if ('access' in loaded) {
    throw new Error(loaded.access.error ?? MISSING_FILE)
  }
  const config = loaded.config
  const access = toPublicAccess(config)

  const importedProviders = buildImportedProviders(config, before.providers)
  const importedIds = new Set(
    importedProviders
      .map((provider) => provider.id)
      .filter((id): id is string => typeof id === 'string')
  )
  const providers: ProviderInput[] = [
    ...before.providers.filter((provider) => !importedIds.has(provider.id)).map(toExistingInput),
    ...importedProviders
  ]

  const serverMerge = mergeImportedServers(config, before.mcpServers)
  await store.saveSettings({ providers, mcpServers: serverMerge.servers })

  let providerId: string | undefined
  let providerName: string | undefined
  let models: string[] = []
  let becameDefault = false

  const first = importedProviders[0]
  if (first) {
    const after = store.getPublicSettings()
    const saved = first.id
      ? after.providers.find((provider) => provider.id === first.id)
      : after.providers.find(
          (provider) =>
            provider.name === first.name &&
            normalizeBaseUrl(provider.baseUrl) === normalizeBaseUrl(first.baseUrl)
        )
    providerId = saved?.id
    providerName = saved?.name ?? first.name
    models = saved ? [...saved.models] : [...first.models]

    if (!before.defaultProviderId && saved) {
      await store.saveSettings({
        defaultProviderId: saved.id,
        defaultModel: saved.models[0]
      })
      becameDefault = true
    }
  }

  return {
    access,
    providerCount: importedProviders.length,
    serverCount: serverMerge.imported + serverMerge.updated,
    ...(providerId ? { providerId } : {}),
    ...(providerName ? { providerName } : {}),
    models,
    becameDefault
  }
}

/** The IPC read path: scan only, never import. */
export function getImpCodesAccess(): Promise<ImpCodesAccess> {
  return scanImpCodesAccess()
}
