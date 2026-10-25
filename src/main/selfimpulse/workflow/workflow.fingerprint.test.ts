import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DurableStore } from '../durable/index'
import { createStep, createWorkflow } from './index'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'selfimpulse-workflow-fingerprint-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Replay identity. The journal keys a step by its position in the definition,
 * so an edited workflow can point a new step at output committed for a
 * different one. These tests keep that impossible.
 */
describe('workflow definition fingerprint', () => {
  it('refuses to replay committed output into a restructured step', async () => {
    const durable = await new DurableStore(root).context('edited')
    const sequential = createWorkflow<null>({ id: 'edited' })
      .then(createStep<null, string>({ id: 'work', execute: () => 'sequential' }))
      .commit()
    await expect(sequential.createRun({ runId: 'edited', durable }).start(null)).resolves.toMatchObject({
      status: 'success',
      result: 'sequential'
    })

    let executed = false
    const restructured = createWorkflow<null>({ id: 'edited' })
      .parallel<{ work: string }>([
        createStep<null, string>({
          id: 'work',
          execute: () => {
            executed = true
            return 'parallel'
          }
        })
      ])
      .commit()
    const result = await restructured.createRun({ runId: 'edited', durable }).start(null)

    // A positional journal key would serve the 'sequential' output here and
    // never run the new step at all.
    expect(executed).toBe(true)
    expect(result).toMatchObject({ status: 'success', result: { work: 'parallel' } })
  })

  it('refuses to recover another definition’s persisted run state', async () => {
    const durable = await new DurableStore(root).context('shape')
    const suspending = createWorkflow<null>({ id: 'shape' })
      .then(
        createStep<null, null>({
          id: 'gate',
          execute: ({ suspend }) => suspend({ question: 'Continue?' }) as never
        })
      )
      .commit()
    const suspended = await suspending.createRun({ runId: 'shape', durable }).start(null)
    expect(suspended.status).toBe('suspended')

    const edited = createWorkflow<null>({ id: 'shape' })
      .then(createStep<null, string>({ id: 'other', execute: () => 'other' }))
      .commit()
    // Same workflow id and same journal, different definition: the old snapshot
    // belongs to a run this definition never started, so there is nothing here
    // to recover.
    await expect(edited.createRun({ runId: 'shape', durable }).recover()).rejects.toThrow(
      'No persisted workflow run exists to recover.'
    )
  })

  it('fingerprints every durable key this run writes', async () => {
    const durable = await new DurableStore(root).context('keys')
    const workflow = createWorkflow<null>({ id: 'keys' })
      .then(createStep<null, string>({ id: 'work', execute: () => 'done' }))
      .commit()
    await workflow.createRun({ runId: 'keys', durable }).start(null)
    const snapshot = durable.snapshot()
    const stateKeys = Object.keys(snapshot.state)
    expect(stateKeys.length).toBeGreaterThan(0)
    for (const key of stateKeys) expect(key.startsWith('def:')).toBe(true)
    const stepKeys = Object.keys(snapshot.entries)
    expect(stepKeys.length).toBeGreaterThan(0)
    for (const key of stepKeys) expect(key).toContain('def:')
  })
})
