import { createHash } from 'node:crypto'
import { nowIso } from '../../util'
import type { DurableJournal } from './journal'
import { RetryableError, TerminalError, isAbortError, serializeError } from './errors'
import { DurableRandom } from './random'
import type {
  Awakeable,
  DurableAttempt,
  DurableContextOptions,
  DurableEntry,
  DurableEntryKind,
  DurableEvent,
  DurableJournalData,
  DurableRunOptions,
  NamedPromise,
  RetryPolicy
} from './types'

export interface DurableWaitHost {
  waitForEntry<T>(journal: DurableJournal, key: string, signal?: AbortSignal): Promise<T>
}

interface NormalizedRetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  retryOn: (error: unknown) => boolean
}

const DEFAULT_RETRY: NormalizedRetryPolicy = {
  maxAttempts: 1,
  initialDelayMs: 200,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
  retryOn: (error) => !(error instanceof TerminalError) && !isAbortError(error)
}

export function durableEntryKey(kind: DurableEntryKind, name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error(`A durable ${kind} name is required.`)
  if (clean.length > 240) throw new Error(`Durable ${kind} names must be at most 240 characters.`)
  return `${kind}:${clean}`
}

export function encodeAwakeableId(runId: string, name: string): string {
  return Buffer.from(JSON.stringify({ runId, name }), 'utf8').toString('base64url')
}

export function decodeAwakeableId(id: string): { runId: string; name: string } {
  try {
    const value = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      runId?: unknown
      name?: unknown
    }
    if (typeof value.runId !== 'string' || typeof value.name !== 'string') throw new Error()
    return { runId: value.runId, name: value.name }
  } catch {
    throw new Error('Invalid durable awakeable ID.')
  }
}

export class DurableContext {
  readonly rand: DurableRandom
  private readonly signal?: AbortSignal
  private readonly clock: () => number
  private readonly onEvent?: (event: DurableEvent) => void
  private readonly activeSteps = new Map<string, Promise<unknown>>()
  private readonly replayedSteps = new Set<string>()

  constructor(
    readonly journal: DurableJournal,
    private readonly host: DurableWaitHost,
    options: DurableContextOptions = {}
  ) {
    this.signal = options.signal
    this.clock = options.now ?? Date.now
    this.onEvent = options.onEvent
    this.rand = new DurableRandom(journal.runId)
  }

  get runId(): string {
    return this.journal.runId
  }

  snapshot(): DurableJournalData {
    return this.journal.dataSnapshot
  }

  hasCompleted(name: string, kind: DurableEntryKind = 'step'): boolean {
    return this.journal.getEntry(durableEntryKey(kind, name))?.status === 'completed'
  }

  wasReplayed(name: string): boolean {
    return this.replayedSteps.has(durableEntryKey('step', name))
  }

  async run<T>(
    name: string,
    callback: (attempt: DurableAttempt) => Promise<T> | T,
    options: DurableRunOptions = {}
  ): Promise<T> {
    const key = durableEntryKey('step', name)
    const completed = this.journal.getEntry<T>(key)
    if (completed?.status === 'completed') {
      this.rand.restore(completed.randomSequence ?? this.rand.position)
      this.replayedSteps.add(key)
      this.emit({ type: 'step_replayed', runId: this.runId, key })
      return completed.value as T
    }

    const active = this.activeSteps.get(key)
    if (active) return active as Promise<T>

    const execution = this.executeStep(key, callback, options)
    this.activeSteps.set(key, execution)
    try {
      return await execution
    } finally {
      this.activeSteps.delete(key)
    }
  }

  private async executeStep<T>(
    key: string,
    callback: (attempt: DurableAttempt) => Promise<T> | T,
    options: DurableRunOptions
  ): Promise<T> {
    const retry = normalizeRetry(options)
    const signal = options.signal ?? this.signal
    let invocationAttempt = 0

    while (true) {
      throwIfAborted(signal)
      invocationAttempt += 1
      const previous = this.journal.getEntry(key)
      const attempt = (previous?.attempt ?? 0) + 1
      const at = nowIso()
      await this.journal.putEntry({
        key,
        kind: 'step',
        status: 'running',
        attempt,
        createdAt: previous?.createdAt ?? at,
        updatedAt: at
      })
      this.emit({ type: 'step_started', runId: this.runId, key, attempt })

      let value: T
      try {
        value = await callback({ attempt, signal: signal ?? new AbortController().signal })
      } catch (error) {
        const current = this.journal.getEntry(key)
        await this.journal.putEntry({
          key,
          kind: 'step',
          status: 'pending',
          attempt,
          error: serializeError(error),
          createdAt: current?.createdAt ?? at,
          updatedAt: nowIso()
        })
        const shouldRetry =
          invocationAttempt < retry.maxAttempts &&
          !signal?.aborted &&
          (error instanceof RetryableError || retry.retryOn(error))
        if (!shouldRetry) {
          this.emit({
            type: 'step_failed',
            runId: this.runId,
            key,
            attempt,
            error: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
        const delayMs = retryDelay(retry, invocationAttempt)
        this.emit({
          type: 'step_retry',
          runId: this.runId,
          key,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error)
        })
        await abortableDelay(delayMs, signal)
        continue
      }

      try {
        const current = this.journal.getEntry(key)
        await this.journal.putEntry({
          key,
          kind: 'step',
          status: 'completed',
          attempt,
          value,
          outcome: 'value',
          randomSequence: this.rand.position,
          createdAt: current?.createdAt ?? at,
          updatedAt: nowIso(),
          completedAt: nowIso()
        })
      } catch (error) {
        // Never execute a successful side-effect callback again merely because
        // its result could not be serialized or written.
        throw new TerminalError(`The result of durable step "${key}" could not be committed.`, {
          cause: error
        })
      }
      this.emit({ type: 'step_completed', runId: this.runId, key, attempt })
      return value
    }
  }

  async sleep(name: string, durationMs: number, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('Durable sleep duration must be a non-negative finite number.')
    }
    const key = durableEntryKey('timer', name)
    let entry = this.journal.getEntry(key)
    if (entry?.status === 'completed') return
    if (!entry?.wakeAt) {
      const at = nowIso()
      entry = {
        key,
        kind: 'timer',
        status: 'pending',
        attempt: 0,
        wakeAt: new Date(this.clock() + durationMs).toISOString(),
        createdAt: entry?.createdAt ?? at,
        updatedAt: at
      }
      await this.journal.putEntry(entry)
      this.emit({ type: 'timer_started', runId: this.runId, key })
    }

    const remaining = Math.max(0, Date.parse(entry.wakeAt!) - this.clock())
    if (remaining > 0) await abortableDelay(remaining, options.signal ?? this.signal)
    const current = this.journal.getEntry(key)
    await this.journal.putEntry({
      ...current!,
      status: 'completed',
      outcome: 'value',
      updatedAt: nowIso(),
      completedAt: nowIso()
    })
    this.emit({ type: 'timer_completed', runId: this.runId, key })
  }

  async now(name = 'default'): Promise<number> {
    return this.run(`clock:${name}`, () => this.clock())
  }

  get<T = unknown>(key: string): T | undefined {
    return this.journal.state[key] as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!key.trim()) throw new Error('A durable state key is required.')
    await this.journal.setState(value, key)
    this.emit({ type: 'state_changed', runId: this.runId, key })
  }

  async delete(key: string): Promise<void> {
    await this.journal.setState(undefined, key)
    this.emit({ type: 'state_changed', runId: this.runId, key })
  }

  async awakeable<T = unknown>(name = 'default'): Promise<Awakeable<T>> {
    const key = await this.ensureWaitEntry('awakeable', name)
    return {
      id: encodeAwakeableId(this.runId, name),
      promise: this.host.waitForEntry<T>(this.journal, key, this.signal)
    }
  }

  promise<T = unknown>(name: string): NamedPromise<T> {
    durableEntryKey('promise', name)
    return {
      name,
      get: async () => {
        const key = await this.ensureWaitEntry('promise', name)
        return this.host.waitForEntry<T>(this.journal, key, this.signal)
      },
      peek: async () => {
        const key = durableEntryKey('promise', name)
        const entry = this.journal.getEntry<T>(key)
        return entry?.status === 'completed'
          ? { settled: true, value: entry.value, error: entry.error }
          : { settled: false }
      }
    }
  }

  private async ensureWaitEntry(kind: 'awakeable' | 'promise', name: string): Promise<string> {
    const key = durableEntryKey(kind, name)
    let entry = this.journal.getEntry(key)
    if (!entry) {
      const at = nowIso()
      entry = { key, kind, status: 'pending', attempt: 0, createdAt: at, updatedAt: at }
      await this.journal.putEntry(entry)
    } else if (entry.kind !== kind) {
      throw new Error(`Durable entry "${key}" has a different kind.`)
    }
    this.emit({ type: 'promise_waited', runId: this.runId, key })
    return key
  }

  private emit(event: DurableEvent): void {
    this.onEvent?.(event)
  }
}

function normalizeRetry(options: RetryPolicy): NormalizedRetryPolicy {
  return {
    maxAttempts: clampInteger(options.maxAttempts ?? DEFAULT_RETRY.maxAttempts, 1, 100),
    initialDelayMs: clampNumber(options.initialDelayMs ?? DEFAULT_RETRY.initialDelayMs, 0, 60_000),
    maxDelayMs: clampNumber(options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs, 0, 300_000),
    backoffMultiplier: clampNumber(
      options.backoffMultiplier ?? DEFAULT_RETRY.backoffMultiplier,
      1,
      10
    ),
    retryOn: options.retryOn ?? DEFAULT_RETRY.retryOn
  }
}

function retryDelay(policy: NormalizedRetryPolicy, failedAttempt: number): number {
  return Math.min(
    policy.maxDelayMs,
    Math.round(policy.initialDelayMs * policy.backoffMultiplier ** (failedAttempt - 1))
  )
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max
  return Math.min(max, Math.max(min, value))
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

export async function abortableDelay(durationMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  let remaining = durationMs
  while (remaining > 0) {
    const slice = Math.min(remaining, 2_147_483_647)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, slice)
      const abort = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      function done(): void {
        signal?.removeEventListener('abort', abort)
        resolve()
      }
      signal?.addEventListener('abort', abort, { once: true })
    })
    remaining -= slice
  }
}

/** Stable idempotency key for external side-effect APIs that support one. */
export function durableIdempotencyKey(runId: string, stepName: string): string {
  return createHash('sha256').update(`${runId}\u0000${stepName}`).digest('hex')
}
