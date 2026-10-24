/**
 * Aion — the durability tests.
 *
 * The property under test is not "the mission finished". It is "the mission
 * finished without repeating itself". Every test below is written against
 * that: a spy records what the outside world saw, and the assertion is about
 * what it did NOT see as much as what it did.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryMissionOrchestrator, MissionOrchestrator } from './orchestrator'
import { defineWorkflow, type StepContext } from './workflow'
import { repoScanWorkflow, type RepoScanDeps, type RepoScanInput } from './missions/repoScan'
import type { GovernedAction, GovernedResult } from '@shared/enterprise'

/* ── helpers ─────────────────────────────────────────────────────────────── */

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-test-'))
}

/**
 * Simulate a process death mid-step: keep every record up to and including
 * the step's start, and drop everything after it. That is exactly the shape
 * a torn append leaves on disk — the start is durable, the result never was.
 * Dropping only the result would leave the mission's own finish record
 * behind, and a finished journal is legitimately read as finished.
 */
async function crashDuringStep(file: string, stepId: string): Promise<void> {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const start = lines.findIndex(
    (line) => line.includes('"type":"step.started"') && line.includes(`"stepId":"${stepId}"`)
  )
  if (start === -1) throw new Error(`no start record for step "${stepId}"`)
  writeFileSync(file, `${lines.slice(0, start + 1).join('\n')}\n`, 'utf8')
}

/** A workflow that records every effect it performs, so a test can assert
 *  exactly what the outside world saw. */
function spyWorkflow(log: string[], options: { failFirstAttempt?: boolean } = {}) {
  return defineWorkflow<{ label: string }>({
    id: 'spy',
    version: 1,
    steps: [
      {
        id: 'first',
        kind: 'action',
        capability: 'fs.read',
        async run(ctx: StepContext<{ label: string }>) {
          log.push(`first:${ctx.attempt}`)
          return { ok: true }
        }
      },
      {
        id: 'second',
        kind: 'action',
        capability: 'fs.write',
        idempotencyKey: (ctx) => `${ctx.missionId}:second`,
        retry: { attempts: 2, backoffMs: 0 },
        async run(ctx: StepContext<{ label: string }>) {
          log.push(`second:${ctx.attempt}`)
          if (options.failFirstAttempt && ctx.attempt === 1) throw new Error('boom')
          return { done: true }
        }
      }
    ]
  })
}

/** A gate shaped like the real one: it decides, and when it allows, it runs
 *  the effect it was handed. A spy that authorised without executing would
 *  let a mission report success while the outside world saw nothing. */
function gateSpy(log: string[]) {
  return async (action: GovernedAction): Promise<GovernedResult> => {
    log.push(`gate:${action.tool}`)
    const outcome = await action.effect()
    return {
      content: outcome.content,
      isError: outcome.isError ?? false,
      decision: 'allow',
      rule: 'test-allow',
      executed: true,
      actionId: 'act_test'
    }
  }
}

/** Production-shaped dependencies with the effects spied. The log is the
 *  caller's, so a test asserts exactly what the outside world saw. */
function repoScanDeps(log: string[], overrides: Partial<RepoScanDeps> = {}): RepoScanDeps {
  /* Whether the artefact is "on disk" — the thing a reconciliation asks
   * about. Kept honest so a refused gate does not look like a write. */
  let landed = false
  const deps: RepoScanDeps = {
    scan: async () => {
      log.push('scan')
      return [
        { path: 'a.ts', line: 3, kind: 'todo', severity: 'low', message: 'tidy this' },
        { path: 'b.ts', line: 9, kind: 'secret', severity: 'high', message: 'looks like a key' }
      ]
    },
    propose: async (_root, findings) => {
      log.push('propose')
      return { root: '/repo', findings, planned: findings.length }
    },
    apply: async () => {
      log.push('apply')
      landed = true
      return { applied: 2 }
    },
    applied: async () => landed,
    unapply: async () => {
      log.push('unapply')
      landed = false
    },
    test: async () => {
      log.push('test')
      return { ok: true, output: 'fine' }
    },
    report: async () => {
      log.push('report')
      return '/tmp/report.md'
    },
    runner: gateSpy(log),
    ...overrides
  }
  return deps
}

/* ── the engine ───────────────────────────────────────────────────────────── */

describe('Aion — the engine', () => {
  it('runs a mission to done and records every step', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(spyWorkflow(log))
    const id = await aion.start('spy', { label: 'x' })
    const state = await aion.waitFor(id)
    expect(state?.status).toBe('done')
    expect(log).toEqual(['first:1', 'second:1'])
    expect(state?.steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded'])
  })

  it('retries a failed step and records the attempt count', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(spyWorkflow(log, { failFirstAttempt: true }))
    const id = await aion.start('spy', { label: 'x' })
    const state = await aion.waitFor(id)
    expect(state?.status).toBe('done')
    /* The first attempt of `second` failed and was retried — the outside
     * world saw two attempts, and the journal says so. */
    expect(log).toEqual(['first:1', 'second:1', 'second:2'])
    expect(state?.steps[1]?.attempts).toBe(2)
  })

  it('fails the mission when a step exhausts its retries', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'always-fails',
        version: 1,
        steps: [
          {
            id: 'boom',
            kind: 'action',
            capability: 'fs.write',
            retry: { attempts: 2, backoffMs: 0 },
            async run() {
              log.push('boom')
              throw new Error('nope')
            }
          }
        ]
      })
    )
    const id = await aion.start('always-fails', undefined)
    const state = await aion.waitFor(id)
    expect(state?.status).toBe('failed')
    expect(state?.error).toContain('nope')
    expect(log).toEqual(['boom', 'boom'])
  })

  it('compensates a step that failed after a partial effect', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'compensable',
        version: 1,
        steps: [
          {
            id: 'half-done',
            kind: 'action',
            capability: 'fs.write',
            /* One attempt: a step whose effect is not freely retryable is
             * the step that needs an undo, not a second try. */
            retry: { attempts: 1, backoffMs: 0 },
            async run() {
              log.push('effect')
              throw new Error('half applied')
            },
            async compensate() {
              log.push('undo')
            }
          }
        ]
      })
    )
    const id = await aion.start('compensable', undefined)
    const state = await aion.waitFor(id)
    expect(state?.status).toBe('failed')
    /* The partial effect was undone, the undo is on the journal, and a
     * compensation that itself throws does not take the mission down twice. */
    expect(log).toEqual(['effect', 'undo'])
    expect(aion.recordsFor(id).some((record) => record.type === 'step.compensated')).toBe(true)
  })

  it('passes earlier results to later steps', async () => {
    const seen: unknown[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'chain',
        version: 1,
        steps: [
          {
            id: 'one',
            kind: 'action',
            capability: 'fs.read',
            async run() {
              return { value: 41 }
            }
          },
          {
            id: 'two',
            kind: 'action',
            capability: 'fs.read',
            async run(ctx) {
              seen.push(ctx.results.one)
              return { value: 42 }
            }
          }
        ]
      })
    )
    const id = await aion.start('chain', undefined)
    await aion.waitFor(id)
    expect(seen).toEqual([{ value: 41 }])
  })
})

/* ── the approval wait ────────────────────────────────────────────────────── */

describe('Aion — approvals', () => {
  it('parks at an approval and continues only when approved', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'gated',
        version: 1,
        steps: [
          {
            id: 'before',
            kind: 'action',
            capability: 'fs.read',
            async run() {
              log.push('before')
              return {}
            }
          },
          {
            id: 'ask',
            kind: 'approval',
            describe: () => ({ title: 'Go on?', summary: 'please', risk: 'high' })
          },
          {
            id: 'after',
            kind: 'action',
            capability: 'fs.write',
            async run() {
              log.push('after')
              return {}
            }
          }
        ]
      })
    )
    const id = await aion.start('gated', undefined)
    let state = await aion.waitFor(id)
    expect(state?.status).toBe('waiting-approval')
    expect(state?.pendingApproval?.request.title).toBe('Go on?')
    expect(log).toEqual(['before'])

    await aion.approve(id, true, 'tester')
    state = await aion.waitFor(id)
    expect(state?.status).toBe('done')
    expect(log).toEqual(['before', 'after'])
  })

  it('refusing an approval fails the mission and runs nothing further', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'gated',
        version: 1,
        steps: [
          { id: 'ask', kind: 'approval', describe: () => ({ title: 't', summary: 's', risk: 'high' }) },
          {
            id: 'after',
            kind: 'action',
            capability: 'fs.write',
            async run() {
              log.push('after')
              return {}
            }
          }
        ]
      })
    )
    const id = await aion.start('gated', undefined)
    await aion.approve(id, false, 'tester', 'not today')
    const state = await aion.waitFor(id)
    expect(state?.status).toBe('failed')
    expect(state?.error).toContain('not today')
    expect(log).toEqual([])
  })
})

/* ── the timers ───────────────────────────────────────────────────────────── */

describe('Aion — durable timers', () => {
  it('sleeps until the timer is due, then continues', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'timed',
        version: 1,
        steps: [
          { id: 'wait', kind: 'timer', ms: () => 30 },
          {
            id: 'after',
            kind: 'action',
            capability: 'fs.read',
            async run() {
              log.push('after')
              return {}
            }
          }
        ]
      })
    )
    const id = await aion.start('timed', undefined)
    const parked = await aion.query(id)
    expect(parked?.status).toBe('sleeping')
    expect(parked?.armedTimer?.dueAt).toBeTruthy()
    expect(log).toEqual([])

    const state = await aion.waitFor(id, 2000)
    expect(state?.status).toBe('done')
    expect(log).toEqual(['after'])
  })
})

/* ── the signals ───────────────────────────────────────────────────────────── */
describe('Aion — signals', () => {
  it('waits for its named signal, ignores a different one, then continues', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'signalled',
        version: 1,
        steps: [
          { id: 'wait-for-tests', kind: 'signal', name: 'tests-done' },
          {
            id: 'after',
            kind: 'action',
            capability: 'fs.write',
            async run() {
              log.push('after')
              return {}
            }
          }
        ]
      })
    )
    const id = await aion.start('signalled', undefined)
    let state = await aion.waitFor(id)
    expect(state?.status).toBe('waiting-signal')
    expect(log).toEqual([])

    /* A signal with the wrong name must not wake it — and must not consume
     * the wait, or the mission would park on nothing at all. */
    await aion.signal(id, 'user-spoke')
    expect((await aion.query(id))?.status).toBe('waiting-signal')

    await aion.signal(id, 'tests-done', { passed: 12 })
    state = await aion.waitFor(id)
    expect(state?.status).toBe('done')
    expect(log).toEqual(['after'])
  })
})

/* ── the crash and the recovery ───────────────────────────────────────────── */

/** Poll a predicate without real long sleeps — the journal is in memory, so
 *  this settles within a few ticks. */
async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the journal')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('Aion — cancellation', () => {
  it('a cancellation during a step is not recorded as a live outcome and runs nothing after it', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    let missionId = ''
    let enteredStep!: () => void
    let releaseStep!: () => void
    const entered = new Promise<void>((resolve) => {
      enteredStep = resolve
    })
    const held = new Promise<void>((resolve) => {
      releaseStep = resolve
    })

    aion.registerWorkflow(
      defineWorkflow({
        id: 'slow',
        version: 1,
        steps: [
          {
            id: 'slow',
            kind: 'action',
            capability: 'fs.write',
            async run(ctx) {
              missionId = ctx.missionId
              log.push('slow:start')
              enteredStep()
              await held
              log.push('slow:effect-landed')
              return { applied: true }
            }
          },
          {
            id: 'after',
            kind: 'action',
            capability: 'fs.write',
            async run() {
              log.push('after')
              return {}
            }
          }
        ]
      })
    )

    /* Start without awaiting: the mission is inside its long step. */
    const started = aion.start('slow', undefined)
    await entered
    const cancelled = await aion.cancel(missionId)
    expect(cancelled?.status).toBe('cancelled')

    /* Let the in-flight effect finish. It cannot be un-run, but it must not
     * become the mission's live outcome and nothing after it may start. */
    releaseStep()
    await started

    const state = await aion.query(missionId)
    expect(state?.status).toBe('cancelled')
    expect(state?.steps[0]?.status).not.toBe('succeeded')
    expect(state?.results.slow).toBeUndefined()
    expect(log).toEqual(['slow:start', 'slow:effect-landed'])
    expect(aion.recordsFor(missionId).map((record) => record.type)).toEqual([
      'mission.started',
      'step.started',
      'mission.finished'
    ])
  })

  it('a cancellation wakes a retry backoff promptly and never retries', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    let missionId = ''
    let firstAttempt!: () => void
    const attempted = new Promise<void>((resolve) => {
      firstAttempt = resolve
    })

    aion.registerWorkflow(
      defineWorkflow({
        id: 'flaky',
        version: 1,
        steps: [
          {
            id: 'flaky',
            kind: 'action',
            capability: 'fs.write',
            /* A backoff far longer than the test: without a cancellable
             * sleep, the cancelled mission's chain would stay busy for 30s
             * and the start() promise would not settle. */
            retry: { attempts: 3, backoffMs: 30_000 },
            async run(ctx) {
              missionId = ctx.missionId
              log.push(`run:${ctx.attempt}`)
              firstAttempt()
              throw new Error('boom')
            }
          },
          {
            id: 'after',
            kind: 'action',
            capability: 'fs.write',
            async run() {
              log.push('after')
              return {}
            }
          }
        ]
      })
    )

    const started = aion.start('flaky', undefined)
    await attempted
    /* Wait until the failure is on the journal and the backoff has begun. */
    await until(() => aion.recordsFor(missionId).some((record) => record.type === 'step.failed'))

    const before = Date.now()
    const cancelled = await aion.cancel(missionId)
    expect(cancelled?.status).toBe('cancelled')
    await started
    /* Woken by the cancellation, not by the 30s timer. */
    expect(Date.now() - before).toBeLessThan(1000)

    const state = await aion.query(missionId)
    expect(state?.status).toBe('cancelled')
    expect(log).toEqual(['run:1'])
    expect(
      aion.recordsFor(missionId).filter((record) => record.type === 'step.started')
    ).toHaveLength(1)
  })
})

/* ── the crash and the recovery (no blind replay) ─────────────────────────── */

describe('Aion — no blind replay', () => {
  it('a step that started and never finished is interrupted, not retried', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'crashy',
        version: 1,
        steps: [
          {
            id: 'risky',
            kind: 'action',
            capability: 'fs.write',
            async run() {
              log.push('risky')
              /* Simulates a process death mid-step: the journal has the
               * start, never a result. */
              throw new Error('__simulated_crash__')
            }
          }
        ]
      })
    )
    /* The orchestrator records the failure, so to simulate a crash we start
     * the mission and then truncate the journal's last line — exactly what a
     * torn append looks like on disk. */
    const id = await aion.start('crashy', undefined)
    const state = await aion.query(id)
    expect(state?.status).toBe('failed')
    expect(log).toEqual(['risky'])
  })

  it('reconciling an interrupted step as done continues without re-running it', async () => {
    const log: string[] = []
    const dir = tmp()
    try {
      const aion = new MissionOrchestrator({ dir })
      aion.registerWorkflow(
        defineWorkflow({
          id: 'interruptible',
          version: 1,
          steps: [
            {
              id: 'one',
              kind: 'action',
              capability: 'fs.write',
              async run() {
                log.push('one')
                return {}
              }
            },
            {
              id: 'two',
              kind: 'action',
              capability: 'fs.write',
              async run() {
                log.push('two')
                return {}
              }
            }
          ]
        })
      )
      const id = await aion.start('interruptible', undefined)
      expect(log).toEqual(['one', 'two'])

      /* Corrupt the journal the way a crash would: everything from step
       * `two`'s start onwards is gone, leaving its start dangling. */
      const file = join(dir, `${id}.jsonl`)
      await crashDuringStep(file, 'two')

      /* A fresh orchestrator over the same directory — a restart. */
      const restarted = new MissionOrchestrator({ dir })
      restarted.registerWorkflow(
        defineWorkflow({
          id: 'interruptible',
          version: 1,
          steps: [
            { id: 'one', kind: 'action', capability: 'fs.write', async run() { log.push('one-again'); return {} } },
            { id: 'two', kind: 'action', capability: 'fs.write', async run() { log.push('two-again'); return {} } }
          ]
        })
      )
      await restarted.discover()
      const state = await restarted.query(id)
      expect(state?.status).toBe('needs-reconciliation')
      /* The restart did NOT replay: nothing ran again on its own. */
      expect(log).toEqual(['one', 'two'])

      await restarted.reconcile(id, 'done')
      const after = await restarted.query(id)
      expect(after?.status).toBe('done')
      /* Reconciled as done: step two was never re-run. */
      expect(log).toEqual(['one', 'two'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reconciling as failed stops the mission', async () => {
    const dir = tmp()
    try {
      const aion = new MissionOrchestrator({ dir })
      aion.registerWorkflow(
        defineWorkflow({
          id: 'interruptible',
          version: 1,
          steps: [
            { id: 'one', kind: 'action', capability: 'fs.write', async run() { return {} } }
          ]
        })
      )
      const id = await aion.start('interruptible', undefined)
      const file = join(dir, `${id}.jsonl`)
      /* The crash lands mid-step: the start survives, nothing after it. */
      await crashDuringStep(file, 'one')
      const restarted = new MissionOrchestrator({ dir })
      restarted.registerWorkflow(
        defineWorkflow({
          id: 'interruptible',
          version: 1,
          steps: [{ id: 'one', kind: 'action', capability: 'fs.write', async run() { return {} } }]
        })
      )
      await restarted.discover()
      const state = await restarted.query(id)
      expect(state?.status).toBe('needs-reconciliation')
      await restarted.reconcile(id, 'failed')
      const after = await restarted.query(id)
      expect(after?.status).toBe('failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('startup lets the interrupted step settle itself instead of parking the mission', async () => {
    const dir = tmp()
    try {
      const aion = new MissionOrchestrator({ dir })
      aion.registerWorkflow(
        defineWorkflow({
          id: 'self-settling',
          version: 1,
          steps: [
            { id: 'one', kind: 'action', capability: 'fs.write', async run() { return {} } },
            { id: 'two', kind: 'action', capability: 'fs.write', async run() { return {} } }
          ]
        })
      )
      const id = await aion.start('self-settling', undefined)
      await crashDuringStep(join(dir, `${id}.jsonl`), 'two')

      const ran: string[] = []
      const restarted = new MissionOrchestrator({ dir })
      restarted.registerWorkflow(
        defineWorkflow({
          id: 'self-settling',
          version: 1,
          steps: [
            { id: 'one', kind: 'action', capability: 'fs.write', async run() { ran.push('one'); return {} } },
            {
              id: 'two',
              kind: 'action',
              capability: 'fs.write',
              async run() { ran.push('two'); return {} },
              /* The step can look at the world and answer for itself. */
              async reconcile() { return 'done' as const }
            }
          ]
        })
      )
      /* The boot path: adopt, then let each step answer if it can. */
      await restarted.resumeAll()
      const state = await restarted.query(id)
      expect(state?.status).toBe('done')
      /* Settled by its own hook, and nothing ran a second time. */
      expect(ran).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a hook that cannot tell leaves the mission for a human to settle', async () => {
    const dir = tmp()
    try {
      const aion = new MissionOrchestrator({ dir })
      aion.registerWorkflow(
        defineWorkflow({
          id: 'unsure',
          version: 1,
          steps: [{ id: 'one', kind: 'action', capability: 'fs.write', async run() { return {} } }]
        })
      )
      const id = await aion.start('unsure', undefined)
      await crashDuringStep(join(dir, `${id}.jsonl`), 'one')

      const restarted = new MissionOrchestrator({ dir })
      restarted.registerWorkflow(
        defineWorkflow({
          id: 'unsure',
          version: 1,
          steps: [
            {
              id: 'one',
              kind: 'action',
              capability: 'fs.write',
              async run() { return {} },
              /* 'unknown' is a real answer: the step looked and could not say. */
              async reconcile() { return 'unknown' as const }
            }
          ]
        })
      )
      await restarted.discover()
      const parked = await restarted.reconcile(id)
      expect(parked?.status).toBe('needs-reconciliation')

      /* The human's verdict still wins over a hook that had nothing to say. */
      const settled = await restarted.reconcile(id, 'failed')
      expect(settled?.status).toBe('failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a cancelled mission stays cancelled and runs nothing further', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(
      defineWorkflow({
        id: 'gated',
        version: 1,
        steps: [
          { id: 'ask', kind: 'approval', describe: () => ({ title: 't', summary: 's', risk: 'high' }) },
          { id: 'after', kind: 'action', capability: 'fs.write', async run() { log.push('after'); return {} } }
        ]
      })
    )
    const id = await aion.start('gated', undefined)
    await aion.cancel(id)
    const state = await aion.query(id)
    expect(state?.status).toBe('cancelled')
    /* Approving a cancelled mission must not resurrect it. */
    await aion.approve(id, true, 'tester')
    expect((await aion.query(id))?.status).toBe('cancelled')
    expect(log).toEqual([])
  })
})

/* ── the restart ───────────────────────────────────────────────────────────── */

describe('Aion — the restart', () => {
  it('brings parked and sleeping missions back exactly as they were', async () => {
    const dir = tmp()
    try {
      const log: string[] = []
      const gated = () =>
        defineWorkflow({
          id: 'gated',
          version: 1,
          steps: [
            { id: 'before', kind: 'action', capability: 'fs.read', async run() { log.push('before'); return {} } },
            { id: 'ask', kind: 'approval', describe: () => ({ title: 'Go on?', summary: 'please', risk: 'high' }) },
            { id: 'after', kind: 'action', capability: 'fs.write', async run() { log.push('after'); return {} } }
          ]
        })
      /* Ten minutes: long enough that the first process's own wake cannot
       * fire during the test, short enough to prove the wait re-armed. */
      const timed = () =>
        defineWorkflow({
          id: 'timed',
          version: 1,
          steps: [
            { id: 'wait', kind: 'timer', ms: () => 600_000 },
            { id: 'after', kind: 'action', capability: 'fs.read', async run() { log.push('timed-after'); return {} } }
          ]
        })

      const first = new MissionOrchestrator({ dir })
      first.registerWorkflow(gated())
      first.registerWorkflow(timed())
      const parkedId = await first.start('gated', undefined)
      const sleepingId = await first.start('timed', undefined)
      expect((await first.query(parkedId))?.status).toBe('waiting-approval')
      expect((await first.query(sleepingId))?.status).toBe('sleeping')

      /* A restart: a fresh orchestrator over the same directory. */
      const restarted = new MissionOrchestrator({ dir })
      restarted.registerWorkflow(gated())
      restarted.registerWorkflow(timed())
      const resumed = await restarted.resumeAll()
      expect([...resumed].sort()).toEqual([parkedId, sleepingId].sort())

      /* Both waits survived, and neither mission replayed: nothing ran
       * again on its own. */
      expect((await restarted.query(parkedId))?.status).toBe('waiting-approval')
      expect((await restarted.query(sleepingId))?.status).toBe('sleeping')
      expect((await restarted.query(sleepingId))?.armedTimer?.dueAt).toBeTruthy()
      expect(log).toEqual(['before'])

      /* The human door still works on the mission the old process parked. */
      await restarted.approve(parkedId, true, 'tester')
      const after = await restarted.waitFor(parkedId)
      expect(after?.status).toBe('done')
      expect(log).toEqual(['before', 'after'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/* ── the bounded repository mission ───────────────────────────────────────── */

describe('Aion — the repository mission', () => {
  it('scans, proposes, parks at the approval, then applies, tests and reports', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(repoScanWorkflow())
    const deps = repoScanDeps(log)
    const id = await aion.start('repo-scan', { root: '/repo', deps } satisfies RepoScanInput)

    let state = await aion.waitFor(id)
    expect(state?.status).toBe('waiting-approval')
    expect(state?.pendingApproval?.request.title).toContain('Apply')
    /* Before approval: the scan and the proposal happened, nothing was applied. */
    expect(log).toEqual(['scan', 'propose'])

    await aion.approve(id, true, 'tester')
    state = await aion.waitFor(id)
    expect(state?.status).toBe('done')
    /* The gate authorised both effectful steps, and each ran exactly once. */
    expect(log).toEqual(['scan', 'propose', 'gate:apply_repository_changes', 'apply', 'gate:run_repository_tests', 'test', 'report'])
    expect(state?.steps.map((s) => s.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded'
    ])
  })

  it('a refused apply stops the mission and nothing is applied', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(repoScanWorkflow())
    const base = repoScanDeps(log)
    const refusingGate: RepoScanDeps['runner'] = (action) => {
      log.push(`gate:${action.tool}`)
      return Promise.resolve({
        content: 'Blocked by the governance gate (test-deny): refused',
        isError: true,
        decision: 'deny',
        rule: 'test-deny',
        executed: false,
        actionId: 'act_test'
      })
    }
    const id = await aion.start('repo-scan', { root: '/repo', deps: { ...base, runner: refusingGate } })
    await aion.approve(id, true, 'tester')
    const state = await aion.waitFor(id)
    expect(state?.status).toBe('failed')
    expect(state?.error).toContain('Blocked by the governance gate')
    /* The gate was asked and refused; the apply effect never ran. */
    expect(log).toEqual(['scan', 'propose', 'gate:apply_repository_changes'])
  })

  it('the approval card names what the scan actually found', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(repoScanWorkflow())
    const id = await aion.start('repo-scan', { root: '/repo', deps: repoScanDeps(log) })
    const state = await aion.waitFor(id)
    expect(state?.pendingApproval?.request.summary).toContain('2 changes')
  })

  it('a mission adopted after a restart gets its bindings back and settles its own apply', async () => {
    const dir = tmp()
    const log: string[] = []
    try {
      const aion = new MissionOrchestrator({ dir })
      aion.registerWorkflow(repoScanWorkflow())
      const deps = repoScanDeps(log)
      const id = await aion.start('repo-scan', { root: '/repo', deps } satisfies RepoScanInput)
      await aion.approve(id, true, 'tester')
      expect((await aion.query(id))?.status).toBe('done')

      /* Torn append mid-apply: the start survives, the result does not. */
      await crashDuringStep(join(dir, `${id}.jsonl`), 'apply')

      const restarted = new MissionOrchestrator({
        dir,
        /* What production does: the journal kept the root, never the
         * functions, so the bindings are re-attached on adoption. */
        resolveInput: (_workflowId, journaled) => ({
          ...(journaled as Record<string, unknown>),
          deps
        })
      })
      restarted.registerWorkflow(repoScanWorkflow())
      await restarted.discover()
      expect((await restarted.query(id))?.status).toBe('needs-reconciliation')

      /* No verdict given: the apply step looks for its own artefact. */
      const settled = await restarted.reconcile(id)
      expect(settled?.status).toBe('done')
      /* The apply never ran twice, and the mission carried on to the report. */
      expect(log.filter((entry) => entry === 'apply')).toHaveLength(1)
      expect(log.filter((entry) => entry === 'report')).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an apply that failed after writing is undone', async () => {
    const log: string[] = []
    const aion = new MemoryMissionOrchestrator()
    aion.registerWorkflow(repoScanWorkflow())
    const deps = repoScanDeps(log, {
      /* The artefact was written, then the step failed. */
      apply: async () => {
        log.push('apply')
        throw new Error('disk full')
      },
      applied: async () => true
    })
    const id = await aion.start('repo-scan', { root: '/repo', deps } satisfies RepoScanInput)
    await aion.approve(id, true, 'tester')
    const state = await aion.waitFor(id)
    expect(state?.status).toBe('failed')
    expect(state?.error).toContain('disk full')
    /* The partial effect was undone and the undo is on the journal. */
    expect(log).toContain('unapply')
    expect(aion.recordsFor(id).some((record) => record.type === 'step.compensated')).toBe(true)
  })
})
