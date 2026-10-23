import type { BackendMemory, BackendStore } from './store'

/**
 * Memory store: durable notes the agent can recall, scoped globally or per project.
 * Ported from the earlier desktop shell.
 */

export interface MemoryListOptions {
  scope?: string
}

export interface MemoryInput {
  text?: string
  scope?: string
  tags?: string[]
  source?: string
}

export class Memory {
  readonly store: BackendStore

  constructor(store: BackendStore) {
    this.store = store
  }

  list({ scope }: MemoryListOptions = {}): BackendMemory[] {
    const all = this.store.memories.all()
    return scope ? all.filter((m) => m.scope === scope) : all
  }

  add({ text, scope = 'global', tags = [], source = 'user' }: MemoryInput): BackendMemory {
    if (!text || !text.trim()) throw new Error('Memory text is required')
    const mem: BackendMemory = {
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      text: text.trim(),
      scope,
      tags,
      source,
      createdAt: Date.now()
    }
    this.store.memories.insert(mem)
    return mem
  }

  remove(id: string): boolean {
    return this.store.memories.remove(id)
  }

  update(id: string, patch: Partial<BackendMemory>): BackendMemory | null {
    return this.store.memories.update(id, patch)
  }

  /** Naive keyword scoring — good enough to surface the relevant notes. */
  search(query?: string, limit = 8): BackendMemory[] {
    const terms = String(query || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
    if (!terms.length) return this.list().slice(-limit)
    const scored = this.store.memories
      .all()
      .map((m) => {
        const hay = `${m.text} ${(m.tags || []).join(' ')}`.toLowerCase()
        let score = 0
        for (const t of terms) if (hay.includes(t)) score += 1
        for (const t of m.tags || []) if (terms.includes(String(t).toLowerCase())) score += 2
        return { m, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
    return scored.slice(0, limit).map((x) => x.m)
  }

  /** Turn a blob of text into discrete memories. */
  importText(text: string, scope = 'global'): BackendMemory[] {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter((l) => l.length > 3 && l.length < 400)
    const created = lines.map((l) => this.add({ text: l, scope, source: 'import' }))
    return created
  }
}
