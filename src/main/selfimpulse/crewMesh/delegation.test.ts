import { describe, expect, it, vi } from 'vitest'
import { runCrewHandoffs, type CrewJob } from './delegation'
import { appendCrewRunEvent, crewRunForTransport } from './events'
import type { SubAgentRun } from '@shared/types'

const jobs: CrewJob[] = [
  { name: 'Researcher', instruction: 'Inspect sources', purpose: 'Evidence' },
  { name: 'Builder', instruction: 'Implement the change' },
  { name: 'Reviewer', instruction: 'Check the result' },
  { name: 'Tester', instruction: 'Run focused checks' }
]

describe('Crew Mesh handoffs', () => {
  it('bounds concurrency and preserves supervisor result order and lineage', async () => {
    let active = 0
    let maximum = 0
    const results = await runCrewHandoffs(
      jobs,
      async (job, delegation) => {
        active++
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 8))
        active--
        expect(delegation.agentPath).toEqual(['Captain', job.name])
        expect(delegation.batchSize).toBe(4)
        return { content: `${job.name} report` }
      },
      { batchId: 'call-1', maxConcurrency: 3 }
    )

    expect(maximum).toBe(3)
    expect(results.map((result) => result.content)).toEqual([
      'Researcher report',
      'Builder report',
      'Reviewer report',
      'Tester report'
    ])
  })

  it('settles each specialist independently when one handoff fails', async () => {
    const results = await runCrewHandoffs(
      jobs.slice(0, 3),
      async (job) => {
        if (job.name === 'Builder') throw new Error('tool unavailable')
        return { content: `${job.name} finished` }
      },
      { batchId: 'call-2' }
    )
    expect(results[0].isError).toBeUndefined()
    expect(results[1]).toMatchObject({ isError: true })
    expect(results[1].content).toContain('tool unavailable')
    expect(results[2].content).toBe('Reviewer finished')
  })

  it('does not spawn queued specialists after parent cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const handoff = vi.fn()
    const results = await runCrewHandoffs(jobs, handoff, {
      batchId: 'call-3',
      signal: controller.signal
    })
    expect(handoff).not.toHaveBeenCalled()
    expect(results).toHaveLength(4)
    expect(results.every((result) => result.isError)).toBe(true)
  })
})

describe('Crew Mesh event forwarding', () => {
  it('adds lineage metadata and clones nested IPC data', () => {
    const run: SubAgentRun = {
      id: 'crew-1',
      taskId: 'task-1',
      taskTitle: 'Task',
      name: 'Researcher',
      instruction: 'Inspect',
      status: 'running',
      steps: [],
      provider: 'provider',
      model: 'model',
      startedAt: '2026-10-25T00:00:00.000Z',
      runtime: 'crew-mesh',
      agentPath: ['Captain', 'Researcher']
    }
    appendCrewRunEvent(run, {
      id: 'event-1',
      type: 'spawned',
      label: 'Researcher joined the Crew',
      at: run.startedAt
    })
    const transported = crewRunForTransport(run)
    transported.agentPath?.push('Changed')
    transported.events?.[0].agentPath.push('Changed')
    expect(run.agentPath).toEqual(['Captain', 'Researcher'])
    expect(run.events?.[0].agentPath).toEqual(['Captain', 'Researcher'])
  })
})
