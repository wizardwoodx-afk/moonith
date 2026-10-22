import { describe, expect, it } from 'vitest'
import type { PublicSettings, Task, TaskSummary } from '@shared/types'
import {
  buildActivity,
  collectArtifacts,
  engineSummary,
  groupTasks
} from './companyView'

function summary(patch: Partial<TaskSummary> & { id: string }): TaskSummary {
  return {
    id: patch.id,
    title: patch.title ?? 'Task',
    objective: '',
    status: patch.status ?? 'running',
    mode: 'cowork',
    createdAt: patch.createdAt ?? '2026-10-21T08:00:00.000Z',
    updatedAt: patch.updatedAt ?? '2026-10-21T09:00:00.000Z',
    artifactsCount: patch.artifactsCount ?? 0
  }
}

function task(patch: Partial<Task> & { id: string }): Task {
  return {
    id: patch.id,
    title: patch.title ?? 'Task',
    objective: '',
    mode: 'cowork',
    status: patch.status ?? 'done',
    permissionMode: 'manual',
    folders: [],
    messages: [],
    steps: [],
    plan: [],
    artifacts: patch.artifacts ?? [],
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T09:00:00.000Z'
  }
}

describe('company view', () => {
  it('groups only the states that have tasks, in attention order', () => {
    const groups = groupTasks([
      summary({ id: 'done', status: 'done' }),
      summary({ id: 'run', status: 'running' }),
      summary({ id: 'wait', status: 'waiting' }),
      summary({ id: 'run-2', status: 'running' })
    ])
    expect(groups.map((group) => group.status)).toEqual(['running', 'waiting', 'done'])
    expect(groups[0].tasks).toHaveLength(2)
  })

  it('collects artifacts across tasks, newest first', () => {
    const rows = collectArtifacts([
      task({
        id: 't1',
        title: 'Brief',
        artifacts: [
          {
            id: 'a1',
            name: 'brief.pdf',
            relPath: 'brief.pdf',
            kind: 'pdf',
            size: 10,
            createdAt: '2026-10-21T09:00:00.000Z'
          }
        ]
      }),
      task({
        id: 't2',
        title: 'Sheet',
        artifacts: [
          {
            id: 'a2',
            name: 'costs.xlsx',
            relPath: 'costs.xlsx',
            kind: 'spreadsheet',
            size: 20,
            createdAt: '2026-10-21T10:00:00.000Z'
          }
        ]
      })
    ])
    expect(rows.map((row) => row.name)).toEqual(['costs.xlsx', 'brief.pdf'])
    expect(rows[0].taskId).toBe('t2')
  })

  it('builds activity from real task state and files', () => {
    const rows = buildActivity(
      [summary({ id: 't1', title: 'Brief', status: 'done', updatedAt: '2026-10-21T09:00:00.000Z' })],
      [
        {
          id: 'a1',
          name: 'brief.pdf',
          relPath: 'brief.pdf',
          kind: 'pdf',
          size: 10,
          createdAt: '2026-10-21T10:00:00.000Z',
          taskId: 't1',
          taskTitle: 'Brief'
        }
      ]
    )
    expect(rows[0].text).toContain('brief.pdf')
    expect(rows[0].tone).toBe('neutral')
    expect(rows[1].text).toContain('Finished')
    expect(rows[1].tone).toBe('done')
  })

  it('reports an engine only when a provider has models', () => {
    const base: PublicSettings = {
      providers: [
        {
          id: 'p1',
          name: 'Local',
          kind: 'compatible',
          models: [],
          enabled: true,
          hasKey: true
        }
      ],
      mcpServers: [],
      connectors: { hasKey: false, enabled: false, toolkits: [] },
      channels: [],
      defaultPermissionMode: 'manual',
      customInstructions: '',
      allowShell: false,
      onboardingComplete: true
    }
    expect(engineSummary(null).ready).toBe(false)
    expect(engineSummary(base).ready).toBe(false)
    const ready = engineSummary({
      ...base,
      providers: [{ ...base.providers[0], models: ['local-model'] }],
      mcpServers: [
        { id: 'm1', name: 'One', command: 'x', args: [], enabled: true },
        { id: 'm2', name: 'Two', command: 'x', args: [], enabled: false }
      ]
    })
    expect(ready).toMatchObject({
      ready: true,
      provider: 'Local',
      model: 'local-model',
      permission: 'Ask before tools',
      servers: 1
    })
  })
})
