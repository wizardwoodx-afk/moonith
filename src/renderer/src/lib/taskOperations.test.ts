import { describe, expect, it } from 'vitest'
import type { McpServerConfig, McpServerStatus, SubAgentRun, Task } from '@shared/types'
import {
  crewRunsForTask,
  crewStepProgress,
  currentCrewStep,
  filterCrewRuns,
  formatRunElapsed,
  mcpExposure,
  taskAttachmentSources
} from './taskOperations'

function run(id: string, taskId: string, status: SubAgentRun['status'], startedAt: string): SubAgentRun {
  return {
    id,
    taskId,
    taskTitle: 'Task',
    name: id,
    instruction: 'Work',
    status,
    steps: [],
    provider: 'provider',
    model: 'model',
    startedAt
  }
}

describe('task workspace Crew projections', () => {
  it('keeps only the current task and puts live runs before newer history', () => {
    const other = run('other', 'task-b', 'running', '2026-10-24T10:00:00Z')
    const done = run('done', 'task-a', 'done', '2026-10-24T12:00:00Z')
    const live = run('live', 'task-a', 'running', '2026-10-24T11:00:00Z')
    const input = [other, done, live]
    expect(crewRunsForTask(input, 'task-a').map((item) => item.id)).toEqual(['live', 'done'])
    expect(input.map((item) => item.id)).toEqual(['other', 'done', 'live'])
  })

  it('filters live and finished runs without inventing statuses', () => {
    const runs = [run('a', 'task', 'running', '2026-01-01'), run('b', 'task', 'stopped', '2026-01-02')]
    expect(filterCrewRuns(runs, 'running').map((item) => item.id)).toEqual(['a'])
    expect(filterCrewRuns(runs, 'finished').map((item) => item.id)).toEqual(['b'])
    expect(filterCrewRuns(runs, 'all')).toHaveLength(2)
  })

  it('counts completed and failed steps as finished and finds the genuine current step', () => {
    const item = run('a', 'task', 'running', '2026-01-01')
    item.steps = [
      { id: '1', tool: 'read', title: 'Read', status: 'ok', at: '2026-01-01' },
      { id: '2', tool: 'write', title: 'Write', status: 'error', at: '2026-01-01' },
      { id: '3', tool: 'test', title: 'Test', status: 'running', at: '2026-01-01' }
    ]
    expect(crewStepProgress(item)).toEqual({ completed: 2, total: 3, ratio: 2 / 3 })
    expect(currentCrewStep(item)?.id).toBe('3')
  })
})

describe('task workspace source and MCP projections', () => {
  it('deduplicates genuine attachments and excludes hidden internal messages', () => {
    const file = { id: 'a', name: 'brief.pdf', path: '/tmp/brief.pdf' }
    const task = {
      messages: [
        { id: '1', attachments: [file] },
        { id: '2', attachments: [{ ...file, id: 'duplicate' }] },
        { id: '3', hidden: true, attachments: [{ id: 'secret', name: 'internal', path: '/tmp/internal' }] }
      ]
    } as Task
    expect(taskAttachmentSources(task)).toEqual([file])
  })

  it('matches MCP allowlist exposure only while ready and enabled', () => {
    const config: McpServerConfig = {
      id: 'mcp', name: 'Tools', command: 'tool-server', args: [], enabled: true, toolAllowlist: ['read']
    }
    const status: McpServerStatus = {
      id: 'mcp', name: 'Tools', status: 'ready', tools: [{ name: 'read' }, { name: 'write' }]
    }
    expect(mcpExposure(config, status)).toMatchObject({ discovered: 2, exposed: 1 })
    expect(mcpExposure(config, status).tools.map((tool) => tool.name)).toEqual(['read'])
    expect(mcpExposure({ ...config, enabled: false }, status).exposed).toBe(0)
    expect(mcpExposure(config, { ...status, status: 'error' }).exposed).toBe(0)
    expect(mcpExposure({ ...config, toolAllowlist: [] }, status).exposed).toBe(2)
  })

  it('formats elapsed time for long runs and handles invalid timestamps', () => {
    const item = run('a', 'task', 'running', '2026-10-24T10:00:00Z')
    expect(formatRunElapsed(item, Date.parse('2026-10-24T11:02:03Z'))).toBe('1h 2m')
    expect(formatRunElapsed({ ...item, startedAt: 'invalid' }, Date.now())).toBe('—')
  })
})
