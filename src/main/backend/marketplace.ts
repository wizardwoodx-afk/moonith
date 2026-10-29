/**
 * Marketplace Skills Marketplace client.
 *
 * Uses the marketplace's official CLI (@lobehub/market-cli) against
 * https://market.lobehub.com — the same protocol the marketplace documents
 * at https://lobehub.com/skills/skill.md. Credentials are registered once and
 * cached; search and install run through the CLI so we always speak the
 * marketplace's own protocol.
 *
 * Ported from the earlier desktop shell.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runNpx } from './npx'
import { resolveSafePath } from '../security'
import type { BackendStore } from './store'

export const BASE_URL = 'https://market.lobehub.com'

const CLI = '@lobehub/market-cli'

export interface MarketplaceCredentials {
  clientId: string
  clientSecret: string
  [key: string]: unknown
}

export interface MarketplaceSkillSummary {
  id: string
  name: string
  description: string
  author: string
  category: string
  version: string
  installs: number
  ratingCount: number
  featured: boolean
  validated: boolean
  tags: string[]
  stars: number
  source: 'marketplacehub'
}

export interface MarketplaceSearchResult {
  items: MarketplaceSkillSummary[]
  total: number
  categories: unknown[]
}

export interface MarketplaceMcpSummary {
  id: string
  name: string
  description: string
  author: string
  installs: number
  source: 'marketplacehub-mcp'
}

export interface MarketplaceMcpSearchResult {
  items: MarketplaceMcpSummary[]
  total: number
}

export interface MarketplaceResolvedSkill {
  id: string
  name: string
  description: string
}

export interface MarketplaceInstalledSkill {
  id: string
  name: string
  description: string
  dir: string
}

export interface MarketplaceInstallResult {
  ok: boolean
  id: string
  dir: string
  output: string
}

export interface MarketplaceSearchOptions {
  q?: string
  category?: string
  page?: number
  pageSize?: number
  sort?: string
  order?: string
}

export interface MarketplaceMcpSearchOptions {
  q?: string
  page?: number
  pageSize?: number
}

export interface MarketplaceInstallOptions {
  id: string
  agent?: string
}

export interface MarketplaceResolveOptions {
  id: string
  name?: string
}

interface RunCliOptions {
  env?: Record<string, string>
  cwd?: string
  timeout?: number
}

interface CliResult {
  stdout: string
  stderr: string
}

interface MarketplaceItem {
  identifier?: string
  name?: string
  description?: string
  author?: string
  category?: string
  version?: string
  installCount?: number
  ratingCount?: number
  isFeatured?: boolean
  isValidated?: boolean
  tags?: string[]
  github?: { stars?: number }
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toCredentials(value: unknown): MarketplaceCredentials | null {
  if (!isRecord(value)) return null
  const clientId = value.clientId
  const clientSecret = value.clientSecret
  if (!clientId || !clientSecret) return null
  return { ...value, clientId: String(clientId), clientSecret: String(clientSecret) }
}

export interface MarketplaceSecretVault {
  get(key: string): string
  put(key: string, value: string): boolean
}

export function assertMarketplaceReference(value: string): string {
  const ref = String(value ?? '').trim()
  if (
    !ref ||
    ref.length > 160 ||
    ref.startsWith('-') ||
    ref.includes('\\') ||
    ref.includes('\0') ||
    ref.includes('..') ||
    !/^@?[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)
  ) {
    throw new Error('Invalid marketplace skill reference.')
  }
  return ref
}

export function assertInstalledSkillId(value: string): string {
  const id = String(value ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) || id === '.' || id === '..') {
    throw new Error('Invalid installed skill id.')
  }
  return id
}

async function runCli(args: string[], { env = {}, cwd, timeout = 180000 }: RunCliOptions = {}): Promise<CliResult> {
  const result = await runNpx(CLI, args, {
    cwd,
    timeout,
    env: { MARKET_BASE_URL: BASE_URL, ...env },
    maxBuffer: 24 * 1024 * 1024
  })
  if (result.error && !result.stdout) {
    throw new Error(String(result.stderr || result.error.message).trim().slice(0, 400))
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

function parseJson(text: string): unknown {
  const start = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const from = start === -1 ? arrayStart : arrayStart === -1 ? start : Math.min(start, arrayStart)
  if (from === -1) throw new Error('Unexpected marketplace response')
  try {
    return JSON.parse(text.slice(from)) as unknown
  } catch {
    // the CLI may print extra lines; try the last JSON block
    const last = text.lastIndexOf('}')
    const first = text.indexOf('{')
    if (first !== -1 && last > first) return JSON.parse(text.slice(first, last + 1)) as unknown
    throw new Error('Could not parse the marketplace response')
  }
}

export class Marketplace {
  private readonly store: BackendStore
  private readonly workspace: string
  private readonly secrets: MarketplaceSecretVault | null
  private cache: Map<string, { at: number; value: MarketplaceSearchResult }> | null = null

  constructor(store: BackendStore, workspace: string, secrets?: MarketplaceSecretVault) {
    this.store = store
    this.workspace = workspace
    this.secrets = secrets ?? null
  }

  get skillsDir(): string {
    return join(this.workspace, '.agents', 'skills')
  }

  /** Read only the OS-vaulted credential pair during normal operation. */
  credentials(): MarketplaceCredentials | null {
    if (!this.secrets) return null
    const saved = this.store.settings.all().marketplace
    const clientId = this.secrets.get('marketplaceClientId') || str(saved?.clientId)
    const clientSecret = this.secrets.get('marketplaceClientSecret')
    return clientId && clientSecret ? { clientId, clientSecret } : null
  }

  private readCliCredentials(): MarketplaceCredentials | null {
    // The compatibility CLI owns this legacy file. It is read only during an
    // explicit registration/migration, never used as the app's secret store.
    try {
      const file = join(homedir(), '.marketplacehub-market', 'credentials.json')
      return toCredentials(JSON.parse(readFileSync(file, 'utf8')) as unknown)
    } catch {
      return null
    }
  }

  /** Migrate the old JSON credential layout without retaining plaintext. */
  migrateLegacyCredentials(): void {
    const saved = this.store.settings.all().marketplace
    const legacy = toCredentials(saved)
    if (!legacy) return
    if (!this.secrets) throw new Error('Marketplace credentials require the operating system credential store.')
    this.secrets.put('marketplaceClientId', legacy.clientId)
    this.secrets.put('marketplaceClientSecret', legacy.clientSecret)
    const { clientSecret: _clientSecret, ...publicRecord } = saved
    this.store.settings.set('marketplace', publicRecord)
  }

  async register(): Promise<MarketplaceCredentials> {
    if (!this.secrets) throw new Error('Marketplace registration requires the operating system credential store.')
    await runCli([
      'register',
      '--base-url',
      BASE_URL,
      '--name',
      'SelfImpulse',
      '--source',
      'codex'
    ])
    const creds = this.readCliCredentials()
    if (!creds) throw new Error('Could not register with the Marketplace marketplace')
    this.secrets.put('marketplaceClientId', creds.clientId)
    this.secrets.put('marketplaceClientSecret', creds.clientSecret)
    this.store.settings.set('marketplace', {
      baseUrl: BASE_URL,
      clientId: creds.clientId,
      registeredAt: Date.now()
    })
    return creds
  }

  async ensureRegistered(): Promise<MarketplaceCredentials> {
    const creds = this.credentials()
    if (creds) return creds
    return this.register()
  }

  async search({
    q = '',
    category = '',
    page = 1,
    pageSize = 24,
    sort = 'createdAt',
    order = 'desc'
  }: MarketplaceSearchOptions = {}): Promise<MarketplaceSearchResult> {
    const key = `${q}|${category}|${page}|${pageSize}|${sort}|${order}`
    const cached = this.cache?.get(key)
    if (cached && Date.now() - cached.at < 60000) return cached.value

    const creds = await this.ensureRegistered()
    const args = [
      'skills',
      'search',
      '--page',
      String(page),
      '--page-size',
      String(Math.min(100, pageSize)),
      '--output',
      'json'
    ]
    if (q) args.push('--q', q)
    if (category) args.push('--category', category)
    if (sort) args.push('--sort', sort)
    if (order) args.push('--order', order)

    const { stdout } = await runCli(args, {
      env: { MARKET_CLIENT_ID: creds.clientId, MARKET_CLIENT_SECRET: creds.clientSecret }
    })
    const json = asRecord(parseJson(stdout))
    const rawItems = (Array.isArray(json.items) ? json.items : []) as MarketplaceItem[]
    const items = rawItems.map((i) => ({
      id: str(i.identifier),
      name: str(i.name),
      description: str(i.description),
      author: str(i.author),
      category: str(i.category),
      version: str(i.version),
      installs: num(i.installCount),
      ratingCount: num(i.ratingCount),
      featured: Boolean(i.isFeatured),
      validated: Boolean(i.isValidated),
      tags: Array.isArray(i.tags) ? i.tags.map((tag) => str(tag)) : [],
      stars: num(isRecord(i.github) ? i.github.stars : 0),
      source: 'marketplacehub' as const
    }))
    const value: MarketplaceSearchResult = {
      items,
      total: num(json.totalCount) || items.length,
      categories: Array.isArray(json.categories) ? json.categories : []
    }
    if (!this.cache) this.cache = new Map()
    this.cache.set(key, { at: Date.now(), value })
    return value
  }

  async install({ id, agent = 'codex' }: MarketplaceInstallOptions): Promise<MarketplaceInstallResult> {
    const ref = assertMarketplaceReference(id)
    if (!/^[a-z][a-z0-9_-]{0,30}$/i.test(agent)) throw new Error('Invalid marketplace agent target.')
    const creds = await this.ensureRegistered()
    const dir = this.skillsDir
    mkdirSync(dir, { recursive: true })
    const { stdout } = await runCli(
      ['skills', 'install', ref, '--agent', agent, '--dir', dir],
      { env: { MARKET_CLIENT_ID: creds.clientId, MARKET_CLIENT_SECRET: creds.clientSecret } }
    )
    return { ok: true, id: ref, dir, output: String(stdout).trim().slice(0, 600) }
  }

  /** The MCP plugin catalogue from the same marketplace. */
  async searchMcp({ q = '', page = 1, pageSize = 24 }: MarketplaceMcpSearchOptions = {}): Promise<MarketplaceMcpSearchResult> {
    const creds = await this.ensureRegistered()
    const args = [
      'mcp',
      'search',
      '--page',
      String(page),
      '--page-size',
      String(Math.min(100, pageSize)),
      '--output',
      'json'
    ]
    if (q) args.push('--q', q)
    const { stdout } = await runCli(args, {
      env: { MARKET_CLIENT_ID: creds.clientId, MARKET_CLIENT_SECRET: creds.clientSecret }
    })
    const json = asRecord(parseJson(stdout))
    const rawItems = (Array.isArray(json.items) ? json.items : []) as MarketplaceItem[]
    const items = rawItems.map((i) => ({
      id: str(i.identifier),
      name: str(i.name),
      description: str(i.description),
      author: str(i.author),
      installs: num(i.installCount),
      source: 'marketplacehub-mcp' as const
    }))
    return { items, total: num(json.totalCount) || items.length }
  }

  /** Resolves a skill by its exact identifier, falling back to a title search. */
  async resolve({ id, name }: MarketplaceResolveOptions): Promise<MarketplaceResolvedSkill | null> {
    const ref = assertMarketplaceReference(id)
    const label = name ?? ''
    try {
      const { stdout } = await runCli(['skills', 'view', ref, '--output', 'json'], {
        env: {
          MARKET_CLIENT_ID: (await this.ensureRegistered()).clientId,
          MARKET_CLIENT_SECRET: (await this.ensureRegistered()).clientSecret
        }
      })
      const json = asRecord(parseJson(stdout))
      return {
        id: str(json.identifier) || ref,
        name: str(json.name) || label,
        description: str(json.description)
      }
    } catch {
      const res = await this.search({ q: label || ref, pageSize: 5 })
      const hit = res.items.find((i) => i.name === label) || res.items[0]
      return hit ? { id: hit.id, name: hit.name, description: hit.description } : null
    }
  }

  /** Skills already installed into the workspace. */
  installed(): MarketplaceInstalledSkill[] {
    const dir = this.skillsDir
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const file = join(dir, e.name, 'SKILL.md')
        let name = e.name
        let description = ''
        try {
          const md = readFileSync(file, 'utf8')
          name = /^name:\s*(.+)$/m.exec(md)?.[1]?.trim() || e.name
          description = /^description:\s*(.+)$/m.exec(md)?.[1]?.trim() || ''
        } catch {
          /* the bundle may not carry a SKILL.md */
        }
        return { id: e.name, name, description, dir: join(dir, e.name) }
      })
  }

  /** The SKILL.md text of the installed skills, injected into the agent's context. */
  context(): string {
    const out: string[] = []
    for (const s of this.installed()) {
      try {
        const md = readFileSync(join(s.dir, 'SKILL.md'), 'utf8')
        out.push(`### ${s.name}\n${md.slice(0, 4000)}`)
      } catch {
        /* skip */
      }
    }
    return out.join('\n\n')
  }

  async remove({ id }: { id: string }): Promise<{ ok: boolean }> {
    const skillId = assertInstalledSkillId(id)
    const target = await resolveSafePath([this.skillsDir], join(this.skillsDir, skillId), { mode: 'write' })
    rmSync(target, { recursive: true, force: true })
    return { ok: true }
  }
}
