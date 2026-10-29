import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artifact, ChatMessage, MemoryInput, StepRecord, Task } from '@shared/types'

const { add, list, propose } = vi.hoisted(() => ({
  add: vi.fn<(input: MemoryInput, source?: string) => Promise<unknown[]>>(async () => []),
  list: vi.fn(async () => [] as Array<{ text: string }>),
  propose: vi.fn<(input: { content: string; sourceName: string }) => Promise<
    { ok: true; proposal: { id: string } } | { ok: false; error: string }
  >>(async () => ({ ok: true, proposal: { id: 'prop-1' } }))
}))

vi.mock('../services/memory', () => ({
  memoryService: { add, list }
}))
vi.mock('../selfimpulse/mission/knowledgeSkills', () => ({
  proposeKnowledgeSkill: propose
}))

import { learnFromTask } from './learning'

function step(index: number): StepRecord {
  return {
    id: `step-${index}`,
    tool: 'read_file',
    title: `Read a file (${index})`,
    status: 'ok',
    startedAt: '2026-10-28T00:00:00.000Z'
  }
}

function task(overrides: Partial<Task> = {}): Task {
  const messages: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'do the thing', createdAt: '2026-10-28T00:00:00.000Z' },
    { id: 'a1', role: 'assistant', content: 'Done. Here is the result.', createdAt: '2026-10-28T00:00:05.000Z' }
  ]
  const artifacts: Artifact[] = [
    { id: 'art-1', name: 'report.md', relPath: 'report.md', kind: 'document', size: 12, createdAt: '2026-10-28T00:00:05.000Z' }
  ]
  return {
    id: 'task-1',
    title: 'Weekly report',
    objective: 'Produce the weekly report',
    status: 'done',
    messages,
    steps: [step(1), step(2), step(3)],
    artifacts,
    ...overrides
  } as Task
}

beforeEach(() => {
  add.mockClear()
  list.mockClear()
  propose.mockClear()
})

describe('learning from a finished task', () => {
  it('keeps one fact and proposes the procedure when the task did real work', async () => {
    const outcome = await learnFromTask(task())
    expect(outcome.memory).toBe('written')
    expect(outcome.proposal).toBe('proposed')
    expect(add).toHaveBeenCalledTimes(1)
    const note = add.mock.calls[0][0] as { text: string; tags: string[] }
    expect(note.text).toContain('Weekly report')
    expect(note.tags).toEqual(['learned'])
  })

  it('never writes the same fact twice', async () => {
    const first = await learnFromTask(task())
    const written = (add.mock.calls[0][0] as { text: string }).text
    list.mockResolvedValueOnce([{ text: written }])
    const second = await learnFromTask(task())
    expect(first.memory).toBe('written')
    expect(second.memory).toBe('duplicate')
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('learns nothing from a task that did not finish', async () => {
    const outcome = await learnFromTask(task({ status: 'error' }))
    expect(outcome.recorded).toBe(false)
    expect(add).not.toHaveBeenCalled()
    expect(propose).not.toHaveBeenCalled()
  })

  it('learns nothing from a one-off answer', async () => {
    const outcome = await learnFromTask(task({ steps: [step(1)] }))
    expect(outcome.reason).toBe('too few steps to be a lesson')
    expect(propose).not.toHaveBeenCalled()
  })

  it('records how the work was done, not what the files contain', async () => {
    await learnFromTask(task())
    const document = propose.mock.calls[0][0] as { content: string; sourceName: string }
    expect(document.content).toContain('Read a file (1)')
    expect(document.content).toContain('report.md')
    expect(document.sourceName).toBe('Weekly report')
    expect(document.content).not.toMatch(/relPath/)
  })

  it('reports why a proposal was refused instead of throwing', async () => {
    propose.mockResolvedValueOnce({ ok: false, error: 'document too small' })
    const outcome = await learnFromTask(task())
    expect(outcome.proposal).toBe('skipped')
    expect(outcome.reason).toBe('document too small')
    expect(outcome.memory).toBe('written')
  })
})
