import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DurableStore } from '../durable/index'
import { createSleepStep, createStep, createWorkflow } from './index'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'selfimpulse-workflow-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('typed workflow composition', () => {
  it('validates schemas and composes sequential steps', async () => {
    const workflow = createWorkflow<number>({
      id: 'sequential',
      inputSchema: z.number(),
      outputSchema: z.number()
    })
      .then(createStep<number, number>({ id: 'increment', execute: ({ input }) => input + 1 }))
      .then(createStep<number, number>({ id: 'double', execute: ({ input }) => input * 2 }))
      .commit()

    const result = await workflow.createRun({ runId: 'one' }).start(3)
    expect(result).toMatchObject({ status: 'success', result: 8 })
    expect(result.steps.map((step) => step.status)).toEqual(['success', 'success'])
    await expect(workflow.createRun({ runId: 'bad' }).start('3' as unknown as number)).rejects.toThrow(
      'is invalid'
    )
  })

  it('runs parallel branches with stable named output', async () => {
    const workflow = createWorkflow<number>({ id: 'parallel', outputSchema: z.object({ sum: z.number(), square: z.number() }) })
      .parallel([
        createStep<number, number>({ id: 'sum', execute: ({ input }) => input + 2 }),
        createStep<number, number>({ id: 'square', execute: ({ input }) => input * input })
      ])
      .commit()
    const result = await workflow.createRun({ runId: 'parallel' }).start(4)
    expect(result.result).toEqual({ sum: 6, square: 16 })
  })

  it('selects conditional branches and preserves foreach order with bounded concurrency', async () => {
    const branch = createWorkflow<number>({ id: 'branch' })
      .branch(
        [
          {
            when: (input) => input > 0,
            step: createStep<number, string>({ id: 'positive', execute: () => 'positive' })
          }
        ],
        createStep<number, string>({ id: 'other', execute: () => 'other' })
      )
      .commit()
    await expect(branch.createRun({ runId: 'positive' }).start(2)).resolves.toMatchObject({
      result: 'positive'
    })
    await expect(branch.createRun({ runId: 'other' }).start(-2)).resolves.toMatchObject({
      result: 'other'
    })

    let active = 0
    let maximum = 0
    const foreach = createWorkflow<number[]>({ id: 'foreach', outputSchema: z.array(z.number()) })
      .foreach(
        createStep<number, number>({
          id: 'work',
          execute: async ({ input }) => {
            active += 1
            maximum = Math.max(maximum, active)
            await new Promise((resolve) => setTimeout(resolve, 5))
            active -= 1
            return input * 2
          }
        }),
        { concurrency: 2 }
      )
      .commit()
    const result = await foreach.createRun({ runId: 'foreach' }).start([1, 2, 3, 4])
    expect(result.result).toEqual([2, 4, 6, 8])
    expect(maximum).toBeLessThanOrEqual(2)
  })

  it('bounds loops and caches only genuinely terminating iterations', async () => {
    const workflow = createWorkflow<number>({ id: 'loop' })
      .loop(createStep<number, number>({ id: 'next', execute: ({ input }) => input + 1 }), {
        until: ({ output }) => output >= 3,
        maxIterations: 3
      })
      .commit()
    await expect(workflow.createRun({ runId: 'loop-ok' }).start(0)).resolves.toMatchObject({
      status: 'success',
      result: 3
    })

    const impossible = createWorkflow<number>({ id: 'loop-fail' })
      .loop(createStep<number, number>({ id: 'next', execute: ({ input }) => input + 1 }), {
        until: ({ output }) => output >= 10,
        maxIterations: 2
      })
      .commit()
    const failed = await impossible.createRun({ runId: 'loop-fail' }).start(0)
    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toContain('did not finish within 2')
  })
})

describe('workflow recovery and events', () => {
  it('resumes a suspended workflow without repeating completed steps', async () => {
    const first = vi.fn((input: number) => input + 1)
    const approval = vi.fn((input: number, resumeData: unknown, suspend: (payload?: unknown) => never) => {
      if (resumeData === undefined) suspend({ question: 'Continue?' })
      return input + Number(resumeData)
    })
    const last = vi.fn((input: number) => input * 2)
    const workflow = createWorkflow<number>({ id: 'approval', outputSchema: z.number() })
      .then(createStep<number, number>({ id: 'first', execute: ({ input }) => first(input) }))
      .then(
        createStep<number, number>({
          id: 'approval',
          suspendSchema: z.object({ question: z.string() }),
          resumeSchema: z.number(),
          execute: ({ input, resumeData, suspend }) => approval(input, resumeData, suspend)
        })
      )
      .then(createStep<number, number>({ id: 'last', execute: ({ input }) => last(input) }))
      .commit()

    const initial = await workflow
      .createRun({ runId: 'approval-run', durable: await new DurableStore(root).context('approval-run') })
      .start(1)
    expect(initial.status).toBe('suspended')
    expect(initial.suspended).toMatchObject({ stepId: 'approval', payload: { question: 'Continue?' } })
    expect(first).toHaveBeenCalledTimes(1)
    expect(approval).toHaveBeenCalledTimes(1)
    expect(last).not.toHaveBeenCalled()

    const reopened = workflow.createRun({
      runId: 'approval-run',
      durable: await new DurableStore(root).context('approval-run')
    })
    const resumed = await reopened.resume('approval', 3)
    expect(resumed).toMatchObject({ status: 'success', result: 10 })
    expect(first).toHaveBeenCalledTimes(1)
    expect(approval).toHaveBeenCalledTimes(2)
    expect(last).toHaveBeenCalledTimes(1)
    expect(resumed.steps.find((step) => step.stepId === 'first')).toMatchObject({
      status: 'success',
      replayed: true
    })
  })

  it('resumes a local suspended run without requiring a disk journal', async () => {
    const workflow = createWorkflow<number>({ id: 'local-approval' })
      .then(
        createStep<number, number>({
          id: 'approval',
          execute: ({ input, resumeData, suspend }) => {
            if (resumeData === undefined) suspend()
            return input + Number(resumeData)
          }
        })
      )
      .commit()
    const run = workflow.createRun({ runId: 'local' })
    expect((await run.start(2)).status).toBe('suspended')
    expect((await run.resume('approval', 4)).result).toBe(6)
  })

  it('emits watch/stream lifecycle events', async () => {
    const workflow = createWorkflow<number>({ id: 'events' })
      .then(createStep<number, number>({ id: 'step', execute: ({ input }) => input + 1 }))
      .commit()
    const run = workflow.createRun({ runId: 'events' })
    const watched: string[] = []
    run.watch((event) => watched.push(event.type))
    const streamed: string[] = []
    const consuming = (async () => {
      for await (const event of run.stream()) streamed.push(event.type)
    })()
    await run.start(1)
    await consuming
    expect(watched).toContain('run_success')
    expect(streamed).toContain('step_completed')
    expect(streamed.at(-1)).toBe('run_success')
  })

  it('rejects concurrent starts and ignores cancellation after success', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const workflow = createWorkflow<number>({ id: 'exclusive' })
      .then(createStep<number, number>({ id: 'wait', execute: async ({ input }) => { await gate; return input } }))
      .commit()
    const run = workflow.createRun({ runId: 'exclusive-run' })
    const first = run.start(1)
    await expect(run.start(2)).rejects.toThrow('Cannot start')
    release()
    expect((await first).status).toBe('success')
    run.cancel()
    expect(run.snapshot().status).toBe('success')
  })

  it('does not journal a step complete when cancellation wins its ignored abort', async () => {
    const durable = await new DurableStore(root).context('cancel-ignored')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const workflow = createWorkflow<number>({ id: 'cancel-ignored' })
      .then(createStep<number, number>({ id: 'wait', execute: async ({ input }) => { await gate; return input } }))
      .commit()
    const run = workflow.createRun({ runId: 'cancel-ignored', durable })
    const pending = run.start(1)
    await new Promise<void>((resolve) => setImmediate(resolve))
    run.cancel()
    release()
    expect((await pending).status).toBe('canceled')
    // The step key carries the definition fingerprint, so look it up by suffix.
    const step = Object.entries(durable.snapshot().entries).find(([key]) =>
      key.endsWith(':workflow:cancel-ignored:op:0:wait')
    )
    expect(step?.[1].status).not.toBe('completed')
  })

  it('names durable input and snapshot state with the run id', async () => {
    const durable = await new DurableStore(root).context('run-A')
    const workflow = createWorkflow<number>({ id: 'keyed' })
      .then(createStep<number, number>({ id: 'identity', execute: ({ input }) => input }))
      .commit()
    await workflow.createRun({ runId: 'run-A', durable }).start(7)
    const keys = Object.keys(durable.snapshot().state)
    // Every key is namespaced under `def:<definition fingerprint>:` first.
    expect(keys).toContain(`def:${workflow.fingerprint}:__workflow:keyed:run-A:input`)
    expect(keys).toContain(`def:${workflow.fingerprint}:__workflow:keyed:run-A:snapshot`)
  })

  it('cancels an active durable sleep without waiting for its timer', async () => {
    const workflow = createWorkflow<null>({ id: 'cancel' })
      .then(createSleepStep<null>('wait', 60_000))
      .commit()
    const store = new DurableStore(root)
    const durable = await store.context('cancel')
    const run = workflow.createRun({ runId: 'cancel', durable })
    const running = run.start(null)
    // Deterministic ordering: the abort has to land while the timer is already
    // journaled. Cancelling earlier is a legitimate outcome too, and this test
    // would then be asserting on an entry that was never written.
    await vi.waitFor(
      () => {
        const entry = Object.entries(durable.snapshot().entries).find(([key]) =>
          key.endsWith(':workflow:cancel:op:0:wait:wait')
        )
        expect(entry).toBeDefined()
      },
      { timeout: 10_000, interval: 20 }
    )
    run.cancel()
    const result = await running
    expect(result.status).toBe('canceled')
    await store.flush()
    // Assert on the post-cancel snapshot: the sleep step and its timer are both
    // left unfinished and neither is journal-completed.
    const timer = Object.entries(durable.snapshot().entries).find(([key]) =>
      key.endsWith(':workflow:cancel:op:0:wait:wait')
    )
    expect(timer?.[1].status).toBe('pending')
    const step = Object.entries(durable.snapshot().entries).find(([key]) =>
      key.endsWith(':workflow:cancel:op:0:wait')
    )
    expect(step?.[1].status).not.toBe('completed')
  })
})
