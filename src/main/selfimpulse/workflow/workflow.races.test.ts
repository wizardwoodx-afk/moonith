import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DurableStore } from '../durable/index'
import { createStep, createWorkflow } from './index'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'selfimpulse-workflow-race-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('workflow cancellation and recovery', () => {
  it('honours cancel() issued while start() is still awaiting its journal write', async () => {
    const workflow = createWorkflow<null>({ id: 'early-cancel' })
      .then(createStep<null, null>({
        id: 'hang',
        execute: ({ signal }) =>
          new Promise<null>((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      }))
      .commit()
    const durable = await new DurableStore(root).context('early-cancel')
    const run = workflow.createRun({ runId: 'early-cancel', durable })
    const running = run.start(null)
    run.cancel()
    await expect(running).resolves.toMatchObject({ status: 'canceled' })
  })

  it('refuses a second concurrent resume of the same suspended run', async () => {
    const workflow = createWorkflow<null>({ id: 'double' })
      .then(createStep<null, null>({
        id: 'gate',
        execute: ({ suspend }) => suspend({ waiting: true }) as never
      }))
      .commit()
    const durable = await new DurableStore(root).context('double')
    const run = workflow.createRun({ runId: 'double', durable })
    await run.start(null)
    const [first, second] = await Promise.allSettled([
      run.resume('gate', { approved: true }),
      run.resume('gate', { approved: true })
    ])
    expect([first.status, second.status].filter((status) => status === 'rejected')).toHaveLength(1)
  })

  it('honours cancel() issued before start() has installed its controller', async () => {
    const workflow = createWorkflow<null>({ id: 'pre-cancel' })
      .then(createStep<null, string>({ id: 'work', execute: () => 'ran' }))
      .commit()
    const durable = await new DurableStore(root).context('pre-cancel')
    const run = workflow.createRun({ runId: 'pre-cancel', durable })
    run.cancel()
    const result = await run.start(null)
    expect(result.status).toBe('canceled')
  })
})
