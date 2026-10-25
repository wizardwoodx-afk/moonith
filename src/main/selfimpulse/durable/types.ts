export type DurableEntryKind = 'step' | 'timer' | 'awakeable' | 'promise'
export type DurableEntryStatus = 'pending' | 'running' | 'completed'

export interface SerializedDurableError {
  name: string
  message: string
  stack?: string
}

export interface DurableEntry<T = unknown> {
  key: string
  kind: DurableEntryKind
  status: DurableEntryStatus
  attempt: number
  value?: T
  outcome?: 'value' | 'error'
  error?: SerializedDurableError
  wakeAt?: string
  /** Random sequence position after this step completed, for exact replay. */
  randomSequence?: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface DurableJournalData {
  version: 1
  runId: string
  createdAt: string
  updatedAt: string
  entries: Record<string, DurableEntry>
  state: Record<string, unknown>
}

export interface RetryPolicy {
  /** Attempts made by this invocation, including the first. */
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryOn?: (error: unknown) => boolean
}

export interface DurableRunOptions extends RetryPolicy {
  signal?: AbortSignal
}

export interface DurableAttempt {
  attempt: number
  signal: AbortSignal
}

export type DurableEventType =
  | 'step_started'
  | 'step_replayed'
  | 'step_completed'
  | 'step_retry'
  | 'step_failed'
  | 'timer_started'
  | 'timer_completed'
  | 'promise_waited'
  | 'promise_resolved'
  | 'state_changed'

export interface DurableEvent {
  type: DurableEventType
  runId: string
  key: string
  attempt?: number
  delayMs?: number
  error?: string
}

export interface DurableContextOptions {
  signal?: AbortSignal
  now?: () => number
  onEvent?: (event: DurableEvent) => void
}

export interface Awakeable<T> {
  id: string
  promise: Promise<T>
}

export interface NamedPromise<T> {
  readonly name: string
  get(): Promise<T>
  peek(): Promise<{ settled: boolean; value?: T; error?: SerializedDurableError }>
}
