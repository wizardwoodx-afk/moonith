import { describe, expect, it } from 'vitest'
import type { StepRecord, TaskStatus } from '@shared/types'
import { deriveAgentActivity } from './agentActivity'

function step(tool: string, status: StepRecord['status'] = 'running'): StepRecord {
  return { id: tool, tool, status, title: `Using ${tool}`, startedAt: '2026-10-29T10:00:00Z' }
}

describe('deriveAgentActivity', () => {
  it('does not invent reasoning while awaiting actual work', () => {
    expect(deriveAgentActivity({ live: true, steps: [] })).toEqual({ state: 'working', label: 'Working' })
    expect(deriveAgentActivity({ live: true, thinking: '  \n ', steps: [] }).state).toBe('working')
  })

  it('shows actual reasoning only before responding', () => {
    expect(deriveAgentActivity({ live: true, thinking: 'Consider the request', steps: [] }))
      .toEqual({ state: 'thinking', label: 'Thinking' })
    expect(deriveAgentActivity({ live: true, thinking: 'Previous reasoning', responding: true, steps: [] }))
      .toEqual({ state: 'responding', label: 'Responding' })
  })

  it('reports responding without requiring reasoning', () => {
    expect(deriveAgentActivity({ live: true, responding: true, steps: [] }).state).toBe('responding')
  })

  it.each([
    ['read_file', 'Reading file'], ['read', 'Reading file'], ['read_document', 'Reading document'],
    ['recall_memory', 'Reading memory'], ['list_files', 'Browsing files'],
    ['search_files', 'Searching files'], ['glob', 'Searching files'], ['grep', 'Searching files']
  ])('classifies the actual %s tool rather than its title', (tool, label) => {
    expect(deriveAgentActivity({ live: true, thinking: 'Old reasoning', steps: [step(tool)] }))
      .toEqual({ state: 'reading', label })
  })

  it('does not guess reading from an unrelated tool title', () => {
    const tool = { ...step('shell'), title: 'Read memory and files' }
    expect(deriveAgentActivity({ live: true, steps: [tool] }).state).toBe('working')
  })

  it('uses the latest running step without mutating input or reviving completed tools', () => {
    const steps = Object.freeze([step('read_file'), step('shell'), step('recall_memory', 'ok')])
    expect(deriveAgentActivity({ live: true, steps }).state).toBe('working')
    expect(steps.map((entry) => entry.tool)).toEqual(['read_file', 'shell', 'recall_memory'])
    expect(deriveAgentActivity({ live: true, steps: [step('read', 'ok')] }).state).toBe('working')
  })

  it.each(['subagent', 'delegate_to_crew', 'delegate_to_agent'])('recognizes %s delegation', (tool) => {
    expect(deriveAgentActivity({ live: true, steps: [step(tool)] }))
      .toEqual({ state: 'delegating', label: 'Delegating' })
  })

  it('uses actual active agents even between tool calls', () => {
    expect(deriveAgentActivity({ live: true, steps: [], activeAgents: 2 }))
      .toEqual({ state: 'delegating', label: 'Delegating', detail: '2 active agents' })
    expect(deriveAgentActivity({ live: true, steps: [], activeAgents: 1 }).detail).toBe('1 active agent')
    expect(deriveAgentActivity({ live: true, steps: [], activeAgents: 0 }).state).toBe('working')
  })

  it('gives current tool work priority over old reasoning or response text', () => {
    expect(deriveAgentActivity({ live: true, responding: true, thinking: 'Old', steps: [step('read')] }).state)
      .toBe('reading')
    expect(deriveAgentActivity({ live: true, responding: true, steps: [], activeAgents: 1 }).state)
      .toBe('delegating')
  })

  it('gives approval priority over running tools, delegation and reasoning', () => {
    expect(deriveAgentActivity({
      live: true, responding: true, thinking: 'Old', activeAgents: 2,
      steps: [step('shell', 'waiting'), step('read')]
    })).toEqual({ state: 'waiting', label: 'Waiting for approval' })
  })

  it.each([true, false])('honors task waiting when live is %s', (live) => {
    expect(deriveAgentActivity({ live, taskStatus: 'waiting', steps: [step('read')] }))
      .toEqual({ state: 'waiting', label: 'Waiting for approval' })
  })

  it('distinguishes a draft waiting to start from approval', () => {
    expect(deriveAgentActivity({ live: false, taskStatus: 'draft', steps: [] }))
      .toEqual({ state: 'waiting', label: 'Waiting' })
  })

  it.each([
    ['done', 'complete', 'Processed'], ['error', 'error', 'Error'], ['paused', 'paused', 'Paused']
  ] as const)('lets terminal %s override stale activity', (taskStatus, state, label) => {
    for (const live of [true, false]) {
      expect(deriveAgentActivity({
        live, taskStatus, thinking: 'Old', responding: true, activeAgents: 3,
        steps: [step('subagent'), step('read', 'waiting')]
      })).toEqual({ state, label })
    }
  })

  it.each([undefined, 'running'] as (TaskStatus | undefined)[])('never animates a finished turn with task status %s', (taskStatus) => {
    expect(deriveAgentActivity({
      live: false, taskStatus, thinking: 'Old', responding: true, activeAgents: 4,
      steps: [step('subagent'), step('read', 'waiting')]
    })).toEqual({ state: 'complete', label: 'Processed' })
  })

  it('retains a finished tool error without mistaking a recovered live tool error for task failure', () => {
    expect(deriveAgentActivity({ live: false, steps: [step('shell', 'error')] }).state).toBe('error')
    expect(deriveAgentActivity({ live: true, steps: [step('shell', 'error'), step('read')] }).state).toBe('reading')
    expect(deriveAgentActivity({ live: false, taskStatus: 'done', steps: [step('shell', 'error')] }).state).toBe('complete')
  })
})
