/**
 * Aion — the durable mission orchestrator.
 *
 * A mission is a bounded, long-running workflow: scan a repository, propose
 * changes, wait for a human, apply them, run the tests, write the report.
 * This module makes that survivable. Every transition is appended to a
 * journal on disk BEFORE it takes effect, so a crash — or a quit mid-mission
 * — loses nothing and repeats nothing.
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
 *      waiting signals are all derived by folding the appended records.
 *
 *   3. WAITS ARE DURABLE. An approval wait, a timer and a signal all survive
 *      a restart: the wait re-arms from the journal, with the timer's
 *      remaining time recomputed from its recorded due time.
 *
 * Execution parks at waits rather than blocking on them. `drive()` advances
 * a mission until it must stop — an approval, a timer, a signal, an
 * interrupted step, or the end — and returns. That shape is what makes the
 * whole thing re-entrant: `resume()` calls the same `drive()` against state
 * folded from the journal, and a mission that was parked mid-approval picks
 * up at the approval, not at the beginning.
 */
import { join } from 'node:path'
import {
  type ActionStep,
  type ApprovalRequest,
  type JournalRecord,
  type MissionJournal,
  type MissionStatus,
  type StepContext,
  type Workflow,
  type WorkflowStep
} from './workflow'
import { FileMissionJournal, MemoryMissionJournal } from './journal'
import { newMissionId } from './workflow'

/* ── what the fold produces ───────────────────────────────────────────────── */

export type StepRuntimeStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting'

export interface StepRuntime {
  id: string
  kind: WorkflowStep<unknown>['kind']
  status: StepRuntimeStatus
  attempts: number
  /** Set when a step started and never recorded a result. */
  interrupted: boolean
}

export interface PendingApproval {
  stepId: string
  request: ApprovalRequest
  at: string
}

/** Everything the fold produces: what the mission is, right now. */
export interface MissionState<I = unknown> {  missionId: string
  workflowId: string
  version: number
  input: I
  status: MissionStatus
  startedAt: string
  updatedAt: string
  /** Step id -> runtime, in workflow order. */
  steps: StepRuntime[]
  /** Index of the step the mission is parked at or working through. */
  cursor: number
  pendingApproval: PendingApproval | null
  armedTimer: { stepId: string; dueAt: string } | null
  waitingSignal: { stepId: string; name: string } | null
  /** The interrupted step awaiting reconciliation, if any. */
  interruptedStepId: string | null
  /** What each succeeded step returned, keyed by step id. Derived from the
   *  journal, so a resumed mission reads the same values the run that
   *  produced them did — nothing is assumed to have survived in memory. */
  results: Record<string, unknown>
  error: string | null
}

/* ── folding the journal into state ───────────────────────────────────────── */

const TERMINAL: ReadonlySet<MissionStatus> = new Set(['done', 'failed', 'cancelled'])

/** Statuses at which a mission can no longer advance by itself: it is
 *  finished, or it is parked at something only an outside door can move — a
 *  human, a signal, or a reconciliation decision. A sleeping mission is
 *  deliberately absent: it wakes itself when its timer is due. */
const SETTLED: ReadonlySet<MissionStatus> = new Set([
  'done',
  'failed',
  'cancelled',
  'waiting-approval',
  'waiting-signal',
  'needs-reconciliation'
])

function emptyStep<I>(step: WorkflowStep<I>): StepRuntime {
  return { id: step.id, kind: step.kind, status: 'pending', attempts: 0, interrupted: false }
}

/**
 * Fold the journal. Pure, total, and the only source of truth: whatever this
 * returns is what the mission IS, regardless of what any in-memory copy
 * remembers. A record type the fold does not recognise is ignored rather than
 * fatal — a newer journal read by an older build should degrade, not crash.
 */
export function foldMission<I>(
  missionId: string,
  workflow: Workflow<I>,
  input: I,
  records: readonly JournalRecord[]
): MissionState<I> {
  const state: MissionState<I> = {
    missionId,
    workflowId: workflow.id,
    version: workflow.version,
    input,
    status: 'running',
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    steps: workflow.steps.map((step) => emptyStep(step)),
    cursor: 0,
    pendingApproval: null,
    armedTimer: null,
    waitingSignal: null,
    interruptedStepId: null,
    results: {},
    error: null
  }

  const stepById = new Map(state.steps.map((step) => [step.id, step]))
  /* Once a mission is finished it is finished. A record that arrives after
   * the finish — a straggler approval settlement, a timer that fired after
   * the cancel — stays in the journal for audit, but must not resurrect the
   * mission: a cancellation is a decision about the future, not a rewrite
   * of the past. */
  let finished = false

  for (const record of records) {
    if ('at' in record && typeof record.at === 'string') state.updatedAt = record.at
    if (finished) continue

    switch (record.type) {
      case 'mission.started': {
        state.startedAt = record.at
        state.status = 'running'
        break
      }
      case 'step.started': {
        const step = stepById.get(record.stepId)
        if (step) {
          step.status = 'running'
          step.attempts = Math.max(step.attempts, record.attempt)
          step.interrupted = true
          state.interruptedStepId = record.stepId
        }
        break
      }
      case 'step.succeeded': {
        const step = stepById.get(record.stepId)
        if (step) {
          step.status = 'succeeded'
          step.attempts = Math.max(step.attempts, record.attempt)
          step.interrupted = false
          if (state.interruptedStepId === record.stepId) state.interruptedStepId = null
        }
        /* The result is part of the state, not a side note: a later step
         * reads it after a restart exactly as it would have mid-run. */
        if (record.result !== undefined) state.results[record.stepId] = record.result
        break
      }
      case 'step.failed': {
        const step = stepById.get(record.stepId)
        if (step) {
          step.status = 'failed'
          step.attempts = Math.max(step.attempts, record.attempt)
          step.interrupted = false
          if (state.interruptedStepId === record.stepId) state.interruptedStepId = null
        }
        break
      }
      case 'step.compensated': {
        const step = stepById.get(record.stepId)
        if (step) step.status = 'failed'
        break
      }
      case 'approval.requested': {
        const step = stepById.get(record.stepId)
        if (step) step.status = 'waiting'
        state.pendingApproval = { stepId: record.stepId, request: record.request, at: record.at }
        state.status = 'waiting-approval'
        break
      }
      case 'approval.settled': {
        const step = stepById.get(record.stepId)
        state.pendingApproval = null
        /* A granted approval CONSUMES the wait: the step is done, and the
         * cursor must move past it. Marking it pending again would re-arm
         * the very same approval forever. A refusal finishes the mission,
         * with the refusal on the record. */
        if (step) step.status = record.outcome.approved ? 'succeeded' : 'failed'
        state.status = record.outcome.approved ? 'running' : 'failed'
        if (!record.outcome.approved) {
          state.error = record.outcome.note
            ? `refused by ${record.outcome.by}: ${record.outcome.note}`
            : `refused by ${record.outcome.by}`
        }
        break
      }
      case 'timer.armed': {
        const step = stepById.get(record.stepId)
        if (step) step.status = 'waiting'
        state.armedTimer = { stepId: record.stepId, dueAt: record.dueAt }
        state.status = 'sleeping'
        break
      }
      case 'timer.fired': {
        state.armedTimer = null
        /* The wait elapsed, so the timer step is consumed — succeeded, not
         * pending. A pending step would send the cursor straight back here
         * and re-arm the same timer forever. */
        const step = stepById.get(record.stepId)
        if (step) step.status = 'succeeded'
        state.status = 'running'
        break
      }
      case 'signal.waiting': {
        const step = stepById.get(record.stepId)
        if (step) step.status = 'waiting'
        state.waitingSignal = { stepId: record.stepId, name: record.name }
        state.status = 'waiting-signal'
        break
      }
      case 'signal.sent': {
        state.waitingSignal = null
        /* The signal arrived, so the wait is consumed — exactly as a fired
         * timer is. Leaving the step pending would re-park the mission on
         * the same signal forever. */
        const step = stepById.get(record.stepId)
        if (step) step.status = 'succeeded'
        state.status = 'running'
        break
      }
      case 'mission.reconciled': {
        /* An audit record of the decision; the step record that follows it
         * carries the state change, so the fold stays uniform. */
        state.status = 'running'
        break
      }
      case 'mission.finished': {
        state.status = record.status
        if (record.error) state.error = record.error
        /* A finished mission holds no live waits: there is nothing left to
         * approve, nothing armed, nothing to reconcile. Clearing them keeps
         * the state honest and makes the human doors naturally inert. */
        state.pendingApproval = null
        state.armedTimer = null
        state.waitingSignal = null
        state.interruptedStepId = null
        finished = true
        break
      }
      default:
        break
    }

    /* The cursor tracks the first step that is not yet succeeded, so a
     * resumed mission continues at the right place even across a restart. */
    const nextIndex = state.steps.findIndex((step) => step.status !== 'succeeded')
    state.cursor = nextIndex === -1 ? state.steps.length : nextIndex
  }

  /* A journal whose last transition left a step running is interrupted, not
   * failed: the effect may have landed out there. Only a terminal mission
   * record overrides that reading. */
  if (state.interruptedStepId && !TERMINAL.has(state.status)) {
    state.status = 'needs-reconciliation'
  }

  return state
}

/* ── the orchestrator ─────────────────────────────────────────────────────── */

export interface MissionOrchestratorOptions {
  /** Directory the per-mission journals live under. */
  dir: string
  /** Injectable clock, for tests. */
  now?: () => string
  /**
   * Rebuild a mission's runtime input from what the journal kept.
   *
   * A journal is JSON, so it carries data and not functions. A mission whose
   * input includes bindings — a governance gate, a runner, a toolbelt — gets
   * those back as `undefined` when it is adopted after a restart, and then it
   * cannot take a single step. This hook is where they are re-attached.
   */
  resolveInput?: (workflowId: string, journaled: unknown) => unknown
}

interface MissionEntry {
  workflow: Workflow<unknown>
  input: unknown
  journal: MissionJournal
  /** Serialises drives for this mission: two callers must never interleave. */
  chain: Promise<void>
  /** The in-process timer for an armed timer step, when this process armed it. */
  timer: NodeJS.Timeout | null
  /** Aborted when this process cancels the mission. The journal stays the
   *  source of truth (a cancellation by another process is read from it);
   *  this signal only wakes in-flight waits — a retry backoff — promptly. */
  abort: AbortController
}

/**
 * Sleep, unless aborted. Cancellation must not wait out a retry backoff: the
 * mission's chain would stay busy for the whole delay and a cancelled mission
 * would keep a door blocked. The journal check after the sleep is what makes
 * a wake-up safe — this only shortens the wait.
 */
function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    /* A backoff must never hold the process open on quit. */
    timer.unref?.()
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Drives missions to completion, parking at waits.
 *
 * One instance owns one directory of journals. It holds no authoritative
 * state of its own: every read folds the journal, so a fresh instance over
 * the same directory sees exactly the missions the old one left behind.
 */
export class MissionOrchestrator {
  private readonly now: () => string
  private readonly missions = new Map<string, MissionEntry>()
  /** Workflows addressable by id. Value objects: registration makes them
   *  startable, and re-registering an id is how a new version takes effect
   *  for missions started afterwards — running missions keep the version
   *  they were started with. */
  private readonly workflows = new Map<string, Workflow<unknown>>()

  constructor(private readonly options: MissionOrchestratorOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /* ── registration ─────────────────────────────────────────────────────── */

  registerWorkflow<I>(workflow: Workflow<I>): void {
    this.workflows.set(workflow.id, workflow as Workflow<unknown>)
  }

  /** The journal a mission's records live in. Overridden by the in-memory
   *  orchestrator so the engine is exercised without touching a disk. */
  protected makeJournal(missionId: string): MissionJournal {
    return new FileMissionJournal(join(this.options.dir, `${missionId}.jsonl`))
  }

  private entry(missionId: string, workflow: Workflow<unknown>, input: unknown): MissionEntry {
    let found = this.missions.get(missionId)
    if (!found) {
      found = {
        workflow,
        input,
        journal: this.makeJournal(missionId),
        chain: Promise.resolve(),
        timer: null,
        abort: new AbortController()
      }
      this.missions.set(missionId, found)
    }
    return found
  }

  /* ── starting ──────────────────────────────────────────────────────────── */

  /** Start a mission and drive it until it parks or finishes. */
  async start<I>(workflowId: string, input: I): Promise<string> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) throw new Error(`no workflow registered as "${workflowId}"`)
    const missionId = newMissionId()
    const entry = this.entry(missionId, workflow, input)
    await entry.journal.append({
      type: 'mission.started',
      missionId,
      workflowId,
      version: workflow.version,
      at: this.now(),
      input
    })
    await this.drive(missionId)
    return missionId
  }

  /* ── reading ───────────────────────────────────────────────────────────── */

  /** Every mission this orchestrator knows about, newest first. */
  async list(): Promise<MissionState<unknown>[]> {
    const out: MissionState<unknown>[] = []
    for (const missionId of [...this.missions.keys()]) {
      const state = await this.query(missionId)
      if (state) out.push(state)
    }
    return out.reverse()
  }

  /** Adopt missions found on disk that this process has not seen yet. */
  async discover(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises')
    let files: string[] = []
    try {
      files = await readdir(this.options.dir)
    } catch {
      return []
    }
    const adopted: string[] = []
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const missionId = file.slice(0, -'.jsonl'.length)
      if (this.missions.has(missionId)) continue
      const journal = this.makeJournal(missionId)
      const records = await journal.read()
      const started = records.find((record) => record.type === 'mission.started')
      if (!started) continue
      const workflow = this.workflows.get(started.workflowId)
      if (!workflow) continue
      const input = this.options.resolveInput
        ? this.options.resolveInput(started.workflowId, started.input)
        : started.input
      this.missions.set(missionId, {
        workflow,
        input,
        journal,
        chain: Promise.resolve(),
        timer: null,
        abort: new AbortController()
      })
      adopted.push(missionId)
    }
    return adopted
  }

  /* ── the human doors ───────────────────────────────────────────────────── */

  /** Settle a parked approval. Approved drives the mission on from where it
   *  parked; refused finishes it as failed, with the refusal on the record. */
  async approve(
    missionId: string,
    approved: boolean,
    by: string,
    note?: string
  ): Promise<MissionState<unknown> | null> {
    const entry = this.missions.get(missionId)
    if (!entry) return null
    const state = await this.query(missionId)
    /* A finished mission cannot be approved back to life, and a mission with
     * no pending approval has nothing to settle. Both return the state as it
     * stands rather than appending a record that would resurrect it. */
    if (!state || TERMINAL.has(state.status) || !state.pendingApproval) return state
    const at = this.now()
    await entry.journal.append({
      type: 'approval.settled',
      missionId,
      stepId: state.pendingApproval.stepId,
      at,
      outcome: { approved, by, at, note }
    })
    await this.drive(missionId)
    return this.query(missionId)
  }

  /** Finish a mission as cancelled. Steps that already ran stay ran — a
   *  cancellation is a decision about the future, not a rewrite of the past.
   *  The abort signal wakes an in-flight retry backoff and the journal record
   *  makes the cancellation durable; a drive already inside `step.run` cannot
   *  un-run that effect, but it re-checks the journal before it records or
   *  starts anything else, so nothing after the effect is treated as live. */
  async cancel(missionId: string): Promise<MissionState<unknown> | null> {
    const entry = this.missions.get(missionId)
    if (!entry) return null
    const state = await this.query(missionId)
    if (!state || TERMINAL.has(state.status)) return state
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    entry.abort.abort()
    await entry.journal.append({
      type: 'mission.finished',
      missionId,
      at: this.now(),
      status: 'cancelled'
    })
    return this.query(missionId)
  }

  /**
   * Settle an interrupted step. This is the only door out of
   * 'needs-reconciliation', and it exists because a crash mid-step leaves the
   * truth OUTSIDE the journal: the effect may have landed.
   *
   * The caller may say which — 'done' when the work is confirmed complete out
   * there, 'failed' when it is not. When the caller says nothing, the step's
   * own `reconcile` hook is asked, because a step that knows how to look at
   * the world should not need a human to look for it. A hook that answers
   * 'unknown' settles nothing: Aion will not guess, and will not replay on a
   * guess.
   */
  async reconcile(
    missionId: string,
    resolution?: 'done' | 'failed'
  ): Promise<MissionState<unknown> | null> {
    const entry = this.missions.get(missionId)
    if (!entry) return null
    const state = await this.query(missionId)
    if (!state || state.status !== 'needs-reconciliation' || !state.interruptedStepId) return state
    const stepId = state.interruptedStepId
    const attempt = state.steps.find((step) => step.id === stepId)?.attempts ?? 1
    const settled = resolution ? { resolution } : await this.askInterruptedStep(entry, state, stepId, attempt)
    /* No verdict, no change: the mission stays parked for a human rather than
     * being guessed out of the only state that protects the world from a
     * double effect. */
    if (!settled) return state
    const at = this.now()
    await entry.journal.append({
      type: 'mission.reconciled',
      missionId,
      stepId,
      at,
      resolution: settled.resolution
    })
    if (settled.resolution === 'done') {
      await entry.journal.append({
        type: 'step.succeeded',
        missionId,
        stepId,
        at: this.now(),
        attempt,
        idempotencyKey: null,
        result: settled.result
      })
    } else {
      await entry.journal.append({
        type: 'step.failed',
        missionId,
        stepId,
        at: this.now(),
        attempt,
        error: 'interrupted step reconciled as failed',
        idempotencyKey: null
      })
      await entry.journal.append({
        type: 'mission.finished',
        missionId,
        at: this.now(),
        status: 'failed',
        error: 'interrupted step reconciled as failed'
      })
    }
    await this.drive(missionId)
    return this.query(missionId)
  }

  /** Ask the interrupted step's own hook what happened out there. A step with
   *  no hook, a hook that throws, and a hook that answers 'unknown' all leave
   *  the question open — which is an answer, not a failure. */
  private async askInterruptedStep(
    entry: MissionEntry,
    state: MissionState<unknown>,
    stepId: string,
    attempt: number
  ): Promise<{ resolution: 'done' | 'failed'; result?: unknown } | null> {
    const step = entry.workflow.steps.find((candidate) => candidate.id === stepId)
    if (!step || step.kind !== 'action' || !step.reconcile) return null
    try {
      const answer = await step.reconcile({
        missionId: state.missionId,
        stepId,
        input: state.input,
        attempt,
        idempotencyKey: null,
        results: state.results
      })
      if (answer === 'unknown') return null
      if (answer === 'done' || answer === 'failed') return { resolution: answer }
      return answer
    } catch {
      /* A hook that cannot look is a hook that cannot answer. */
      return null
    }
  }

  /** Deliver a signal a mission is parked on. The name must match, or the
   *  signal is ignored — a mission waiting for "tests-done" must not be
   *  woken by "user-spoke". */
  async signal(missionId: string, name: string, payload?: unknown): Promise<MissionState<unknown> | null> {
    const entry = this.missions.get(missionId)
    if (!entry) return null
    const state = await this.query(missionId)
    /* A finished mission holds no live waits, and a mission parked on a
     * different signal must not be woken by this one. */
    if (!state || TERMINAL.has(state.status) || !state.waitingSignal || state.waitingSignal.name !== name) {
      return state
    }
    await entry.journal.append({
      type: 'signal.sent',
      missionId,
      stepId: state.waitingSignal.stepId,
      at: this.now(),
      name,
      payload
    })
    await this.drive(missionId)
    return this.query(missionId)
  }

  /** Re-drive a mission from its journal. Safe on any non-terminal mission:
   *  a parked one continues at its wait, an interrupted one stays parked for
   *  reconciliation rather than replaying. */
  async resume(missionId: string): Promise<MissionState<unknown> | null> {
    const entry = this.missions.get(missionId)
    if (!entry) return null
    await this.drive(missionId)
    return this.query(missionId)
  }

  /** Adopt everything on disk and drive whatever is drivable. Called at app
   *  start: missions parked at an approval come back parked at it, armed
   *  timers re-arm with their remaining time, and interrupted ones are given
   *  one chance to settle themselves through their reconcile hook — the ones
   *  that cannot answer come back marked for reconciliation. None of them
   *  replay. */
  async resumeAll(): Promise<string[]> {
    const adopted = await this.discover()
    const driven: string[] = []
    for (const missionId of this.missions.keys()) {
      const state = await this.query(missionId)
      if (!state || TERMINAL.has(state.status)) continue
      if (state.status === 'needs-reconciliation') {
        const settled = await this.reconcile(missionId)
        /* Still parked means the step could not say. Leave it for the human
         * rather than counting it as driven. */
        if (!settled || settled.status === 'needs-reconciliation') continue
        driven.push(missionId)
        continue
      }
      await this.drive(missionId)
      driven.push(missionId)
    }
    return driven.length ? driven : adopted
  }

  /**
   * Wait until a mission SETTLES — it finishes, or it parks at a wait that
   * only an outside door can move — or the timeout passes. For tests and for
   * the one caller that genuinely needs to block.
   */
  async waitFor(missionId: string, timeoutMs = 30_000, pollMs = 25): Promise<MissionState<unknown> | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const state = await this.query(missionId)
      if (!state) return null
      if (SETTLED.has(state.status)) return state
      if (Date.now() >= deadline) return state
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  /* ── the engine ────────────────────────────────────────────────────────── */

  /** Fold one mission's journal. */
  async query<I = unknown>(missionId: string): Promise<MissionState<I> | null> {
    const entry = this.missions.get(missionId)
    if (!entry) return null
    const records = await entry.journal.read()
    if (records.length === 0) return null
    return foldMission<I>(missionId, entry.workflow as Workflow<I>, entry.input as I, records)
  }

  /** Advance a mission until it must stop. Re-entrant and serialised per
   *  mission: concurrent callers queue rather than interleave appends. */
  private async drive(missionId: string): Promise<void> {
    const entry = this.missions.get(missionId)
    if (!entry) return
    const run = entry.chain.then(() => this.driveOnce(missionId, entry))
    /* The chain must survive a failed drive, or one bad step wedges the
     * mission forever. The failure is already on the journal as a failed
     * step or a failed mission; swallowing it here only stops the cascade. */
    entry.chain = run.then(
      () => undefined,
      () => undefined
    )
    await run
  }

  private async driveOnce(missionId: string, entry: MissionEntry): Promise<void> {
    /* The guard is a seatbelt, not a design assumption: a workflow whose
     * steps never advance the cursor must not spin forever. */
    for (let turn = 0; turn < 1000; turn += 1) {
      /* Cancelled in this process: the journal record is already there (or is
       * being appended by cancel()), and nothing more may run. */
      if (entry.abort.signal.aborted) return
      const state = await this.query(missionId)
      if (!state || TERMINAL.has(state.status)) return

      /* Parked at a human, or at a signal: only the matching door moves it. */
      if (state.status === 'waiting-approval' || state.status === 'waiting-signal') return

      /* Interrupted: the truth is outside the journal. Never guess. */
      if (state.status === 'needs-reconciliation') return

      if (state.armedTimer) {
        const due = Date.parse(state.armedTimer.dueAt)
        const remaining = Number.isFinite(due) ? due - Date.now() : 0
        if (remaining <= 0) {
          await entry.journal.append({
            type: 'timer.fired',
            missionId,
            stepId: state.armedTimer.stepId,
            at: this.now()
          })
          continue
        }
        this.scheduleWake(missionId, entry, remaining)
        return
      }

      const step = entry.workflow.steps[state.cursor]
      if (!step) {
        if (entry.timer) {
          clearTimeout(entry.timer)
          entry.timer = null
        }
        await entry.journal.append({
          type: 'mission.finished',
          missionId,
          at: this.now(),
          status: 'done'
        })
        return
      }

      if (step.kind === 'action') {
        const advanced = await this.runAction(missionId, entry, step, state)
        if (!advanced) return
        continue
      }
      if (step.kind === 'approval') {
        /* The card is built from what earlier steps actually produced, so it
         * names the real proposal rather than a placeholder. */
        await entry.journal.append({
          type: 'approval.requested',
          missionId,
          stepId: step.id,
          at: this.now(),
          request: step.describe({
            missionId,
            stepId: step.id,
            input: state.input,
            attempt: 1,
            idempotencyKey: null,
            results: state.results
          })
        })
        return
      }
      if (step.kind === 'timer') {
        const ms = step.ms(state.input)
        await entry.journal.append({
          type: 'timer.armed',
          missionId,
          stepId: step.id,
          at: this.now(),
          dueAt: new Date(Date.now() + ms).toISOString()
        })
        continue
      }
      /* signal */
      await entry.journal.append({
        type: 'signal.waiting',
        missionId,
        stepId: step.id,
        at: this.now(),
        name: step.name
      })
      return
    }
  }

  /**
   * True when this mission must not advance: cancelled in this process (the
   * abort signal) or cancelled out there (the journal — the source of truth,
   * so a cancellation from another process is seen too).
   */
  private async isCancelled(missionId: string, entry: MissionEntry): Promise<boolean> {
    if (entry.abort.signal.aborted) return true
    const state = await this.query(missionId)
    return !state || state.status === 'cancelled'
  }

  /** Run one action step: journal the start BEFORE the effect, the result
   *  AFTER it. A step that started and never recorded a result is left
   *  interrupted by construction — the journal simply has no result line.
   *
   *  Cancellation is checked as close to the effect as possible: before the
   *  start record, immediately before `step.run`, and IMMEDIATELY after it
   *  returns. The middle check can only stop a step that has not begun; the
   *  last one is what keeps an effect that finished during a cancellation
   *  from being recorded as a live outcome. An interrupted step is still
   *  never replayed blind — reconciliation semantics are unchanged. */
  private async runAction(
    missionId: string,
    entry: MissionEntry,
    step: ActionStep<unknown>,
    state: MissionState<unknown>
  ): Promise<boolean> {
    if (await this.isCancelled(missionId, entry)) return false
    const runtime = state.steps.find((candidate) => candidate.id === step.id)
    const attempt = (runtime?.attempts ?? 0) + 1
    const idempotencyKey = step.idempotencyKey
      ? step.idempotencyKey({ missionId, stepId: step.id, input: state.input, attempt, results: state.results })
      : null
    const ctx: StepContext<unknown> = {
      missionId,
      stepId: step.id,
      input: state.input,
      attempt,
      idempotencyKey,
      results: state.results
    }

    await entry.journal.append({
      type: 'step.started',
      missionId,
      stepId: step.id,
      at: this.now(),
      attempt,
      idempotencyKey,
      capability: step.capability
    })

    /* A cancellation that landed while the start record was being written:
     * do not cross into the effect at all. */
    if (await this.isCancelled(missionId, entry)) return false

    try {
      const result = await step.run(ctx)
      /* The effect completed, but the mission was cancelled while it ran: the
       * result is NOT a live outcome of a cancelled mission, so it is not
       * recorded as a success. The step's start line stays for the audit
       * trail, and the finish record keeps the cancellation authoritative. */
      if (await this.isCancelled(missionId, entry)) return false
      await entry.journal.append({
        type: 'step.succeeded',
        missionId,
        stepId: step.id,
        at: this.now(),
        attempt,
        idempotencyKey,
        result
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (await this.isCancelled(missionId, entry)) return false
      const policy = step.retry
      await entry.journal.append({
        type: 'step.failed',
        missionId,
        stepId: step.id,
        at: this.now(),
        attempt,
        error: message,
        idempotencyKey
      })

      const canRetry = policy ? attempt < policy.attempts : false
      if (canRetry && policy) {
        /* A cancellable backoff: cancel() aborts the signal and this wakes
         * immediately instead of sleeping out the whole delay. */
        await sleepUnlessAborted(policy.backoffMs, entry.abort.signal)
        if (await this.isCancelled(missionId, entry)) return false
        return true
      }

      /* Compensation is best-effort and journalled: a partial effect that
       * could not be undone is a fact the record must carry. */
      if (step.compensate) {
        try {
          await step.compensate(ctx, error)
          await entry.journal.append({
            type: 'step.compensated',
            missionId,
            stepId: step.id,
            at: this.now(),
            error: message
          })
        } catch {
          /* the failed step above already records the failure */
        }
      }

      await entry.journal.append({
        type: 'mission.finished',
        missionId,
        at: this.now(),
        status: 'failed',
        error: message
      })
      return false
    }
  }

  /** Arm an in-process wake for a timer this process armed. A timer armed by
   *  a previous process is re-derived from its due time on resumeAll, so a
   *  restart never loses the wait — only the wake-up call needs re-scheduling. */
  private scheduleWake(missionId: string, entry: MissionEntry, remainingMs: number): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void this.drive(missionId)
    }, Math.max(0, remainingMs))
    /* A pending timer must not hold the process open on quit. */
    entry.timer.unref?.()
  }
}

/** In-memory orchestrator for probes and tests: same engine, no disk. Every
 *  mission gets its own in-memory journal, so a test can inspect exactly what
 *  a mission appended without touching the filesystem. */
export class MemoryMissionOrchestrator extends MissionOrchestrator {
  private readonly journals = new Map<string, MemoryMissionJournal>()

  constructor(now?: () => string) {
    super({ dir: ':memory:', now })
  }

  protected override makeJournal(missionId: string): MissionJournal {
    let journal = this.journals.get(missionId)
    if (!journal) {
      journal = new MemoryMissionJournal()
      this.journals.set(missionId, journal)
    }
    return journal
  }

  /** The records a mission appended, for assertions. */
  recordsFor(missionId: string): JournalRecord[] {
    return this.journals.get(missionId)?.records ?? []
  }

  override async discover(): Promise<string[]> {
    return []
  }
}
