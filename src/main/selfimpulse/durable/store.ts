import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { nowIso } from '../../util'
import { DurableContext, decodeAwakeableId, durableEntryKey } from './context'
import { deserializeError, serializeError } from './errors'
import { DurableJournal, durableFileName } from './journal'
import type { DurableContextOptions, DurableEntry, DurableJournalData } from './types'

interface Waiter {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  cleanup: () => void
}

/**
 * One store per application profile. SelfImpulse's single-instance lock keeps
 * independent processes from writing the same journal; Crew work shares this
 * store and its per-journal write queue.
 */
export class DurableStore {
  private readonly journals = new Map<string, DurableJournal>()
  private readonly opening = new Map<string, Promise<DurableJournal>>()
  private readonly waiters = new Map<string, Set<Waiter>>()

  constructor(readonly root: string) {}

  async open(runId: string): Promise<DurableJournal> {
    const cached = this.journals.get(runId)
    if (cached) return cached
    const pending = this.opening.get(runId)
    if (pending) return pending
    const loading = DurableJournal.open(this.root, runId)
      .then((journal) => {
        this.journals.set(runId, journal)
        return journal
      })
      .finally(() => this.opening.delete(runId))
    this.opening.set(runId, loading)
    return loading
  }

  async context(runId: string, options: DurableContextOptions = {}): Promise<DurableContext> {
    return new DurableContext(await this.open(runId), this, options)
  }

  waitForEntry<T>(journal: DurableJournal, key: string, signal?: AbortSignal): Promise<T> {
    const completed = journal.getEntry<T>(key)
    if (completed?.status === 'completed') return settleEntry(completed)

    return new Promise<T>((resolve, reject) => {
      const waiterKey = this.waiterKey(journal.runId, key)
      const abort = () => {
        cleanup()
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      const cleanup = () => {
        signal?.removeEventListener('abort', abort)
        const group = this.waiters.get(waiterKey)
        group?.delete(waiter)
        if (!group?.size) this.waiters.delete(waiterKey)
      }
      const waiter: Waiter = {
        resolve: (value) => {
          cleanup()
          resolve(value as T)
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
        cleanup
      }
      const group = this.waiters.get(waiterKey) ?? new Set<Waiter>()
      group.add(waiter)
      this.waiters.set(waiterKey, group)
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })

      // Resolution may have landed between the first entry check and waiter
      // registration. Re-read after registration to close that race.
      const current = journal.getEntry<T>(key)
      if (current?.status === 'completed') {
        void settleEntry(current).then(waiter.resolve, waiter.reject)
      }
    })
  }

  async resolveAwakeable(id: string, value: unknown): Promise<void> {
    const { runId, name } = decodeAwakeableId(id)
    await this.settle(runId, 'awakeable', name, { outcome: 'value', value })
  }

  async rejectAwakeable(id: string, error: unknown): Promise<void> {
    const { runId, name } = decodeAwakeableId(id)
    await this.settle(runId, 'awakeable', name, { outcome: 'error', error })
  }

  async resolvePromise(runId: string, name: string, value: unknown): Promise<void> {
    await this.settle(runId, 'promise', name, { outcome: 'value', value })
  }

  async rejectPromise(runId: string, name: string, error: unknown): Promise<void> {
    await this.settle(runId, 'promise', name, { outcome: 'error', error })
  }

  private async settle(
    runId: string,
    kind: 'awakeable' | 'promise',
    name: string,
    outcome: { outcome: 'value'; value: unknown } | { outcome: 'error'; error: unknown }
  ): Promise<void> {
    const journal = await this.open(runId)
    const key = durableEntryKey(kind, name)
    const current = journal.getEntry(key)
    if (current?.kind && current.kind !== kind) {
      throw new Error(`Durable entry "${key}" has a different kind.`)
    }
    if (current?.status === 'completed') {
      throw new Error(`Durable ${kind} "${name}" is already settled.`)
    }
    const at = nowIso()
    const entry: DurableEntry = {
      key,
      kind,
      status: 'completed',
      attempt: current?.attempt ?? 0,
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
      completedAt: at,
      ...(outcome.outcome === 'value'
        ? { outcome: 'value' as const, value: outcome.value }
        : { outcome: 'error' as const, error: serializeError(outcome.error) })
    }
    // Persist first. A continuation must never observe a resolution that a
    // restart would not be able to recover.
    await journal.putEntry(entry)
    const waiterKey = this.waiterKey(runId, key)
    const group = this.waiters.get(waiterKey)
    this.waiters.delete(waiterKey)
    for (const waiter of group ?? []) {
      waiter.cleanup()
      if (entry.outcome === 'error') waiter.reject(deserializeError(entry.error!))
      else waiter.resolve(entry.value)
    }
  }

  async list(): Promise<DurableJournalData[]> {
    const files = await fs.readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const snapshots: DurableJournalData[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const value = JSON.parse(await fs.readFile(join(this.root, file), 'utf8')) as {
          runId?: unknown
        }
        if (typeof value.runId === 'string') {
          snapshots.push((await this.open(value.runId)).dataSnapshot)
        }
      } catch {
        // `open` remains the strict path for execution. Listing skips an
        // unreadable/corrupt file instead of replacing or executing it.
      }
    }
    return snapshots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async flush(): Promise<void> {
    await Promise.all([...this.journals.values()].map((journal) => journal.flush()))
  }

  async delete(runId: string): Promise<void> {
    const journal = this.journals.get(runId)
    if (journal) await journal.flush()
    this.journals.delete(runId)
    await fs.unlink(join(this.root, durableFileName(runId))).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }

  private waiterKey(runId: string, entryKey: string): string {
    return `${runId}\u0000${entryKey}`
  }
}

async function settleEntry<T>(entry: DurableEntry<T>): Promise<T> {
  if (entry.outcome === 'error') throw deserializeError(entry.error!)
  return entry.value as T
}

/** Create a store rooted in the application's durable data directory. */
export function createDurableStore(root: string): DurableStore {
  return new DurableStore(root)
}
