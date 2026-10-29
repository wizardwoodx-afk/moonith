/**
 * Atropos — Desktop-Native Durable Agent Execution Engine.
 *
 * Implements deterministic replayable steps, crash-proof awakeables,
 * durable wall-clock timers, and scoped key-value actor memory entirely
 * in-process via local append-only journals.
 *
 * Under no circumstances does this require localhost, webservers, daemons,
 * or open TCP network ports.
 */

export type AtroposEntryKind = 'step' | 'awakeable' | 'timer' | 'kv'

export interface AtroposStepRecord {
  kind: 'step'
  name: string
  status: 'running' | 'completed' | 'failed'
  result?: unknown
  error?: string
  startedAt: string
  completedAt?: string
}

export interface AtroposAwakeableRecord {
  kind: 'awakeable'
  id: string
  name?: string
  status: 'pending' | 'resolved' | 'rejected'
  result?: unknown
  error?: string
  createdAt: string
  resolvedAt?: string
}

export interface AtroposTimerRecord {
  kind: 'timer'
  name: string
  dueAt: number
  durationMs: number
  status: 'sleeping' | 'completed'
  startedAt: string
  completedAt?: string
}

export interface AtroposKvRecord {
  kind: 'kv'
  op: 'set' | 'delete' | 'clear'
  key?: string
  value?: unknown
  at: string
}

export type AtroposJournalEntry =
  | AtroposStepRecord
  | AtroposAwakeableRecord
  | AtroposTimerRecord
  | AtroposKvRecord

export interface AtroposActorSnapshot {
  actorId: string
  steps: Map<string, AtroposStepRecord>
  awakeables: Map<string, AtroposAwakeableRecord>
  timers: Map<string, AtroposTimerRecord>
  kv: Map<string, unknown>
}

export interface AtroposContext {
  readonly actorId: string

  /**
   * Run a step durably. If this step has previously succeeded in the journal,
   * its cached outcome is returned immediately without re-executing `fn`.
   */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>

  /**
   * Create a durable awakeable promise waiting for external signal resolution.
   * Survives desktop application restarts.
   */
  awakeable<T>(name?: string): { id: string; promise: Promise<T> }

  /**
   * Sleep for a specific duration durably. Recomputes remaining time across
   * application restarts.
   */
  sleep(name: string, durationMs: number): Promise<void>

  /** Get a value from the durable virtual actor's persistent KV state. */
  get<T>(key: string): Promise<T | undefined>

  /** Set a value in the durable virtual actor's persistent KV state. */
  set<T>(key: string, value: T): Promise<void>

  /** Delete a key from the persistent KV state. */
  delete(key: string): Promise<void>

  /** Clear all keys in the actor's KV state. */
  clear(): Promise<void>
}
