import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson, nowIso } from '../../util'
import { DurableJournalCorruptError } from './errors'
import type { DurableEntry, DurableJournalData } from './types'

export function durableFileName(runId: string): string {
  return `${createHash('sha256').update(runId).digest('hex')}.json`
}

function blankJournal(runId: string): DurableJournalData {
  const at = nowIso()
  return { version: 1, runId, createdAt: at, updatedAt: at, entries: {}, state: {} }
}

function isJournal(value: unknown, runId: string): value is DurableJournalData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<DurableJournalData>
  return (
    data.version === 1 &&
    data.runId === runId &&
    typeof data.createdAt === 'string' &&
    typeof data.updatedAt === 'string' &&
    Boolean(data.entries) &&
    typeof data.entries === 'object' &&
    Boolean(data.state) &&
    typeof data.state === 'object'
  )
}

export class DurableJournal {
  private writeChain: Promise<void> = Promise.resolve()

  private constructor(
    readonly runId: string,
    private readonly file: string,
    private data: DurableJournalData
  ) {}

  static async open(root: string, runId: string): Promise<DurableJournal> {
    if (!runId.trim()) throw new Error('A durable run ID is required.')
    const file = join(root, durableFileName(runId))
    let data: DurableJournalData
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!isJournal(parsed, runId)) throw new Error('Invalid durable journal shape.')
      data = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        data = blankJournal(runId)
      } else {
        throw new DurableJournalCorruptError(runId, { cause: error })
      }
    }

    const journal = new DurableJournal(runId, file, data)
    let recovered = false
    for (const entry of Object.values(data.entries)) {
      if (entry.status === 'running') {
        entry.status = 'pending'
        entry.updatedAt = nowIso()
        recovered = true
      }
    }
    if (recovered) await journal.persist()
    return journal
  }

  get dataSnapshot(): DurableJournalData {
    return clone(this.data)
  }

  get entries(): Record<string, DurableEntry> {
    return this.data.entries
  }

  get state(): Record<string, unknown> {
    return this.data.state
  }

  getEntry<T = unknown>(key: string): DurableEntry<T> | undefined {
    return this.data.entries[key] as DurableEntry<T> | undefined
  }

  async putEntry<T>(entry: DurableEntry<T>): Promise<void> {
    const previous = this.data.entries[entry.key]
    this.data.entries[entry.key] = entry as DurableEntry
    try {
      await this.persist()
    } catch (error) {
      if (this.data.entries[entry.key] === entry) {
        if (previous) this.data.entries[entry.key] = previous
        else delete this.data.entries[entry.key]
      }
      throw error
    }
  }

  async patchEntry(
    key: string,
    patch: Partial<Omit<DurableEntry, 'key'>>
  ): Promise<DurableEntry> {
    const current = this.data.entries[key]
    if (!current) throw new Error(`Durable entry "${key}" does not exist.`)
    const next = { ...current, ...patch, key, updatedAt: nowIso() }
    await this.putEntry(next)
    return next
  }

  async setState(value: unknown, key?: string): Promise<void> {
    const previous = this.data.state
    let next: Record<string, unknown>
    if (key === undefined) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Whole durable state must be a JSON object.')
      }
      next = clone(value) as Record<string, unknown>
    } else {
      next = { ...previous }
      if (value === undefined) delete next[key]
      else next[key] = clone(value)
    }
    this.data.state = next
    try {
      await this.persist()
    } catch (error) {
      if (this.data.state === next) this.data.state = previous
      throw error
    }
  }

  async flush(): Promise<void> {
    await this.writeChain
  }

  private persist(): Promise<void> {
    this.data.updatedAt = nowIso()
    const snapshot = clone(this.data)
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => atomicWriteJson(this.file, snapshot))
    return this.writeChain
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
