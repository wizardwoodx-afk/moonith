/**
 * LobeHub Skills Marketplace client.
 *
 * Uses the marketplace's official CLI (@lobehub/market-cli) against
 * https://market.lobehub.com — the same protocol the marketplace documents
 * at https://lobehub.com/skills/skill.md. Credentials are registered once and
 * cached; search and install run through the CLI so we always speak the
 * marketplace's own protocol.
 *
 * Ported from Seamoon's `electron/backend/lobe.js`.
 */
import { exec } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BackendStore } from './store'

export const BASE_URL = 'https://market.lobehub.com'

const CLI = '@lobehub/market-cli'

export interface LobeCredentials {
  clientId: string
  clientSecret: string
  [key: string]: unknown
}

export interface LobeSkillSummary {
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
  source: 'lobehub'
}

export interface LobeSearchResult {
  items: LobeSkillSummary[]
  total: number
  categories: unknown[]
}

export interface LobeMcpSummary {
  id: string
  name: string
  description: string
  author: string
  installs: number
  source: 'lobehub-mcp'
}

export interface LobeMcpSearchResult {
  items: LobeMcpSummary[]
  total: number
}

export interface LobeResolvedSkill {
  id: string
  name: string
  description: string
}

export interface LobeInstalledSkill {
  id: string
  name: string
  description: string
  dir: string
}

export interface LobeInstallResult {
  ok: boolean
  id: string
  dir: string
  output: string
}

export interface LobeSearchOptions {
  q?: string
  category?: string
  page?: number
  pageSize?: number
  sort?: string
  order?: string
}

export interface LobeMcpSearchOptions {
  q?: string
  page?: number
  pageSize?: number
}

export interface LobeInstallOptions {
  id: string
  agent?: string
}

export interface LobeResolveOptions {
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

function toCredentials(value: unknown): LobeCredentials | null {
  if (!isRecord(value)) return null
  const clientId = value.clientId
  const clientSecret = value.clientSecret
  if (!clientId || !clientSecret) return null
  return { ...value, clientId: String(clientId), clientSecret: String(clientSecret) }
}

const quote = (s: string): string =>
  process.platform === 'win32'
    ? `"${String(s).replace(/"/g, '\\"')}"`
    : `'${String(s).replace(/'/g, "'\\''")}'`

function runCli(args: string[], { env = {}, cwd, timeout = 180000 }: RunCliOptions = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const cmd = ['npx', '-y', CLI, ...args].map(quote).join(' ')
    exec(
      cmd,
      {
        cwd,
        timeout,
        env: { ...process.env, MARKET_BASE_URL: BASE_URL, ...env },
        maxBuffer: 24 * 1024 * 1024,
        windowsHide: true
      },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(String(stderr || err.message).trim().slice(0, 400)))
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
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

export class LobeSkills {
  private readonly store: BackendStore
  private readonly workspace: string
  private cache: Map<string, { at: number; value: LobeSearchResult }> | null = null

  constructor(store: BackendStore, workspace: string) {
    this.store = store
    this.workspace = workspace
  }

  get skillsDir(): string {
    return join(this.workspace, '.agents', 'skills')
  }

  /** Cached marketplace credentials (registered once). */
  credentials(): LobeCredentials | null {
    const saved = this.store.settings.all().lobe
    const fromStore = toCredentials(saved)
    if (fromStore) return fromStore
    // the CLI persists its own credentials on disk
    try {
      const file = join(homedir(), '.lobehub-market', 'credentials.json')
      const json = JSON.parse(readFileSync(file, 'utf8')) as unknown
      return toCredentials(json)
    } catch {
      /* not registered yet */
    }
    return null
  }

  async register(): Promise<LobeCredentials> {
    await runCli([
      'register',
      '--base-url',
      BASE_URL,
      '--name',
      'Knight Cowork',
      '--source',
      'codex'
    ])
    const creds = this.credentials()
    if (!creds) throw new Error('Could not register with the LobeHub marketplace')
    this.store.settings.update('lobe', {
      baseUrl: BASE_URL,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      registeredAt: Date.now()
    })
    return creds
  }

  async ensureRegistered(): Promise<LobeCredentials> {
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
  }: LobeSearchOptions = {}): Promise<LobeSearchResult> {
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
      source: 'lobehub' as const
    }))
    const value: LobeSearchResult = {
      items,
      total: num(json.totalCount) || items.length,
      categories: Array.isArray(json.categories) ? json.categories : []
    }
    if (!this.cache) this.cache = new Map()
    this.cache.set(key, { at: Date.now(), value })
    return value
  }

  async install({ id, agent = 'codex' }: LobeInstallOptions): Promise<LobeInstallResult> {
    const creds = await this.ensureRegistered()
    const dir = this.skillsDir
    mkdirSync(dir, { recursive: true })
    const { stdout } = await runCli(
      ['skills', 'install', id, '--agent', agent, '--dir', dir],
      { env: { MARKET_CLIENT_ID: creds.clientId, MARKET_CLIENT_SECRET: creds.clientSecret } }
    )
    return { ok: true, id, dir, output: String(stdout).trim().slice(0, 600) }
  }

  /** The MCP plugin catalogue from the same marketplace. */
  async searchMcp({ q = '', page = 1, pageSize = 24 }: LobeMcpSearchOptions = {}): Promise<LobeMcpSearchResult> {
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
      source: 'lobehub-mcp' as const
    }))
    return { items, total: num(json.totalCount) || items.length }
  }

  /** Resolves a skill by its exact identifier, falling back to a title search. */
  async resolve({ id, name }: LobeResolveOptions): Promise<LobeResolvedSkill | null> {
    const label = name ?? ''
    try {
      const { stdout } = await runCli(['skills', 'view', id, '--output', 'json'], {
        env: {
          MARKET_CLIENT_ID: (await this.ensureRegistered()).clientId,
          MARKET_CLIENT_SECRET: (await this.ensureRegistered()).clientSecret
        }
      })
      const json = asRecord(parseJson(stdout))
      return {
        id: str(json.identifier) || id,
        name: str(json.name) || label,
        description: str(json.description)
      }
    } catch {
      const res = await this.search({ q: label || id, pageSize: 5 })
      const hit = res.items.find((i) => i.name === label) || res.items[0]
      return hit ? { id: hit.id, name: hit.name, description: hit.description } : null
    }
  }

  /** Skills already installed into the workspace. */
  installed(): LobeInstalledSkill[] {
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
    const target = join(this.skillsDir, id)
    if (!target.startsWith(this.skillsDir)) throw new Error('Invalid skill id')
    rmSync(target, { recursive: true, force: true })
    return { ok: true }
  }
}
