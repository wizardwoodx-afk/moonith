import type { MemoryInput, MemoryNote, MemoryScope } from '@shared/types'
import { getPaths } from '../paths'
import { atomicWriteJson, newId, nowIso, readJson, truncate } from '../util'

const MAX_NOTES = 500
const MAX_TEXT = 4000
const MAX_TAGS = 12

export function parseMemoryLines(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((line) => line.length > 3 && line.length <= MAX_TEXT)
}

export function memoryTerms(query: string): string[] {
  return [
    ...new Set(
      String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2)
    )
  ]
}

export function scoreMemory(note: Pick<MemoryNote, 'text' | 'tags'>, terms: string[]): number {
  if (!terms.length) return 0
  const haystack = `${note.text} ${note.tags.join(' ')}`.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (haystack.includes(term)) score += 1
    if (note.tags.some((tag) => tag.toLowerCase() === term)) score += 2
  }
  return score
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [
    ...new Set(
      (tags ?? [])
        .map((tag) => tag.trim().replace(/\s+/g, '-').slice(0, 32))
        .filter(Boolean)
        .slice(0, MAX_TAGS)
    )
  ]
}

function validNote(value: unknown): value is MemoryNote {
  const note = value as MemoryNote
  return Boolean(
    note &&
      typeof note.id === 'string' &&
      typeof note.text === 'string' &&
      note.text.trim() &&
      (note.scope === 'global' || note.scope === 'workspace')
  )
}

export class MemoryLedger {
  private notes: MemoryNote[] | null = null

  private async load(): Promise<MemoryNote[]> {
    if (this.notes) return this.notes
    const raw = await readJson<unknown>(getPaths().memoriesFile, [])
    this.notes = Array.isArray(raw) ? raw.filter(validNote) : []
    return this.notes
  }

  private async persist(): Promise<void> {
    await atomicWriteJson(getPaths().memoriesFile, this.notes ?? [])
  }

  async list(): Promise<MemoryNote[]> {
    const notes = await this.load()
    return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async add(input: MemoryInput, source: MemoryNote['source'] = 'user'): Promise<MemoryNote[]> {
    const text = input.text.trim()
    if (!text) throw new Error('Write the note first.')
    if (text.length > MAX_TEXT) throw new Error(`Keep a note under ${MAX_TEXT.toLocaleString()} characters.`)
    const scope: MemoryScope = input.scope === 'workspace' ? 'workspace' : 'global'
    const scopeRef = scope === 'workspace' ? input.scopeRef?.trim() : undefined
    if (scope === 'workspace' && !scopeRef) {
      throw new Error('A workspace note needs the folder it belongs to.')
    }

    const notes = await this.load()
    if (notes.length >= MAX_NOTES) {
      throw new Error(`Memory holds ${MAX_NOTES} notes. Remove one before adding another.`)
    }
    const now = nowIso()
    notes.push({
      id: newId('memory'),
      text,
      scope,
      scopeRef,
      tags: normalizeTags(input.tags),
      source,
      createdAt: now,
      updatedAt: now
    })
    await this.persist()
    return this.list()
  }

  async remove(id: string): Promise<MemoryNote[]> {
    const notes = await this.load()
    this.notes = notes.filter((note) => note.id !== id)
    await this.persist()
    return this.list()
  }

  async importText(text: string): Promise<MemoryNote[]> {
    const lines = parseMemoryLines(text)
    if (!lines.length) throw new Error('No notes were found in that text.')
    const notes = await this.load()
    const existing = new Set(notes.map((note) => note.text.toLowerCase()))
    const now = nowIso()
    for (const line of lines) {
      if (notes.length >= MAX_NOTES) break
      if (existing.has(line.toLowerCase())) continue
      notes.push({
        id: newId('memory'),
        text: line,
        scope: 'global',
        tags: [],
        source: 'import',
        createdAt: now,
        updatedAt: now
      })
      existing.add(line.toLowerCase())
    }
    await this.persist()
    return this.list()
  }

  async recall(
    query: string,
    folders: string[] = [],
    limit = 10
  ): Promise<MemoryNote[]> {
    const notes = await this.load()
    const applicable = notes.filter(
      (note) => note.scope === 'global' || (note.scopeRef ? folders.includes(note.scopeRef) : false)
    )
    const terms = memoryTerms(query)
    if (!terms.length) {
      return [...applicable]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
    }
    return applicable
      .map((note) => ({ note, score: scoreMemory(note, terms) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.note.updatedAt.localeCompare(a.note.updatedAt)
      )
      .slice(0, limit)
      .map((entry) => entry.note)
  }

  async promptIndex(query: string, folders: string[] = []): Promise<string> {
    const notes = await this.recall(query, folders, 10)
    if (!notes.length) return ''
    return notes
      .map((note) => {
        const where = note.scope === 'workspace' && note.scopeRef ? note.scopeRef : 'All tasks'
        return `- [${where}] ${truncate(note.text, 700)}`
      })
      .join('\n')
      .slice(0, 7000)
  }

  async searchText(query: string, folders: string[] = []): Promise<string> {
    const notes = await this.recall(query, folders, 20)
    if (!notes.length) return 'No saved note matches that.'
    return notes
      .map((note) => {
        const where = note.scope === 'workspace' && note.scopeRef ? note.scopeRef : 'All tasks'
        return `- [${where}] (${note.id}) ${truncate(note.text, 1200)}`
      })
      .join('\n')
  }
}

export const memoryService = new MemoryLedger()
