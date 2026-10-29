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
import { impulseSkillRegistry } from '../selfimpulse/skills/lobeRegistry'
import { npxCommand } from '../backend/npx'
import { getPaths } from '../paths'
import { isWithin } from '../security'
import { slugify, truncate } from '../util'

const MARKETPLACE_CLI = '@lobehub/market-cli'
const MARKETPLACE_SITE = 'https://lobehub.com/skills'
const MANIFEST = '.installed.json'
const SAFE_REF = /^@?[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/
const CATALOG_UNREACHABLE = 'The catalog could not be reached. Check the connection and try again.'
const INSTALL_FAILED = 'The skill could not be installed. Check the connection and try again.'

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
  private catalogCache = new Map<string, { at: number; results: SkillMarketResult[] }>()

  private root(): string {
    return getPaths().skills
  }

  private manifestPath(): string {
    return join(this.root(), MANIFEST)
  }

  private async manifest(): Promise<InstalledEntry[]> {
    try {
      const raw = await fs.readFile(this.manifestPath(), 'utf8')
      const json = JSON.parse(raw)
      return Array.isArray(json)
        ? json.filter(
            (item): item is InstalledEntry =>
              Boolean(item) && typeof item.id === 'string' && typeof item.registry === 'string'
          )
        : []
    } catch {
      return []
    }
  }

  private async saveManifest(entries: InstalledEntry[]): Promise<void> {
    await fs.mkdir(this.root(), { recursive: true })
    await fs.writeFile(this.manifestPath(), JSON.stringify(entries, null, 2), 'utf8')
  }

  async list(): Promise<SkillSummary[]> {
    const root = this.root()
    await fs.mkdir(root, { recursive: true })
    const installedList = await this.manifest()
    const installed = new Map(installedList.map((entry) => [entry.id, entry.registry]))
    const entries = await walk(root)
    const skills: SkillSummary[] = []
    const seenIds = new Set<string>()

    for (const entry of entries) {
      try {
        const id = relative(root, entry.dir).replace(/\\/g, '/')
        if (!id || id.startsWith('.')) continue
        const raw = await fs.readFile(entry.file, 'utf8')
        const stat = await fs.stat(entry.file)
        const parsed = parseSkillMarkdown(raw)
        seenIds.add(id)
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

    // Incorporate built-in Impulse Skill Hub skills
    for (const impulseSkill of impulseSkillRegistry.list()) {
      if (!seenIds.has(impulseSkill.identifier)) {
        skills.push({
          id: impulseSkill.identifier,
          name: impulseSkill.name,
          description: impulseSkill.description,
          source: 'local',
          registry: 'marketplace',
          files: 1,
          updatedAt: new Date().toISOString()
        })
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
    try {
      const dir = this.resolve(id)
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
      // Check built-in Impulse Skill Hub
      const impulseSkill = impulseSkillRegistry.get(id)
      if (impulseSkill) {
        const content = `---\nname: ${impulseSkill.name}\ndescription: ${impulseSkill.description}\ncategory: ${impulseSkill.category}\nversion: ${impulseSkill.version}\n---\n\n# ${impulseSkill.name}\n\n${impulseSkill.description}\n\n### Parameters\n\`\`\`json\n${JSON.stringify(impulseSkill.parameters, null, 2)}\n\`\`\``
        return {
          id: impulseSkill.identifier,
          name: impulseSkill.name,
          description: impulseSkill.description,
          source: 'local',
          files: 1,
          updatedAt: new Date().toISOString(),
          content
        }
      }
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

  /** The single skill catalog; combines local Impulse Skill Hub + remote marketplace */
  async search(query: string, _source?: SkillSource): Promise<SkillMarketResult[]> {
    const clean = query
      .trim()
      .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
    const cached = this.catalogCache.get(clean)
    if (cached && Date.now() - cached.at < 60_000) return cached.results

    // 1. Gather results from built-in Impulse Skill Hub (Lobe ecosystem)
    const impulseMatches = impulseSkillRegistry.search(clean)
    const results: SkillMarketResult[] = impulseMatches.map((item) => ({
      ref: item.identifier,
      name: item.name,
      summary: item.description,
      author: item.author,
      version: item.version,
      downloads: 4820,
      url: `https://selfimpulse.ai/skills/${item.identifier}`,
      registry: 'marketplace' as const
    }))
    const seenRefs = new Set(results.map((r) => r.ref))

    // 2. Optionally query marketplace CLI if available
    try {
      const args = ['skills', 'search', '--page-size', '60', '--output', 'json']
      if (clean) args.push('--q', clean)
      const result = await this.runCli(MARKETPLACE_CLI, args)
      if (result.code === 0) {
        const json = JSON.parse(result.stdout) as { items?: Array<Record<string, unknown>> }
        for (const item of json.items ?? []) {
          const identifier = String(item.identifier ?? '')
          if (!identifier || seenRefs.has(identifier)) continue
          const github = item.github as { stars?: number } | undefined
          results.push({
            ref: identifier,
            name: String(item.name ?? identifier),
            summary: String(item.description ?? ''),
            author: String(item.author ?? ''),
            version: String(item.version ?? ''),
            downloads: Number(item.installCount ?? github?.stars ?? 0) || 0,
            url: identifier ? `${MARKETPLACE_SITE}/${encodeURIComponent(identifier)}` : MARKETPLACE_SITE,
            registry: 'marketplace' as const
          })
          seenRefs.add(identifier)
        }
      }
    } catch {
      // Offline fallback: keep Impulse Skill Hub results
    }

    this.catalogCache.set(clean, { at: Date.now(), results })
    return results
  }

  async install(ref: string, _source?: SkillSource): Promise<SkillSummary[]> {
    const clean = ref.trim()
    if (!clean || !SAFE_REF.test(clean) || clean.includes('..')) {
      throw new Error('That skill reference is not valid.')
    }

    // If it's a built-in Impulse Skill, install it directly
    const impulseSkill = impulseSkillRegistry.get(clean)
    if (impulseSkill) {
      const dir = join(this.root(), clean)
      await fs.mkdir(dir, { recursive: true })
      const content = `---\nname: ${impulseSkill.name}\ndescription: ${impulseSkill.description}\ncategory: ${impulseSkill.category}\nversion: ${impulseSkill.version}\n---\n\n# ${impulseSkill.name}\n\n${impulseSkill.description}\n\n### Schema\n\`\`\`json\n${JSON.stringify(impulseSkill.parameters, null, 2)}\n\`\`\`\n`
      await fs.writeFile(join(dir, 'SKILL.md'), content, 'utf8')
      const manifest = await this.manifest()
      await this.saveManifest([
        ...manifest.filter((m) => m.id !== clean),
        { id: clean, registry: 'marketplace' as const }
      ])
      return this.list()
    }

    const before = new Set((await this.list()).map((skill) => skill.id))
    const result = await this.runCli(MARKETPLACE_CLI, [
      'skills',
      'install',
      clean,
      '--dir',
      getPaths().skills,
      '--agent',
      'codex'
    ])
    if (result.code !== 0) {
      const reason = (result.stderr || result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-2)
        .join(' ')
        .slice(0, 180)
      throw new Error(reason || INSTALL_FAILED)
    }
    const skills = await this.list()
    const installed = await this.manifest()
    const fresh = skills.filter((skill) => !before.has(skill.id)).map((skill) => skill.id)
    await this.saveManifest([
      ...installed,
      ...fresh.map((id) => ({ id, registry: 'marketplace' as const }))
    ])
    if (!fresh.length) {
      throw new Error('The catalog reported success but no skill bundle appeared in the library.')
    }
    return this.list()
  }

  /**
   * Run the catalog CLI with an argument array — never a shell string, so a
   * skill reference can never turn into a command. On Windows the `npx` shim is
   * resolved to its JS entrypoint instead of going through cmd.exe, matching
   * `backend/marketplace.ts` and `backend/external-agent.ts`.
   */
  private runCli(
    pkg: string,
    args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let invocation: ReturnType<typeof npxCommand>
      try {
        invocation = npxCommand(['-y', pkg, ...args])
      } catch (err) {
        resolve({
          code: 1,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err)
        })
        return
      }
      execFile(
        invocation.command,
        invocation.args,
        {
          encoding: 'utf8',
          timeout: 300000,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
          shell: false,
          cwd: getPaths().root,
          env: invocation.env
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
