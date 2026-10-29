import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../../paths'
import { safeJsonParse } from '../../util'
import type { AtroposActorSnapshot, AtroposJournalEntry } from './types'

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class AtroposJournal {
  private readonly filePath: string
  private writeLock: Promise<void> = Promise.resolve()

  constructor(public readonly actorId: string, customDir?: string) {
    const dir = customDir ?? getPaths().durable
    this.filePath = join(dir, `${sanitizeFilename(actorId)}.journal.jsonl`)
  }

  async append(entry: AtroposJournalEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n'
    this.writeLock = this.writeLock
      .catch(() => undefined)
      .then(async () => {
        await fs.appendFile(this.filePath, line, 'utf8')
      })
    return this.writeLock
  }

  async readEntries(): Promise<AtroposJournalEntry[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8')
      const lines = content.split('\n').filter((line) => line.trim().length > 0)
      const entries: AtroposJournalEntry[] = []
      for (const line of lines) {
        const parsed = safeJsonParse<AtroposJournalEntry>(line)
        if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
          entries.push(parsed)
        }
      }
      return entries
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'ENOENT') return []
      throw err
    }
  }

  async loadSnapshot(): Promise<AtroposActorSnapshot> {
    const entries = await this.readEntries()
    const snapshot: AtroposActorSnapshot = {
      actorId: this.actorId,
      steps: new Map(),
      awakeables: new Map(),
      timers: new Map(),
      kv: new Map()
    }

    for (const entry of entries) {
      switch (entry.kind) {
        case 'step':
          snapshot.steps.set(entry.name, entry)
          break
        case 'awakeable':
          snapshot.awakeables.set(entry.id, entry)
          break
        case 'timer':
          snapshot.timers.set(entry.name, entry)
          break
        case 'kv':
          if (entry.op === 'set' && entry.key !== undefined) {
            snapshot.kv.set(entry.key, entry.value)
          } else if (entry.op === 'delete' && entry.key !== undefined) {
            snapshot.kv.delete(entry.key)
          } else if (entry.op === 'clear') {
            snapshot.kv.clear()
          }
          break
      }
    }

    return snapshot
  }
}
