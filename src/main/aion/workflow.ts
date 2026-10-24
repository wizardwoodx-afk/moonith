/**
 * Aion (αἰών, "enduring time") — the durable mission orchestrator.
 *
 * A mission is a bounded, long-running workflow: scan a repository, propose
 * changes, wait for a human, apply them, run the tests, write the report.
 * Aion makes that SURVIVABLE: every transition is appended to a journal on
 * disk BEFORE it takes effect, so a crash — or a quit mid-mission — loses
 * nothing and repeats nothing.
 *
 * THE THREE RULES, in order of importance:
 *
 *   1. NOTHING REPLAYS BLIND. A step that started but never recorded a
 *      result is INTERRUPTED, not retried. Recovery asks the workflow's
 *      reconcile hook what actually happened out there; only a confirmed
 *      success is treated as done. Exactly-once external effects are the
 *      caller's contract to keep via idempotency keys — Aion never assumes.
 *
 *   2. THE JOURNAL IS THE STATE. There is no separate state file to fall out
 *      of sync: status, completed steps, pending approvals, armed timers and
 *      waiting signals are all derived from the appended records.
 *
 *   3. WAITS ARE DURABLE. An approval wait, a timer and a signal all survive
 *      a restart: the wait re-arms from the journal, with the timer's
 *      remaining time recomputed from its recorded due time.
 *
 * The durable-execution design references this layer draws on, and their
 * licences, are recorded in THIRD-PARTY-NOTICES.md; no upstream code is used.
 */
import { randomUUID } from 'node:crypto'

export type MissionStatus =
  | 'running'
  | 'waiting-approval'
  | 'waiting-signal'
  | 'sleeping'
  | 'needs-reconciliation'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface ApprovalRequest {
  title: string
  summary: string
  risk: 'low' | 'medium' | 'high'
}

export interface ApprovalOutcome {
  approved: boolean
  by: string
  at: string
  note?: string
}

export interface StepContext<I> {
  missionId: string
  stepId: string
  input: I
  /** 1 on the first attempt; increments per retry. */
  attempt: number
  /** The step's idempotency key for this input, when it declares one. */
  idempotencyKey: string | null
  /** What earlier steps returned, keyed by step id. Empty for the first
   *  step, and re-derived from the journal on resume — a step must never
   *  assume an in-memory value survived the restart that preceded it. */
  results: Record<string, unknown>
}

export type RetryPolicy = { attempts: number; backoffMs: number }

/**
 * What a step's reconcile hook found out there.
 *
 * 'unknown' is a real answer — the step looked and could not tell — and it
 * settles nothing. The object form lets a step hand back the result it would
 * have returned had it not been interrupted: a step reconciled as done
 * without one leaves every later step that reads `ctx.results` with nothing
 * to read, so a step that can reconstruct its result should.
 */
export type ReconcileVerdict =
  | 'done'
  | 'failed'
  | 'unknown'
  | { resolution: 'done' | 'failed'; result?: unknown }

/** The context a step's idempotency key is derived from: everything about the
 *  attempt except the key itself. A key is usually built from the mission and
 *  the step, so it needs the ids but cannot contain itself. */
export type StepKeyContext<I> = Omit<StepContext<I>, 'idempotencyKey'>

export interface ActionStep<I> {
  id: string
  kind: 'action'
  /** The capability this step exercises (journaled for the audit trail). */
  capability: string
  run: (ctx: StepContext<I>) => Promise<unknown>
  retry?: RetryPolicy
  /** Stable per input: the same key across attempts lets an external system
   *  dedupe, and lets recovery recognise work a prior attempt completed. */
  idempotencyKey?: (ctx: StepKeyContext<I>) => string
  /** Undo for a step that failed after partial effect. */
  compensate?: (ctx: StepContext<I>, error: unknown) => Promise<void>
  /** What actually happened out there, when a crash interrupted this step. */
  reconcile?: (ctx: StepContext<I>) => Promise<ReconcileVerdict>
}

export interface ApprovalStep<I> {
  id: string
  kind: 'approval'
  /** What the human is being asked. Receives the step context so the card can
   *  name what earlier steps actually found. */
  describe: (ctx: StepContext<I>) => ApprovalRequest
}

export interface TimerStep<I> {
  id: string
  kind: 'timer'
  ms: (input: I) => number
}

export interface SignalStep<I> {
  id: string
  kind: 'signal'
  /** The signal name this step waits for. */
  name: string
}

export type WorkflowStep<I> = ActionStep<I> | ApprovalStep<I> | TimerStep<I> | SignalStep<I>

export interface Workflow<I = unknown> {
  id: string
  version: number
  steps: WorkflowStep<I>[]
}

export function defineWorkflow<I>(definition: Workflow<I>): Workflow<I> {
  return definition
}

/* ── the journal ─────────────────────────────────────────────────────────── */

export type JournalRecord =
  | { type: 'mission.started'; missionId: string; workflowId: string; version: number; at: string; input: unknown }
  | { type: 'step.started'; missionId: string; stepId: string; at: string; attempt: number; idempotencyKey: string | null; capability: string | null }
  | { type: 'step.succeeded'; missionId: string; stepId: string; at: string; attempt: number; idempotencyKey: string | null; result?: unknown }
  | { type: 'step.failed'; missionId: string; stepId: string; at: string; attempt: number; error: string; idempotencyKey: string | null }
  | { type: 'step.compensated'; missionId: string; stepId: string; at: string; error: string }
  | { type: 'approval.requested'; missionId: string; stepId: string; at: string; request: ApprovalRequest }
  | { type: 'approval.settled'; missionId: string; stepId: string; at: string; outcome: ApprovalOutcome }
  | { type: 'timer.armed'; missionId: string; stepId: string; at: string; dueAt: string }
  | { type: 'timer.fired'; missionId: string; stepId: string; at: string }
  | { type: 'signal.waiting'; missionId: string; stepId: string; at: string; name: string }
  | { type: 'signal.sent'; missionId: string; stepId: string; at: string; name: string; payload: unknown }
  | { type: 'mission.reconciled'; missionId: string; stepId: string; at: string; resolution: 'done' | 'failed' }
  | { type: 'mission.finished'; missionId: string; at: string; status: Extract<MissionStatus, 'done' | 'failed' | 'cancelled'>; error?: string }

export interface MissionJournal {
  append(record: JournalRecord): Promise<void>
  read(): Promise<JournalRecord[]>
  exists(): Promise<boolean>
}

export function newMissionId(): string {
  return `msn_${randomUUID()}`
}
