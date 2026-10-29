import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import type { EngineClient, EngineEvent } from './client'
import { runEngineTurn, type EngineStepUpdate, type EngineTurnHost, type EngineTurnInput } from './run'

// No test may reach the legacy workspace AGENTS.md fallback on disk.
vi.mock('node:fs', () => ({ writeFileSync: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

interface Harness {
  steps: EngineStepUpdate[]
  host: EngineTurnHost
  emit(event: EngineEvent): void
  listenerCount(): number
}

/**
 * A stand-in for the engine client that lets a test drive the event stream the
 * engine publishes while a turn runs.
 */
function harness(): Harness & { client: EngineClient } {
  const steps: EngineStepUpdate[] = []
  const listeners = new Set<(event: EngineEvent) => void>()
  const emit = (event: EngineEvent): void => {
    for (const listener of listeners) listener(event)
  }
  const host: EngineTurnHost = {
    taskId: 'task-1',
    title: 'A task',
    workspace: 'C:\\work',
    permissionMode: 'auto',
    model: { providerId: 'provider-1', model: 'model-a' },
    onSession: vi.fn(),
    executeTool: vi.fn(async () => ({ content: 'done' })),
    onThinking: vi.fn(),
    onStep: (step) => steps.push(step),
    onCrew: vi.fn(),
    permission: vi.fn(async () => 'once' as const)
  }
  const client = {
    createSession: vi.fn(async () => ({ id: 'session-1' })),
    putInstruction: vi.fn(async () => undefined),
    replyPermission: vi.fn(async () => undefined),
    onEvent: vi.fn((listener: (event: EngineEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    waitForTools: vi.fn(async () => true),
    prompt: async () => {
      // The engine answers a prompt with a stream of events.
      setTimeout(() => {
        emit({
          type: 'session.tool.input.started',
          data: { sessionID: 'session-1', id: 'call-1', name: 'selfimpulse_scope_list_files' }
        })
        emit({
          type: 'session.tool.called',
          data: { sessionID: 'session-1', id: 'call-1', input: { path: '.' } }
        })
        emit({
          type: 'session.tool.input.started',
          data: { sessionID: 'session-1', id: 'call-2', name: 'glob' }
        })
        emit({
          type: 'session.tool.called',
          data: { sessionID: 'session-1', id: 'call-2', input: {} }
        })
        emit({
          type: 'session.tool.success',
          data: { sessionID: 'session-1', id: 'call-2', content: 'ok' }
        })
        emit({
          type: 'session.execution.succeeded',
          data: { sessionID: 'session-1' }
        })
      }, 0)
    },
    interrupt: vi.fn(async () => undefined)
  }
  return { steps, host, emit, listenerCount: () => listeners.size, client: client as unknown as EngineClient }
}

function turnInput(signal = new AbortController().signal): EngineTurnInput {
  return { systemPrompt: 'be useful', userMessage: 'do the task', signal, onText: vi.fn() }
}

async function simultaneousTurns() {
  const a = harness()
  const b = harness()
  a.host.sessionId = 'parent-a'
  b.host.sessionId = 'parent-b'
  b.host.taskId = 'task-2'
  const inputA = turnInput()
  const inputB = turnInput()
  const prompt = vi.spyOn(a.client, 'prompt').mockResolvedValue(undefined)
  const turns = [runEngineTurn(inputA, a.host, a.client), runEngineTurn(inputB, b.host, a.client)]
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
  const finish = async () => {
    a.emit({ type: 'session.execution.succeeded', data: { sessionID: 'parent-a' } })
    a.emit({ type: 'session.execution.succeeded', data: { sessionID: 'parent-b' } })
    return Promise.all(turns)
  }
  return { a, b, inputA, inputB, finish }
}

describe('engine turn steps', () => {
  it('names a step after the tool the model called', async () => {
    const h = harness()
    await runEngineTurn(
      {
        systemPrompt: 'be useful',
        userMessage: 'list the files',
        signal: new AbortController().signal,
        onText: () => undefined
      },
      h.host,
      h.client
    )
    const native = h.steps.filter((step) => step.tool === 'glob')
    expect(native).toHaveLength(2)
    expect(native[0].status).toBe('running')
    expect(native[1].status).toBe('ok')
    /* The tool name is the label; a second copy of it would only repeat the row. */
    expect(native[0].detail).toBeUndefined()
  })

  it('leaves bridged tools to the governed runtime, which titles them for a reader', async () => {
    const h = harness()
    await runEngineTurn(
      {
        systemPrompt: 'be useful',
        userMessage: 'list the files',
        signal: new AbortController().signal,
        onText: () => undefined
      },
      h.host,
      h.client
    )
    expect(h.steps.some((step) => step.tool === 'selfimpulse_scope_list_files')).toBe(false)
    expect(h.steps.some((step) => step.tool === 'tool')).toBe(false)
  })
})

describe('engine turn event ownership', () => {
  it('routes permissions only to the owning simultaneous task, never an unscoped or unrelated request', async () => {
    const { a, b, finish } = await simultaneousTurns()
    b.host.permission = vi.fn(async () => 'always' as const)
    for (const sessionID of ['parent-a', 'parent-b', 'unrelated', undefined, '', 42]) {
      a.emit({ type: 'permission.asked', data: { sessionID, id: 'permission-1', action: 'shell', resources: ['pwd'] } })
    }
    await finish()
    expect(a.host.permission).toHaveBeenCalledExactlyOnceWith({ action: 'shell', resources: ['pwd'] })
    expect(b.host.permission).toHaveBeenCalledExactlyOnceWith({ action: 'shell', resources: ['pwd'] })
    expect(a.client.replyPermission).toHaveBeenCalledTimes(2)
    expect(a.client.replyPermission).toHaveBeenCalledWith('parent-a', 'permission-1', 'once')
    expect(a.client.replyPermission).toHaveBeenCalledWith('parent-b', 'permission-1', 'always')
  })

  it('isolates text, reasoning, tools, usage and completion across simultaneous tasks and unscoped events', async () => {
    const { a, b, inputA, inputB, finish } = await simultaneousTurns()
    // Reused call ids must not let the global stream overwrite another task's tool name.
    for (const [sessionID, name] of [['parent-a', 'glob'], ['parent-b', 'grep'], ['unrelated', 'shell'], [undefined, 'write']]) {
      a.emit({ type: 'session.tool.input.started', data: { sessionID, id: 'same-call', name } })
    }
    for (const sessionID of ['parent-a', 'parent-b', 'unrelated', undefined, '', 42]) {
      a.emit({ type: 'session.tool.called', data: { sessionID, id: 'same-call', input: {} } })
      a.emit({ type: 'session.tool.success', data: { sessionID, id: 'same-call', content: 'ok' } })
      a.emit({ type: 'session.text.delta', data: { sessionID, delta: `${sessionID} text` } })
      a.emit({ type: 'session.text.ended', data: { sessionID, text: `${sessionID} final` } })
      a.emit({ type: 'session.reasoning.delta', data: { sessionID, delta: `${sessionID} thought` } })
      a.emit({ type: 'session.step.started', data: { sessionID } })
      a.emit({ type: 'session.step.ended', data: { sessionID, tokens: { input: 2, output: 3 } } })
    }
    a.emit({ type: 'session.execution.failed', data: { error: { message: 'unscoped failure' } } })
    a.emit({ type: 'session.execution.interrupted', data: { sessionID: 'unrelated' } })
    const results = await finish()
    expect(inputA.onText).toHaveBeenCalledExactlyOnceWith('parent-a text')
    expect(inputB.onText).toHaveBeenCalledExactlyOnceWith('parent-b text')
    expect(a.host.onThinking).toHaveBeenCalledExactlyOnceWith('parent-a thought')
    expect(b.host.onThinking).toHaveBeenCalledExactlyOnceWith('parent-b thought')
    expect(a.steps.map(({ tool, status }) => [tool, status])).toEqual([['glob', 'running'], ['glob', 'ok']])
    expect(b.steps.map(({ tool, status }) => [tool, status])).toEqual([['grep', 'running'], ['grep', 'ok']])
    expect(results.map((result) => result.finalResponse)).toEqual(['parent-a final', 'parent-b final'])
    for (const result of results) {
      expect(result).toMatchObject({ stopReason: 'final', toolCalls: 1, apiCallCount: 1, usage: { prompt: 2, completion: 3, total: 5 } })
    }
  })

  it.each(['once', 'always', 'reject', 'throw'] as const)('routes known child and descendant permissions with native decision %s', async (decision) => {
    const { a, b, inputA, finish } = await simultaneousTurns()
    a.host.permission = vi.fn(async () => {
      if (decision === 'throw') throw new Error('approval unavailable')
      return decision
    })
    // A pending brief is metadata, not evidence that any session belongs to us.
    a.emit({ type: 'session.tool.input.started', data: { sessionID: 'parent-a', id: 'spawn', name: 'subagent' } })
    a.emit({ type: 'session.tool.called', data: { sessionID: 'parent-a', id: 'spawn', input: { agent: 'researcher', prompt: 'find evidence' } } })
    a.emit({ type: 'session.created', data: { sessionID: 'stranger', agent: 'researcher', parentID: 'other-parent' } })
    a.emit({ type: 'session.created', data: { sessionID: 'unlinked', agent: 'researcher' } })
    a.emit({ type: 'session.created', data: { sessionID: 'child-a', agent: 'researcher', parentID: 'parent-a' } })
    a.emit({ type: 'session.created', data: { sessionID: 'grandchild-a', agent: 'reviewer', parentID: 'child-a' } })
    for (const sessionID of ['stranger', 'unlinked', 'child-a', 'grandchild-a']) {
      a.emit({ type: 'permission.asked', data: { sessionID, id: sessionID, action: 'read', resources: ['notes'] } })
      a.emit({ type: 'session.text.delta', data: { sessionID, delta: 'crew report' } })
      a.emit({ type: 'session.execution.succeeded', data: { sessionID } })
    }
    await finish()
    expect(a.host.permission).toHaveBeenCalledTimes(2)
    expect(b.host.permission).not.toHaveBeenCalled()
    expect(a.client.replyPermission).toHaveBeenCalledTimes(2)
    const expectedDecision = decision === 'throw' ? 'reject' : decision
    expect(a.client.replyPermission).toHaveBeenCalledWith('child-a', 'child-a', expectedDecision)
    expect(a.client.replyPermission).toHaveBeenCalledWith('grandchild-a', 'grandchild-a', expectedDecision)
    expect(a.host.onCrew).toHaveBeenCalledTimes(4)
    expect(a.host.onCrew).toHaveBeenCalledWith({ kind: 'started', sessionId: 'child-a', specialist: 'researcher', instruction: 'find evidence' })
    expect(a.host.onCrew).toHaveBeenCalledWith({ kind: 'finished', sessionId: 'grandchild-a', specialist: 'reviewer', report: 'crew report' })
    expect(b.host.onCrew).not.toHaveBeenCalled()
    expect(inputA.onText).not.toHaveBeenCalled()
    expect(a.host.executeTool).not.toHaveBeenCalled()
  })

  it('keeps parent and child tool names separate even when call ids overlap', async () => {
    const { a, finish } = await simultaneousTurns()
    a.emit({ type: 'session.created', data: { sessionID: 'child-a', parentID: 'parent-a', agent: 'researcher' } })
    a.emit({ type: 'session.tool.input.started', data: { sessionID: 'parent-a', id: 'shared', name: 'glob' } })
    a.emit({ type: 'session.tool.input.started', data: { sessionID: 'child-a', id: 'shared', name: 'selfimpulse_scope_list_files' } })
    a.emit({ type: 'session.tool.called', data: { sessionID: 'parent-a', id: 'shared' } })
    a.emit({ type: 'session.tool.called', data: { sessionID: 'child-a', id: 'shared' } })
    a.emit({ type: 'session.tool.success', data: { sessionID: 'child-a', id: 'shared', content: 'files' } })
    await finish()
    expect(a.steps).toEqual([{ id: 'shared', tool: 'glob', status: 'running' }])
    expect(a.host.onCrew).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'step', sessionId: 'child-a', step: expect.objectContaining({ tool: 'list_files', status: 'running' })
    }))
    expect(a.host.onCrew).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'step', sessionId: 'child-a', step: expect.objectContaining({ tool: 'list_files', status: 'ok', output: 'files' })
    }))
  })
})

describe('engine turn cancellation before execution', () => {
  it.each([undefined, 'existing-session'])('does no setup for a pre-aborted input (session: %s)', async (sessionId) => {
    const h = harness()
    h.host.sessionId = sessionId
    const controller = new AbortController()
    controller.abort()
    const prompt = vi.spyOn(h.client, 'prompt').mockImplementation(async (sessionID) => {
      h.emit({ type: 'session.execution.succeeded', data: { sessionID } })
    })
    const result = await runEngineTurn(turnInput(controller.signal), h.host, h.client)
    expect(result).toEqual({ finalResponse: null, messages: [], apiCallCount: 0, usage: { prompt: 0, completion: 0, total: 0 }, toolCalls: 0, stopReason: 'interrupted' })
    expect(h.client.createSession).not.toHaveBeenCalled()
    expect(h.host.onSession).not.toHaveBeenCalled()
    expect(h.client.putInstruction).not.toHaveBeenCalled()
    expect(writeFileSync).not.toHaveBeenCalled()
    expect(h.client.onEvent).not.toHaveBeenCalled()
    expect(h.client.waitForTools).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(h.client.interrupt).not.toHaveBeenCalled()
    expect(h.host.permission).not.toHaveBeenCalled()
    expect(h.host.executeTool).not.toHaveBeenCalled()
  })

  it.each(['createSession', 'putInstruction', 'instructionFailure', 'waitForTools'] as const)('does not prompt when cancelled during %s', async (stage) => {
    const h = harness()
    const controller = new AbortController()
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener')
    const prompt = vi.spyOn(h.client, 'prompt')
    if (stage === 'createSession') {
      vi.spyOn(h.client, 'createSession').mockImplementation(async () => {
        controller.abort()
        return { id: 'session-1' }
      })
    } else if (stage === 'putInstruction' || stage === 'instructionFailure') {
      vi.spyOn(h.client, 'putInstruction').mockImplementation(async () => {
        controller.abort()
        if (stage === 'instructionFailure') throw new Error('route unavailable')
      })
    } else {
      vi.spyOn(h.client, 'waitForTools').mockImplementation(async () => {
        controller.abort()
        return true
      })
    }
    const result = await runEngineTurn(turnInput(controller.signal), h.host, h.client)
    expect(result).toMatchObject({ stopReason: 'interrupted', apiCallCount: 0, toolCalls: 0 })
    expect(prompt).not.toHaveBeenCalled()
    expect(writeFileSync).not.toHaveBeenCalled()
    expect(h.listenerCount()).toBe(0)
    if (stage === 'createSession') expect(h.client.putInstruction).not.toHaveBeenCalled()
    if (stage !== 'waitForTools') expect(h.client.waitForTools).not.toHaveBeenCalled()
    if (stage === 'waitForTools') {
      expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
    }
  })
})
