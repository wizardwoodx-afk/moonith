import { newId, nowIso } from '../../util'
import type { AtroposAwakeableRecord } from './types'
import type { AtroposJournal } from './journal'

interface Deferred<T = unknown> {
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
  promise: Promise<T>
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { resolve, reject, promise }
}

export class AtroposAwakeableManager {
  private static instance: AtroposAwakeableManager | null = null
  private deferreds = new Map<string, Deferred<any>>()
  private journals = new Map<string, AtroposJournal>()

  static get(): AtroposAwakeableManager {
    if (!AtroposAwakeableManager.instance) {
      AtroposAwakeableManager.instance = new AtroposAwakeableManager()
    }
    return AtroposAwakeableManager.instance
  }

  registerJournal(actorId: string, journal: AtroposJournal): void {
    this.journals.set(actorId, journal)
  }

  create<T>(actorId: string, journal: AtroposJournal, name?: string): { id: string; promise: Promise<T> } {
    const id = newId('awk')
    const deferred = createDeferred<T>()
    this.deferreds.set(id, deferred)
    this.journals.set(actorId, journal)

    const record: AtroposAwakeableRecord = {
      kind: 'awakeable',
      id,
      name,
      status: 'pending',
      createdAt: nowIso()
    }

    void journal.append(record)
    return { id, promise: deferred.promise }
  }

  bindExisting<T>(record: AtroposAwakeableRecord, journal: AtroposJournal): { id: string; promise: Promise<T> } {
    const deferred = createDeferred<T>()
    this.deferreds.set(record.id, deferred)

    if (record.status === 'resolved') {
      deferred.resolve(record.result as T)
    } else if (record.status === 'rejected') {
      deferred.reject(new Error(record.error ?? 'Awakeable rejected'))
    }

    return { id: record.id, promise: deferred.promise }
  }

  async resolve<T>(id: string, result: T): Promise<boolean> {
    const deferred = this.deferreds.get(id)
    const resolvedAt = nowIso()

    for (const [actorId, journal] of this.journals.entries()) {
      const snapshot = await journal.loadSnapshot().catch(() => null)
      if (snapshot && snapshot.awakeables.has(id)) {
        const existing = snapshot.awakeables.get(id)!
        const update: AtroposAwakeableRecord = {
          ...existing,
          status: 'resolved',
          result,
          resolvedAt
        }
        await journal.append(update)
        break
      }
    }

    if (deferred) {
      deferred.resolve(result)
      this.deferreds.delete(id)
      return true
    }
    return false
  }

  async reject(id: string, error: string): Promise<boolean> {
    const deferred = this.deferreds.get(id)
    const resolvedAt = nowIso()

    for (const [actorId, journal] of this.journals.entries()) {
      const snapshot = await journal.loadSnapshot().catch(() => null)
      if (snapshot && snapshot.awakeables.has(id)) {
        const existing = snapshot.awakeables.get(id)!
        const update: AtroposAwakeableRecord = {
          ...existing,
          status: 'rejected',
          error,
          resolvedAt
        }
        await journal.append(update)
        break
      }
    }

    if (deferred) {
      deferred.reject(new Error(error))
      this.deferreds.delete(id)
      return true
    }
    return false
  }

  hasPending(id: string): boolean {
    return this.deferreds.has(id)
  }
}

export const awakeableManager = AtroposAwakeableManager.get()
