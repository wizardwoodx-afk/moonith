/**
 * ExternalAgent and SkillRegistry — SelfImpulse's integration with the ExternalAgent ecosystem.
 *
 * ExternalAgent (github.com/externalAgent/externalAgent) is an open-source, self-hosted agent
 * gateway; SkillRegistry (hub.selfimpulse.org) is its skill registry and package catalogue.
 * Both are real services, and this module talks to them directly:
 *
 *   SkillRegistry REST API   https://hub.selfimpulse.org/api/v1/{search,skills,packages}
 *   SkillRegistry CLI        npx -y selfimpulse-skills@latest {search,install,list,uninstall,update}
 *   ExternalAgent CLI       npx -y selfimpulse-agent@latest {agent,agents,channels,automations}
 *
 * Skills installed through either registry land in the same workspace folder
 * SelfImpulse's own skill manager reads, so they are usable by the agent at once.
 *
 * Ported from the earlier desktop shell.
 */
import { execFile, type ExecException } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { npxCommand } from './npx'
import { isSafeRef, scrubEnv } from './security'
import type { BackendStore } from './store'

export const SKILL_REGISTRY_API = 'https://hub.selfimpulse.org/api/v1'
export const SKILL_REGISTRY_SITE = 'https://hub.selfimpulse.org'
export const EXTERNAL_AGENT_SITE = 'https://selfimpulse.org'

const SKILL_REGISTRY_CLI = 'selfimpulse-skills@latest'
const EXTERNAL_AGENT_CLI = 'selfimpulse-agent@latest'

interface RunOptions {
  timeout?: number
  cwd?: string
}

interface RunResult {
  code: number | string
  stdout: string
  stderr: string
  error: ExecException | null
}

/** A search hit as the SkillRegistry registry returns it. */
interface SkillRegistrySearchPayload {
  id?: string
  canonicalUrl?: string
  displayName?: string
  name?: string
  summary?: string
  description?: string
  ownerHandle?: string
  downloads?: number
  featured?: unknown
  install?: { reference?: string }
  latestVersion?: { version?: string } | string
  stats?: { downloads?: number; installs?: number }
}

/** A skill entry as the SkillRegistry registry returns it. */
interface SkillRegistrySkillPayload {
  ownerHandle?: string
  slug?: string
  displayName?: string
  summary?: string
  updatedAt?: string
  latestVersion?: { version?: string }
  stats?: { downloads?: number }
}

/** A package entry as the SkillRegistry registry returns it. */
interface SkillRegistryPackagePayload {
  name?: string
  id?: string
  displayName?: string
  summary?: string
  description?: string
  family?: string
  channel?: string
  isOfficial?: unknown
  categories?: string[]
  latestVersion?: string
}

export interface SkillRegistrySearchItem {
  id: string | undefined
  ref: string | undefined
  name: string | undefined
  summary: string
  author: string
  downloads: number
  installs: number
  featured: boolean
  version: string
  url: string
}

export interface SkillRegistrySearchResult {
  total: number
  items: SkillRegistrySearchItem[]
}

export interface SkillRegistryExploreItem {
  id: string
  ref: string
  name: string | undefined
  summary: string
  author: string | undefined
  downloads: number
  version: string
  updated: string | undefined
}

export interface SkillRegistryExploreResult {
  cursor: string | null
  items: SkillRegistryExploreItem[]
}

export interface SkillRegistryPackageItem {
  id: string | undefined
  name: string | undefined
  summary: string
  family: string
  channel: string
  official: boolean
  categories: string[]
  version: string
}

export interface SkillRegistryPackagesResult {
  items: SkillRegistryPackageItem[]
}

export interface SkillRegistryInstallResult {
  ok: boolean
  ref: string
  output: string
  dir: string
}

export interface SkillRegistryListResult {
  raw: string
  entries: string[]
}

export interface SkillRegistryRemoveResult {
  ok: boolean
  ref: string
}

export interface SkillRegistryStatus {
  version: string
  site: string
}

export interface ExternalAgentAgentResult {
  ok: boolean
  output: string
  code: number | string
}

export interface ExternalAgentChannelsResult {
  ok: boolean
  output: string
}

export interface ExternalAgentStatus {
  version: string
  site: string
  gatewayReachable: boolean
  detail: string
  enterprise: {
    available: boolean
    note: string
    url: string
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function pickList<T>(json: unknown, keys: readonly string[]): T[] {
  const record = asRecord(json)
  for (const key of keys) {
    const value = record[key]
    if (value) return value as T[]
  }
  return []
}

function truthyString(value: unknown): string | undefined {
  return value ? String(value) : undefined
}

function latestVersionString(value: { version?: string } | string | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.version || ''
}

/**
 * Run the marketplace CLI with an argument array — never a shell string, so a
 * skill reference or agent prompt can never turn into a command. On Windows the
 * npx shim is resolved to its JS entrypoint instead of going through cmd.exe.
 */
function run(cli: string, args: string[], { timeout = 300000, cwd }: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let invocation: ReturnType<typeof npxCommand>
    try {
      // The CLI knows its own registry; overriding it with the API path breaks
      // its routes, so only the site is pinned. Credentials never leak to it.
      invocation = npxCommand(['-y', cli, ...args], scrubEnv({ SKILL_REGISTRY_SITE }))
    } catch (err) {
      resolve({
        code: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        error: null
      })
      return
    }
    execFile(
      invocation.command,
      invocation.args,
      {
        encoding: 'utf8',
        timeout,
        cwd,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        env: invocation.env
      },
      (err, stdout, stderr) => {
        resolve({ code: err ? err.code ?? 1 : 0, stdout: stdout || '', stderr: stderr || '', error: err })
      }
    )
  })
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 300) }
  }
  if (!res.ok) throw new Error(`SkillRegistry ${res.status}: ${JSON.stringify(json).slice(0, 200)}`)
  return json
}

export class SkillRegistry {
  readonly store: BackendStore
  readonly workspace: string

  constructor(store: BackendStore, workspace: string) {
    this.store = store
    this.workspace = workspace
  }

  get skillsDir(): string {
    return join(this.workspace, '.agents', 'skills')
  }

  /** The live registry search. */
  async search(query?: string, limit = 24): Promise<SkillRegistrySearchResult> {
    const url = new URL(`${SKILL_REGISTRY_API}/search`)
    if (query) url.searchParams.set('q', query)
    url.searchParams.set('limit', String(limit))
    const json = await getJson(url.toString())
    const results = pickList<SkillRegistrySearchPayload>(json, ['results', 'items'])
    return {
      total: results.length,
      items: results.map((r) => ({
        id: r.id || r.canonicalUrl || r.install?.reference,
        ref: r.install?.reference || r.canonicalUrl,
        name: r.displayName || r.name,
        summary: r.summary || r.description || '',
        author: (r.id || '').split(':')[1]?.split('/')[0] || r.ownerHandle || '',
        downloads: r.downloads ?? r.stats?.downloads ?? 0,
        installs: r.stats?.installs ?? 0,
        featured: Boolean(r.featured),
        version: latestVersionString(r.latestVersion),
        url: r.canonicalUrl ? `${SKILL_REGISTRY_SITE}${r.canonicalUrl}` : ''
      }))
    }
  }

  /** The live "latest updated" feed. */
  async explore(limit = 30): Promise<SkillRegistryExploreResult> {
    const url = new URL(`${SKILL_REGISTRY_API}/skills`)
    url.searchParams.set('limit', String(limit))
    const json = await getJson(url.toString())
    const items = pickList<SkillRegistrySkillPayload>(json, ['items'])
    const record = asRecord(json)
    return {
      cursor: truthyString(record.nextCursor) ?? null,
      items: items.map((i) => ({
        id: `${i.ownerHandle}/${i.slug}`,
        ref: `@${i.ownerHandle}/${i.slug}`,
        name: i.displayName || i.slug,
        summary: i.summary || '',
        author: i.ownerHandle,
        downloads: i.stats?.downloads || 0,
        version: i.latestVersion?.version || '',
        updated: i.updatedAt
      }))
    }
  }

  /** The ExternalAgent package catalogue. */
  async packages(limit = 40): Promise<SkillRegistryPackagesResult> {
    const url = new URL(`${SKILL_REGISTRY_API}/packages`)
    url.searchParams.set('limit', String(limit))
    const json = await getJson(url.toString())
    const items = pickList<SkillRegistryPackagePayload>(json, ['items'])
    return {
      items: items.map((p) => ({
        id: p.name || p.id,
        name: p.displayName || p.name,
        summary: p.summary || p.description || '',
        family: p.family || 'skill',
        channel: p.channel || 'community',
        official: Boolean(p.isOfficial),
        categories: p.categories || [],
        version: p.latestVersion || ''
      }))
    }
  }

  /** Installs a skill for real, through the official CLI. */
  async install(ref: string): Promise<SkillRegistryInstallResult> {
    if (!isSafeRef(ref)) throw new Error(`Invalid skill reference: ${ref}`)
    mkdirSync(this.skillsDir, { recursive: true })
    const res = await run(
      SKILL_REGISTRY_CLI,
      ['install', ref, '--workdir', this.workspace, '--dir', '.agents/skills', '--force', '--no-input'],
      { cwd: this.workspace }
    )
    const output = `${res.stdout}${res.stderr}`.trim()
    if (res.code !== 0) {
      throw new Error(output.split('\n').slice(-3).join(' ') || `skill install failed (${res.code})`)
    }
    return { ok: true, ref, output: output.slice(0, 800), dir: this.skillsDir }
  }

  /** The skills SkillRegistry has installed into this workspace. */
  async list(): Promise<SkillRegistryListResult> {
    const res = await run(
      SKILL_REGISTRY_CLI,
      ['list', '--workdir', this.workspace, '--dir', '.agents/skills', '--no-input'],
      { cwd: this.workspace }
    )
    const lines = `${res.stdout}`
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^selfimpulse-skills\s/i.test(l) && !/^(usage|commands|skills|packages)\b/i.test(l))
    return { raw: res.stdout.slice(0, 2000), entries: lines }
  }

  async remove(ref: string): Promise<SkillRegistryRemoveResult> {
    if (!isSafeRef(ref)) throw new Error(`Invalid skill reference: ${ref}`)
    const res = await run(
      SKILL_REGISTRY_CLI,
      ['uninstall', ref, '--workdir', this.workspace, '--dir', '.agents/skills', '--no-input'],
      { cwd: this.workspace }
    )
    if (res.code !== 0) throw new Error(`${res.stdout}${res.stderr}`.slice(0, 300))
    return { ok: true, ref }
  }

  async status(): Promise<SkillRegistryStatus> {
    const res = await run(SKILL_REGISTRY_CLI, ['--cli-version'])
    return { version: (res.stdout || '').trim(), site: SKILL_REGISTRY_SITE }
  }

  /**
   * Warms the CLI so the first real search is not the one that pays for the
   * process start and the registry handshake.
   */
  async warm(): Promise<boolean> {
    try {
      await run(SKILL_REGISTRY_CLI, ['--cli-version'], { timeout: 120000 })
      return true
    } catch {
      return false
    }
  }
}

export class ExternalAgent {
  readonly store: BackendStore
  readonly workspace: string

  constructor(store: BackendStore, workspace: string) {
    this.store = store
    this.workspace = workspace
  }

  async version(): Promise<string> {
    const res = await run(EXTERNAL_AGENT_CLI, ['--version'])
    return (res.stdout || res.stderr || '').trim().split('\n')[0]
  }

  /**
   * Runs one agent turn on a running ExternalAgent gateway. This is the real CLI
   * path; if no gateway is running the CLI's own error is surfaced verbatim.
   */
  async agent(prompt: string, { timeout = 300000 }: { timeout?: number } = {}): Promise<ExternalAgentAgentResult> {
    // the prompt is passed as an argument, never interpolated into a shell string
    const res = await run(EXTERNAL_AGENT_CLI, ['agent', '--prompt', String(prompt ?? ''), '--no-input'], { timeout })
    const output = `${res.stdout}${res.stderr}`.trim()
    return { ok: res.code === 0, output: output.slice(0, 4000), code: res.code }
  }

  /** The channels the gateway has connected, when it is running. */
  async channels(): Promise<ExternalAgentChannelsResult> {
    const res = await run(EXTERNAL_AGENT_CLI, ['channels', 'list', '--no-input'], { timeout: 120000 })
    return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim().slice(0, 2000) }
  }

  async status(): Promise<ExternalAgentStatus> {
    const version = await this.version().catch(() => '')
    const channels = await this.channels().catch(() => ({ ok: false, output: '' }))
    return {
      version,
      site: EXTERNAL_AGENT_SITE,
      gatewayReachable: channels.ok,
      detail: channels.output,
      enterprise: {
        available: false,
        note:
          'ExternalAgent Enterprise is a hosted platform. It publishes no public API, so SelfImpulse ' +
          'links to it and uses the open SkillRegistry registry and the ExternalAgent CLI instead.',
        url: `${EXTERNAL_AGENT_SITE}/blog/externalAgent-enterprise`
      }
    }
  }
}
