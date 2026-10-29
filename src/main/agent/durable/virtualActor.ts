import { nowIso } from '../../util'
import { awakeableManager } from './awakeables'
import { AtroposJournal } from './journal'
import type {
  AtroposActorSnapshot,
  AtroposContext,
  AtroposStepRecord,
  AtroposTimerRecord
} from './types'

export class AtroposVirtualActor implements AtroposContext {
  private journal: AtroposJournal
  private snapshot: AtroposActorSnapshot | null = null
  private initPromise: Promise<void> | null = null

  constructor(
    public readonly actorId: string,
    customDir?: string
  ) {
    this.journal = new AtroposJournal(actorId, customDir)
    awakeableManager.registerJournal(actorId, this.journal)
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.snapshot = await this.journal.loadSnapshot()
      })()
    }
    return this.initPromise
  }

  private async ensureInit(): Promise<AtroposActorSnapshot> {
    await this.init()
    return this.snapshot!
  }

  async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const snap = await this.ensureInit()
    const existing = snap.steps.get(name)

    if (existing) {
      if (existing.status === 'completed') {
        return existing.result as T
      }
      if (existing.status === 'failed') {
        throw new Error(existing.error ?? `Step "${name}" previously failed.`)
      }
    }

    const startedAt = nowIso()
    const runningRecord: AtroposStepRecord = {
      kind: 'step',
      name,
      status: 'running',
      startedAt
    }
    snap.steps.set(name, runningRecord)
    await this.journal.append(runningRecord)

    try {
      const result = await fn()
      const completedRecord: AtroposStepRecord = {
        kind: 'step',
        name,
        status: 'completed',
        result,
        startedAt,
        completedAt: nowIso()
      }
      snap.steps.set(name, completedRecord)
      await this.journal.append(completedRecord)
      return result
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const failedRecord: AtroposStepRecord = {
        kind: 'step',
        name,
        status: 'failed',
        error: errorMsg,
        startedAt,
        completedAt: nowIso()
      }
      snap.steps.set(name, failedRecord)
      await this.journal.append(failedRecord)
      throw err
    }
  }

  awakeable<T>(name?: string): { id: string; promise: Promise<T> } {
    if (!this.snapshot) {
      // Async safety: create through manager with journal registered
      return awakeableManager.create<T>(this.actorId, this.journal, name)
    }

    if (name) {
      for (const rec of this.snapshot.awakeables.values()) {
        if (rec.name === name) {
          return awakeableManager.bindExisting<T>(rec, this.journal)
        }
      }
    }

    return awakeableManager.create<T>(this.actorId, this.journal, name)
  }

  async sleep(name: string, durationMs: number): Promise<void> {
    const snap = await this.ensureInit()
    const existing = snap.timers.get(name)

    if (existing && existing.status === 'completed') {
      return
    }

    const now = Date.now()
    let dueAt = now + durationMs

    if (existing && existing.status === 'sleeping') {
      dueAt = existing.dueAt
    } else {
      const sleepingRecord: AtroposTimerRecord = {
        kind: 'timer',
        name,
        dueAt,
        durationMs,
        status: 'sleeping',
        startedAt: nowIso()
      }
      snap.timers.set(name, sleepingRecord)
      await this.journal.append(sleepingRecord)
    }

    const remaining = dueAt - Date.now()
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining))
    }

    const completedRecord: AtroposTimerRecord = {
      kind: 'timer',
      name,
      dueAt,
      durationMs,
      status: 'completed',
      startedAt: existing?.startedAt ?? nowIso(),
      completedAt: nowIso()
    }
    snap.timers.set(name, completedRecord)
    await this.journal.append(completedRecord)
  }

  async get<T>(key: string): Promise<T | undefined> {
    const snap = await this.ensureInit()
    return snap.kv.get(key) as T | undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    const snap = await this.ensureInit()
    snap.kv.set(key, value)
    await this.journal.append({
      kind: 'kv',
      op: 'set',
      key,
      value,
      at: nowIso()
    })
  }

  async delete(key: string): Promise<void> {
    const snap = await this.ensureInit()
    snap.kv.delete(key)
    await this.journal.append({
      kind: 'kv',
      op: 'delete',
      key,
      at: nowIso()
    })
  }

  async clear(): Promise<void> {
    const snap = await this.ensureInit()
    snap.kv.clear()
    await this.journal.append({
      kind: 'kv',
      op: 'clear',
      at: nowIso()
    })
  }

  getSnapshot(): AtroposActorSnapshot | null {
    return this.snapshot
  }
}
