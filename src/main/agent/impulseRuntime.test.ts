import { describe, expect, it, vi } from 'vitest'
import type { Provider, ProviderEvent, WireMessage } from '../backend/provider'
import { runEngineTurn, type EngineInput } from './engine'
import type { AgentTool } from './tools/types'

function providerWith(responses: Array<ProviderEvent[] | Error>): Provider {
  let calls = 0
  return {
    stream: async function* (_messages: WireMessage[]) {
      const response = responses[calls++]
      if (!response) throw new Error('Unexpected model call')
      if (response instanceof Error) throw response
      for (const event of response) yield event
    },
    complete: vi.fn()
  } as unknown as Provider
}

const readTool: AgentTool = {
  name: 'read_file',
  title: 'Read',
  description: 'Read',
  inputSchema: { type: 'object', properties: {} },
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  execute: async () => ({ content: 'ok' })
}

function input(provider: Provider, overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    provider,
    tools: [readTool],
    systemPrompt: 'You are Captain.',
    history: [],
    userMessage: 'Initial request',
    memoryStore: {} as EngineInput['memoryStore'],
    skillsDir: '/tmp/impulse-runtime-tests',
    config: {
      maxIterations: 4,
      backgroundReview: false,
      skillNudgeInterval: 0,
      memoryNudgeInterval: 0
    },
    signal: new AbortController().signal,
    onText: () => undefined,
    onTool: async () => ({ content: 'ok' }),
    emit: () => undefined,
    ...overrides
  }
}

describe('Impulse Runtime engine boundaries', () => {
  it('commits a drained steering batch after a successful model response', async () => {
    const provider = providerWith([
      [{ type: 'text', delta: 'Done.' }, { type: 'done' }]
    ])
    const commit = vi.fn()
    const restore = vi.fn()
    const drain = vi.fn(() => [{ role: 'user' as const, content: 'Additional steering' }])
    const result = await runEngineTurn(
      input(provider, {
        drainUserMessages: drain,
        commitUserMessages: commit,
        restoreUserMessages: restore
      })
    )
    expect(result.finalResponse).toBe('Done.')
    expect(drain).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledOnce()
    expect(restore).not.toHaveBeenCalled()
  })

  it('restores an uncommitted steering batch when the provider fails', async () => {
    const provider = providerWith([new Error('provider offline')])
    const commit = vi.fn()
    const restore = vi.fn()
    await expect(
      runEngineTurn(
        input(provider, {
          drainUserMessages: () => [{ role: 'user', content: 'Keep this steering' }],
          commitUserMessages: commit,
          restoreUserMessages: restore
        })
      )
    ).rejects.toThrow('provider offline')
    expect(commit).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledOnce()
  })

  it('stops dominated repetitive output at the provider delta boundary', async () => {
    const repeated = 'Repeated output without progress. '.repeat(1000)
    const provider = providerWith([[{ type: 'text', delta: repeated }]])
    const emit = vi.fn()
    const onText = vi.fn()
    await expect(runEngineTurn(input(provider, { emit, onText }))).rejects.toThrow(
      'Repetitive model output was stopped'
    )
    expect(onText).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'agent:repetition_guard',
      expect.objectContaining({ message: expect.stringContaining('Repetitive model output') })
    )
  })
})
