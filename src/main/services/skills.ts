import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import type {
  SkillDetail,
  SkillDraft,
  SkillMarketResult,
  SkillSource,
  SkillSummary
} from '@shared/types'
import { getPaths } from '../paths'
import { isWithin } from '../security'
import { slugify, truncate } from '../util'

const MARKET_API = 'https://clawhub.ai/api/v1'
const MARKET_SITE = 'https://clawhub.ai'
const MARKETPLACE_CLI = '@lobehub/market-cli'
const MARKETPLACE_SITE = 'https://lobehub.com/skills'
const MANIFEST = '.installed.json'
const SAFE_REF = /^@?[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/

interface InstalledEntry {
  id: string
  registry: SkillSource
}

export interface ParsedSkill {
  name: string
  description: string
  body: string
}

function firstHeading(markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? ''
}

function firstParagraph(markdown: string): string {
  const line = markdown
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith('#') && !value.startsWith('---'))
  return line?.replace(/^[-*]\s+/, '') ?? ''
}

export function parseSkillMarkdown(raw: string): ParsedSkill {
  const text = raw.replace(/^\uFEFF/, '')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const fields = new Map<string, string>()
  let body = text
  if (frontmatter) {
    body = text.slice(frontmatter[0].length)
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      fields.set(match[1].toLowerCase(), value)
    }
  }
  return {
    name: fields.get('name') || firstHeading(body) || 'Skill',
    description: fields.get('description') || firstParagraph(body),
    body: body.trim()
  }
}

async function walk(dir: string, depth = 0): Promise<Array<{ dir: string; file: string; files: number }>> {
  if (depth > 4) return []
  const out: Array<{ dir: string; file: string; files: number }> = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  let fileCount = entries.filter((entry) => entry.isFile()).length
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const nested = await walk(join(dir, entry.name), depth + 1)
      out.push(...nested)
      fileCount += nested.reduce((sum, item) => sum + item.files, 0)
    }
  }
  if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
    out.unshift({ dir, file: join(dir, 'SKILL.md'), files: fileCount })
  }
  return out
}

class SkillService {
  private marketplaceCache = new Map<string, { at: number; results: SkillMarketResult[] }>()

  private root(): string {
    return getPaths().skills
  }

  private async manifest(): Promise<InstalledEntry[]> {
    try {
      const raw = await fs.readFile(join(this.root(), MANIFEST), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      const entries: InstalledEntry[] = []
      for (const item of parsed) {
        if (typeof item === 'string') entries.push({ id: item, registry: 'registry' })
        else if (item && typeof item === 'object') {
          const value = item as { id?: unknown; registry?: unknown }
          if (typeof value.id !== 'string') continue
          entries.push({
            id: value.id,
            registry: value.registry === 'marketplace' ? 'marketplace' : 'registry'
          })
        }
      }
      return entries
    } catch {
      return []
    }
  }

  private async saveManifest(entries: InstalledEntry[]): Promise<void> {
    const unique = new Map<string, InstalledEntry>()
    for (const entry of entries) unique.set(entry.id, entry)
    await fs.writeFile(
      join(this.root(), MANIFEST),
      JSON.stringify([...unique.values()], null, 2),
      'utf8'
    )
  }

  async list(): Promise<SkillSummary[]> {
    const installed = new Map((await this.manifest()).map((entry) => [entry.id, entry.registry]))
    const found = await walk(this.root())
    const skills: SkillSummary[] = []
    for (const entry of found) {
      if (entry.dir === this.root()) continue
      try {
        const raw = await fs.readFile(entry.file, 'utf8')
        const parsed = parseSkillMarkdown(raw)
        const stat = await fs.stat(entry.file)
        const id = relative(this.root(), entry.dir).replace(/\\/g, '/')
        skills.push({
          id,
          name: parsed.name,
          description: parsed.description || '(no description)',
          source: installed.has(id) ? 'installed' : 'local',
          registry: installed.get(id),
          files: entry.files,
          updatedAt: stat.mtime.toISOString()
        })
      } catch {
        // A malformed bundle is skipped rather than shown as broken.
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name))
  }

  async promptIndex(): Promise<string> {
    const skills = await this.list()
    if (!skills.length) return ''
    return skills
      .slice(0, 40)
      .map((skill) => `- ${skill.id}: ${skill.name} — ${truncate(skill.description, 180)}`)
      .join('\n')
  }

  async read(id: string): Promise<SkillDetail | null> {
    const dir = this.resolve(id)
    try {
      const raw = await fs.readFile(join(dir, 'SKILL.md'), 'utf8')
      const parsed = parseSkillMarkdown(raw)
      const summary = (await this.list()).find((skill) => skill.id === id)
      return {
        id,
        name: parsed.name,
        description: parsed.description || '(no description)',
        source: summary?.source ?? 'local',
        files: summary?.files ?? 1,
        updatedAt: summary?.updatedAt,
        content: raw
      }
    } catch {
      return null
    }
  }

  async readForTool(id: string): Promise<string> {
    const detail = await this.read(id)
    if (!detail) return `No skill is installed with the id "${id}".`
    return truncate(`# ${detail.name}\n\n${detail.content}`, 24000)
  }

  async create(draft: SkillDraft): Promise<SkillSummary[]> {
    const name = draft.name.trim()
    const description = draft.description.trim().replace(/\s+/g, ' ')
    if (!name) throw new Error('Give the skill a name.')
    if (!description) throw new Error('Write one line describing when the skill should be used.')
    const id = slugify(name, 'skill')
    const dir = join(this.root(), id)
    try {
      await fs.mkdir(dir)
    } catch {
      throw new Error(`A skill folder named "${id}" already exists. Choose another name.`)
    }
    const content = `---\nname: ${name.replace(/[\r\n]/g, ' ')}\ndescription: ${description}\n---\n\n${draft.body.trim()}\n`
    await fs.writeFile(join(dir, 'SKILL.md'), content, 'utf8')
    const manifest = await this.manifest()
    await this.saveManifest(manifest.filter((entry) => entry.id !== id))
    return this.list()
  }

  async remove(id: string): Promise<SkillSummary[]> {
    const dir = this.resolve(id)
    if (dir === this.root()) throw new Error('That skill cannot be removed.')
    await fs.rm(dir, { recursive: true, force: true })
    const manifest = await this.manifest()
    await this.saveManifest(manifest.filter((entry) => entry.id !== id))
    return this.list()
  }

  async search(
    query: string,
    registry: SkillSource = 'registry'
  ): Promise<SkillMarketResult[]> {
    if (registry === 'marketplace') return this.searchMarketplace(query)
    const url = new URL(`${MARKET_API}/search`)
    if (query.trim()) url.searchParams.set('q', query.trim())
    url.searchParams.set('limit', '24')
    let response: Response
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      })
    } catch {
      throw new Error('Could not reach the skill registry. Check your network connection.')
    }
    if (!response.ok) throw new Error(`SkillSource returned ${response.status}.`)
    const json = (await response.json()) as {
      results?: Array<Record<string, unknown>>
      items?: Array<Record<string, unknown>>
    }
    const results = json.results ?? json.items ?? []
    return results.map((item) => {
      const install = item.install as { reference?: string } | undefined
      const latest = item.latestVersion as { version?: string } | string | undefined
      const stats = item.stats as { downloads?: number } | undefined
      const canonical = typeof item.canonicalUrl === 'string' ? item.canonicalUrl : ''
      return {
        ref: install?.reference || canonical || String(item.id ?? ''),
        name: String(item.displayName ?? item.name ?? item.id ?? 'Skill'),
        summary: String(item.summary ?? item.description ?? ''),
        author: String(item.ownerHandle ?? String(item.id ?? '').split(':')[1]?.split('/')[0] ?? ''),
        version: typeof latest === 'string' ? latest : latest?.version ?? '',
        downloads: stats?.downloads ?? 0,
        url: canonical ? `${MARKET_SITE}${canonical}` : MARKET_SITE,
        registry: 'registry'
      }
    })
  }

  private async searchMarketplace(query: string): Promise<SkillMarketResult[]> {
    const clean = query
      .trim()
      .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
    const cached = this.marketplaceCache.get(clean)
    if (cached && Date.now() - cached.at < 60_000) return cached.results

    const args = ['skills', 'search', '--page-size', '24', '--output', 'json']
    if (clean) args.push('--q', clean)
    const result = await this.runCli(MARKETPLACE_CLI, args)
    if (result.code !== 0) {
      throw new Error(this.cliMessage(result, 'Marketplace search failed'))
    }
    let json: { items?: Array<Record<string, unknown>> }
    try {
      json = JSON.parse(result.stdout) as { items?: Array<Record<string, unknown>> }
    } catch {
      throw new Error('Marketplace returned a response Knight could not read.')
    }
    const results = (json.items ?? []).map((item) => {
      const identifier = String(item.identifier ?? '')
      const github = item.github as { stars?: number } | undefined
      return {
        ref: identifier,
        name: String(item.name ?? identifier),
        summary: String(item.description ?? ''),
        author: String(item.author ?? ''),
        version: String(item.version ?? ''),
        downloads: Number(item.installCount ?? github?.stars ?? 0) || 0,
        url: identifier ? `${MARKETPLACE_SITE}/${encodeURIComponent(identifier)}` : MARKETPLACE_SITE,
        registry: 'marketplace' as const
      }
    })
    this.marketplaceCache.set(clean, { at: Date.now(), results })
    return results
  }

  async install(ref: string, registry: SkillSource = 'registry'): Promise<SkillSummary[]> {
    const clean = ref.trim()
    if (!clean || !SAFE_REF.test(clean) || clean.includes('..')) {
      throw new Error('That skill reference is not valid.')
    }
    const before = new Set((await this.list()).map((skill) => skill.id))
    const result =
      registry === 'marketplace'
        ? await this.runCli(MARKETPLACE_CLI, [
            'skills',
            'install',
            clean,
            '--dir',
            getPaths().skills,
            '--agent',
            'codex'
          ])
        : await this.runCli('clawhub@latest', [
            'install',
            clean,
            '--workdir',
            getPaths().root,
            '--dir',
            'skills',
            '--force',
            '--no-input'
          ])
    if (result.code !== 0) {
      const label = registry === 'marketplace' ? 'Marketplace' : 'Registry'
      throw new Error(this.cliMessage(result, `${label} install failed`))
    }
    const skills = await this.list()
    const installed = await this.manifest()
    const fresh = skills.filter((skill) => !before.has(skill.id)).map((skill) => skill.id)
    await this.saveManifest([
      ...installed,
      ...fresh.map((id) => ({ id, registry }))
    ])
    if (!fresh.length) {
      const label = registry === 'marketplace' ? 'Marketplace' : 'Registry'
      throw new Error(`${label} reported success but no SKILL.md bundle appeared in the library.`)
    }
    return this.list()
  }

  private cliMessage(
    result: { stdout: string; stderr: string; code: number },
    fallback: string
  ): string {
    return (
      `${result.stdout}\n${result.stderr}`
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-4)
        .join(' ') || `${fallback} (${result.code}).`
    )
  }

  private runCli(
    pkg: string,
    args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        'npx',
        ['-y', pkg, ...args],
        {
          encoding: 'utf8',
          timeout: 300000,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
          shell: process.platform === 'win32',
          cwd: getPaths().root
        },
        (error, stdout, stderr) => {
          const rawCode = (error as NodeJS.ErrnoException | null)?.code
          const code = typeof rawCode === 'number' ? rawCode : error ? 1 : 0
          resolve({ code, stdout: stdout || '', stderr: stderr || '' })
        }
      )
    })
  }

  private resolve(id: string): string {
    if (!id || id.includes('\0') || id.includes('..')) throw new Error('Invalid skill id.')
    const dir = join(this.root(), id)
    if (!isWithin(this.root(), dir)) throw new Error('Invalid skill id.')
    return dir
  }
}

export const skillService = new SkillService()
