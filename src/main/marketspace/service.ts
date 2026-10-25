import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import type {
  MarketspaceApplyResult,
  MarketspaceCreateInput,
  MarketspaceDetail,
  MarketspaceEntry
} from '@shared/marketspace'
import { atomicWriteFile } from '../atomic'
import { resolveSafePath } from '../security'
import { slugify } from '../util'
import { NATIVE_CATALOG, type NativeCatalogDefinition } from './catalog'

const DESIGN_FILE = 'DESIGN.md'
const PREVIEW_FILE = 'preview.html'
const MANIFEST_FILE = 'manifest.json'
const MAX_DESIGN_BYTES = 160_000
const MAX_PREVIEW_BYTES = 240_000
const BUILT_IN_DATE = '2026-10-25T00:00:00.000Z'

interface StoredManifest {
  format: 'selfimpulse-marketspace/1'
  id: string
  name: string
  description: string
  version: string
  source: 'builtin' | 'local'
  updatedAt: string
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function id(value: string): string {
  const clean = String(value ?? '').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(clean)) throw new Error('Invalid Marketspace entry id.')
  return clean
}

function bounded(value: string, label: string, max: number): string {
  const clean = String(value ?? '').trim()
  if (!clean || clean.includes('\0') || Buffer.byteLength(clean, 'utf8') > max) {
    throw new Error(`${label} is empty, invalid, or too large.`)
  }
  return clean
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character)
}

function previewDocument(
  name: string,
  description: string,
  design: string,
  sample?: NativeCatalogDefinition['sample']
): string {
  const eyebrow = sample?.eyebrow ?? 'SELFIMPULSE / DESIGN SYSTEM'
  const heading = sample?.heading ?? name
  const caption = sample?.caption ?? description
  const accent = sample?.accent ?? '#718D79'
  const items = sample?.items ?? ['Portable DESIGN.md', 'Inspectable artifact', 'Explicit human handoff']
  const excerpt = design.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#')).slice(0, 2).join(' ')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(name)} · Marketspace preview</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f3ef;color:#252722;font:15px/1.55 system-ui,-apple-system,sans-serif}main{max-width:760px;margin:0 auto;padding:48px 34px}section{background:#fff;border:1px solid #dedfd8;border-radius:18px;padding:34px;box-shadow:0 12px 35px #2631260b}.eyebrow{font-size:10px;letter-spacing:.14em;font-weight:700;color:${accent}}h1{font-size:38px;line-height:1.08;letter-spacing:-.04em;margin:18px 0 14px;max-width:580px}p{color:#62675f;margin:0;max-width:560px}.rule{height:1px;background:#e6e7e1;margin:28px 0}.items{display:grid;gap:10px;margin-top:20px}.item{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #e5e6e0;border-radius:10px;color:#41463f}.dot{width:7px;height:7px;border-radius:50%;background:${accent};flex:none}.foot{margin-top:26px;font-size:12px;color:#81867d}@media(max-width:520px){main{padding:22px 14px}section{padding:24px}h1{font-size:30px}}@media(prefers-reduced-motion:no-preference){section{animation:arrive .22s ease-out}@keyframes arrive{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}}
</style></head><body><main><section><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(caption)}</p><div class="rule"></div><div class="items">${items.map((item) => `<div class="item"><span class="dot"></span><span>${escapeHtml(item)}</span></div>`).join('')}</div><div class="foot">${escapeHtml(excerpt || 'Static, network-free preview · generated from the reviewed design specification.')}</div></section></main></body></html>`
}

function definitionEntry(definition: NativeCatalogDefinition, installed: boolean): MarketspaceEntry {
  return {
    id: definition.id,
    kind: 'design-system',
    name: definition.name,
    description: definition.description,
    version: definition.version,
    source: 'builtin',
    trust: 'reviewed',
    installed,
    updatedAt: BUILT_IN_DATE,
    capabilities: ['prompt:inject', 'artifact:write']
  }
}

function manifestEntry(manifest: StoredManifest): MarketspaceEntry {
  return {
    id: manifest.id,
    kind: 'design-system',
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    source: manifest.source,
    trust: manifest.source === 'builtin' ? 'reviewed' : 'local',
    installed: true,
    updatedAt: manifest.updatedAt,
    capabilities: ['prompt:inject', 'artifact:write']
  }
}

export class MarketspaceService {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  private get entriesRoot(): string {
    return join(this.root, 'design-systems')
  }

  private definition(entryId: string): NativeCatalogDefinition | undefined {
    return NATIVE_CATALOG.find((entry) => entry.id === entryId)
  }

  private async manifest(entryId: string): Promise<StoredManifest | null> {
    const clean = id(entryId)
    const file = join(this.entriesRoot, clean, MANIFEST_FILE)
    try {
      const target = await resolveSafePath([this.root], file, { mode: 'read' })
      const stat = await fs.stat(target)
      if (!stat.isFile() || stat.size > 64_000) return null
      const parsed = JSON.parse(await fs.readFile(target, 'utf8')) as Partial<StoredManifest>
      const definition = this.definition(clean)
      if (
        parsed.format !== 'selfimpulse-marketspace/1' ||
        parsed.id !== clean ||
        (parsed.source !== 'builtin' && parsed.source !== 'local') ||
        (parsed.source === 'builtin' && !definition) ||
        (definition && parsed.source !== 'builtin') ||
        !text(parsed.name) ||
        !text(parsed.description) ||
        !text(parsed.version) ||
        !text(parsed.updatedAt)
      ) return null
      return parsed as StoredManifest
    } catch {
      return null
    }
  }

  private async writeEntry(
    definition: NativeCatalogDefinition,
    source: 'builtin' | 'local',
    entryId = definition.id
  ): Promise<void> {
    const clean = id(entryId)
    await fs.mkdir(this.entriesRoot, { recursive: true })
    const destination = await resolveSafePath([this.root], join(this.entriesRoot, clean), { mode: 'write' })
    if (await this.manifest(clean)) return
    const temporary = await fs.mkdtemp(join(this.entriesRoot, `.incoming-${clean}-`))
    const manifest: StoredManifest = {
      format: 'selfimpulse-marketspace/1',
      id: clean,
      name: bounded(definition.name, 'Name', 180),
      description: bounded(definition.description, 'Description', 700),
      version: definition.version,
      source,
      updatedAt: new Date().toISOString()
    }
    try {
      await atomicWriteFile(join(temporary, DESIGN_FILE), bounded(definition.design, 'Design specification', MAX_DESIGN_BYTES))
      await atomicWriteFile(
        join(temporary, PREVIEW_FILE),
        previewDocument(definition.name, definition.description, definition.design, definition.sample)
      )
      await atomicWriteFile(join(temporary, MANIFEST_FILE), JSON.stringify(manifest, null, 2))
      await fs.rename(temporary, destination)
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async list(query = ''): Promise<MarketspaceEntry[]> {
    const cleanQuery = query.trim().toLowerCase().slice(0, 120)
    const entries = new Map<string, MarketspaceEntry>()
    for (const definition of NATIVE_CATALOG) {
      entries.set(definition.id, definitionEntry(definition, Boolean(await this.manifest(definition.id))))
    }
    let directories: import('node:fs').Dirent[] = []
    try {
      directories = await fs.readdir(this.entriesRoot, { withFileTypes: true })
    } catch {
      directories = []
    }
    for (const directory of directories) {
      if (!directory.isDirectory() || directory.name.startsWith('.')) continue
      let clean: string
      try {
        clean = id(directory.name)
      } catch {
        continue
      }
      const manifest = await this.manifest(clean)
      if (!manifest || manifest.source === 'builtin') continue
      entries.set(clean, manifestEntry(manifest))
    }
    return [...entries.values()]
      .filter((entry) => !cleanQuery || `${entry.name} ${entry.description} ${entry.id}`.toLowerCase().includes(cleanQuery))
      .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
  }

  async read(entryId: string): Promise<MarketspaceDetail | null> {
    const clean = id(entryId)
    const manifest = await this.manifest(clean)
    const definition = this.definition(clean)
    if (!manifest && !definition) return null
    const entry = manifest ? manifestEntry(manifest) : definitionEntry(definition!, false)
    if (manifest) {
      const directory = join(this.entriesRoot, clean)
      const designPath = await resolveSafePath([this.root], join(directory, DESIGN_FILE), { mode: 'read' })
      const previewPath = await resolveSafePath([this.root], join(directory, PREVIEW_FILE), { mode: 'read' })
      const [designStat, previewStat] = await Promise.all([fs.stat(designPath), fs.stat(previewPath)])
      if (!designStat.isFile() || designStat.size > MAX_DESIGN_BYTES || !previewStat.isFile() || previewStat.size > MAX_PREVIEW_BYTES) {
        throw new Error('This Marketspace entry is incomplete or exceeds the safe size limit.')
      }
      return {
        ...entry,
        design: await fs.readFile(designPath, 'utf8'),
        preview: await fs.readFile(previewPath, 'utf8'),
        files: [DESIGN_FILE, PREVIEW_FILE, MANIFEST_FILE]
      }
    }
    return {
      ...entry,
      design: definition!.design,
      preview: previewDocument(definition!.name, definition!.description, definition!.design, definition!.sample),
      files: [DESIGN_FILE, PREVIEW_FILE]
    }
  }

  async install(entryId: string): Promise<MarketspaceDetail> {
    const clean = id(entryId)
    const definition = this.definition(clean)
    if (!definition) throw new Error('Only reviewed built-in entries can be installed through this action.')
    await this.writeEntry(definition, 'builtin')
    const detail = await this.read(clean)
    if (!detail || !detail.installed || detail.source !== 'builtin') {
      throw new Error('The Marketspace entry could not be verified after installation.')
    }
    return detail
  }

  async create(input: MarketspaceCreateInput): Promise<MarketspaceDetail> {
    const name = bounded(input.name, 'Name', 100)
    const description = bounded(input.description, 'Description', 500)
    const design = bounded(input.design, 'Design specification', MAX_DESIGN_BYTES)
    const entryId = id(`local-${slugify(name, 'design-system')}`)
    if (await this.manifest(entryId)) throw new Error('A local design system with that name already exists.')
    await this.writeEntry({ id: entryId, name, description, version: '1.0.0', design }, 'local')
    const detail = await this.read(entryId)
    if (!detail) throw new Error('The local design system could not be verified after saving.')
    return detail
  }

  async remove(entryId: string): Promise<void> {
    const clean = id(entryId)
    const manifest = await this.manifest(clean)
    if (!manifest) throw new Error('That Marketspace entry is not installed.')
    const directory = await resolveSafePath([this.root], join(this.entriesRoot, clean), { mode: 'write' })
    await fs.rm(directory, { recursive: true, force: true })
  }

  async apply(entryId: string, workspace: string, overwrite = false): Promise<MarketspaceApplyResult> {
    const detail = await this.read(entryId)
    if (!detail) throw new Error('Choose an available Marketspace design system first.')
    if (!detail.installed) throw new Error('Install the design system before applying it to a task.')
    const parent = await resolveSafePath([workspace], join(workspace, 'design-system'), { mode: 'write' })
    await fs.mkdir(parent, { recursive: true })
    const destination = await resolveSafePath([workspace], join(parent, detail.id), { mode: 'write' })
    let created = false
    if (!overwrite) {
      try {
        await fs.mkdir(destination, { recursive: false })
        created = true
      } catch (error) {
        throw new Error(`The destination already exists or could not be created; no files were overwritten. ${(error as Error).message}`)
      }
    } else {
      await fs.mkdir(destination, { recursive: true })
    }
    const files: Array<[string, string]> = [[DESIGN_FILE, detail.design], [PREVIEW_FILE, detail.preview]]
    try {
      for (const [name, contents] of files) {
        const target = await resolveSafePath([workspace], join(destination, name), { mode: 'write' })
        await atomicWriteFile(target, contents)
      }
    } catch (error) {
      if (created) await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    return {
      id: detail.id,
      directory: relative(workspace, destination).replace(/\\/g, '/'),
      files: files.map(([name]) => `${relative(workspace, destination).replace(/\\/g, '/')}/${name}`),
      overwritten: overwrite
    }
  }
}

export function previewForDefinition(definition: NativeCatalogDefinition): string {
  return previewDocument(definition.name, definition.description, definition.design, definition.sample)
}

export const MARKETSPACE_LIMITS = { MAX_DESIGN_BYTES, MAX_PREVIEW_BYTES }
