import { describe, expect, it } from 'vitest'
import type { StepRecord, Task } from '@shared/types'
import { buildOversight, stopLabel } from './oversight'

function step(overrides: Partial<StepRecord>): StepRecord {
  return {
    id: overrides.id ?? overrides.tool ?? 'step',
    tool: 'read_file',
    title: 'Read file',
    status: 'ok',
    startedAt: '2026-10-27T00:00:00.000Z',
    ...overrides
  } as StepRecord
}

function task(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    permissionMode: 'manual',
    steps: [],
    model: 'a-model',
    ...overrides
  } as unknown as Task
}

describe('buildOversight', () => {
  it('separates a guard edit from a refusal and a failure', () => {
    const report = buildOversight(
      task({
        steps: [
          step({ id: 'a', tool: 'tripwire:output', title: 'Answer checked before display', detail: 'withheld 1 value: api-key' }),
          step({
            id: 'b',
            tool: 'delete_path',
            title: 'Delete',
            status: 'error',
            error: 'Blocked by the governance gate (nomos-high-risk-requires-human): needs a human'
          }),
          step({ id: 'c', tool: 'run_command', title: 'Run command', status: 'error', error: 'exit code 1' }),
          step({ id: 'd', tool: 'write_file', title: 'Write file', detail: 'Wrote 12 bytes' }),
          step({ id: 'e', tool: 'read_file', title: 'Read file' })
        ]
      })
    )

    expect(report.counts).toEqual({ guard: 1, decision: 1, failure: 1, change: 1 })
    expect(report.entries.map((entry) => entry.kind)).toEqual(['change', 'failure', 'decision', 'guard'])
    expect(report.entries.find((entry) => entry.id === 'e')).toBeUndefined()
  })

  it('shows the newest entry first', () => {
    const report = buildOversight(
      task({
        steps: [
          step({ id: 'old', tool: 'write_file', startedAt: '2026-10-27T00:00:00.000Z' }),
          step({ id: 'new', tool: 'edit_file', startedAt: '2026-10-27T09:00:00.000Z' })
        ]
      })
    )
    expect(report.entries[0].id).toBe('new')
  })

  it('names the stop reason, including the breaker', () => {
    const report = buildOversight(task({ stop: { reason: 'circuit_open', at: '2026-10-27T00:00:00.000Z' } }))
    expect(report.stop).toContain('breaker')
    expect(report.empty).toBe(false)
  })

  it('reports an untouched task as empty rather than inventing entries', () => {
    const report = buildOversight(task({ steps: [step({ tool: 'read_file' })] }))
    expect(report.empty).toBe(true)
    expect(report.entries).toEqual([])
    expect(report.stop).toBeNull()
  })

  it('labels every reason the engine can end on', () => {
    const reasons = ['final', 'max_iterations', 'budget_exhausted', 'circuit_open', 'interrupted', 'error', 'prelude_break']
    for (const reason of reasons) expect(stopLabel(reason)).toBeTruthy()
    expect(stopLabel('something-unseen')).toContain('something-unseen')
    expect(stopLabel(undefined)).toBeNull()
  })
})
