import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Provider,
  ProviderEvent,
  StreamOptions,
  WireMessage
} from '../backend/provider'
import type { TurnResult } from '../backend/core/types'
import { DurableStore } from '../selfimpulse/durable/index'
import {
  runEngineTurn,
  toEngineHistory,
  toolToWireSpec,
  turnFailureMessage,
  type EngineInput
} from './engine'
import type { AgentTool } from './tools/types'

type StreamHandler = (
  messages: WireMessage[],
  options: StreamOptions
) => AsyncIterable<ProviderEvent>

interface ProviderCall {
  messages: WireMessage[]
  options: StreamOptions
}

function fakeProvider(responses: Array<ProviderEvent[] | Error | StreamHandler>): {
  provider: Provider
  calls: ProviderCall[]
} {
  const calls: ProviderCall[] = []
  const provider = {
    stream: async function* (messages: WireMessage[], options: StreamOptions = {}) {
      calls.push({ messages, options })
      const response = responses[calls.length - 1]
      if (!response) throw new Error(`Unexpected model call ${calls.length}`)
      if (response instanceof Error) throw response
      if (typeof response === 'function') {
        yield* response(messages, options)
        return
      }
      for (const event of response) yield event
    },
    complete: vi.fn()
  } as unknown as Provider
  return { provider, calls }
}

function engineInput(provider: Provider, overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    provider,
    tools: [],
    systemPrompt: 'You are Captain.',
    history: [],
    userMessage: 'Do the work.',
    memoryStore: {} as EngineInput['memoryStore'],
    skillsDir: '/tmp/self-roi-engine-tests',
    config: {
      maxIterations: 8,
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

function textResponse(text: string): ProviderEvent[] {
  return [
    { type: 'text', delta: text },
    {
      type: 'usage',
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
    },
    { type: 'done' }
  ]
}

describe('SELF-ΡΟΗ Captain engine', () => {
  it('streams model text and returns usage through the existing turn contract', async () => {
    const { provider, calls } = fakeProvider([
      [
        { type: 'text', delta: 'Hello ' },
        { type: 'text', delta: 'Captain' },
        {
          type: 'usage',
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
        },
        { type: 'done' }
      ]
    ])
    const deltas: string[] = []
    const result = await runEngineTurn(
      engineInput(provider, {
        context: 'Relevant memory',
        onText: (delta) => deltas.push(delta)
      })
    )

    expect(deltas).toEqual(['Hello ', 'Captain'])
    expect(result.finalResponse).toBe('Hello Captain')
    expect(result.stopReason).toBe('final')
    expect(result.apiCallCount).toBe(1)
    expect(result.usage).toEqual({ prompt: 4, completion: 2, total: 6 })
    expect(calls).toHaveLength(1)
    expect(calls[0].messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'user'
    ])
    expect(calls[0].options.signal).toBeDefined()
  })

  it('sends only protected messages across the provider boundary', async () => {
    const { provider, calls } = fakeProvider([textResponse('Done.')])
    const protectModelMessages = vi.fn((messages: EngineInput['history']) =>
      messages.map((message) => ({
        ...message,
        content: message.content?.replace('person@example.com', '[redacted:email]') ?? null
      }))
    )
    await runEngineTurn(
      engineInput(provider, {
        userMessage: 'Contact person@example.com',
        protectModelMessages
      })
    )
    expect(protectModelMessages).toHaveBeenCalledOnce()
    expect(JSON.stringify(calls[0].messages)).not.toContain('person@example.com')
    expect(JSON.stringify(calls[0].messages)).toContain('[redacted:email]')
  })

  it('fails closed before provider egress when message protection rejects', async () => {
    const { provider, calls } = fakeProvider([textResponse('Should not arrive.')])
    await expect(
      runEngineTurn(
        engineInput(provider, {
          protectModelMessages: () => {
            throw new Error('blocked by DLP')
          }
        })
      )
    ).rejects.toThrow('blocked by DLP')
    expect(calls).toHaveLength(0)
  })

  it('executes tools with their original ids and builds a valid follow-up transcript', async () => {
    const { provider, calls } = fakeProvider([
      [
        {
          type: 'tool_call',
          index: 0,
          id: 'call_read',
          name: 'read_file',
          args: '{"path":"notes.txt"}'
        },
        { type: 'done' }
      ],
      textResponse('Read complete.')
    ])
    const onTool = vi.fn(async () => ({
      content: 'file contents',
      mutatedPaths: ['notes.txt']
    }))
    const result = await runEngineTurn(engineInput(provider, { onTool }))

    expect(onTool).toHaveBeenCalledWith('call_read', 'read_file', { path: 'notes.txt' })
    expect(result.toolCalls).toBe(1)
    expect(result.apiCallCount).toBe(2)
    expect(calls[1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_read',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"notes.txt"}'
              }
            }
          ]
        }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_read' })
      ])
    )
    expect(result.finalResponse).toBe('Read complete.')
  })

  it('runs adjacent Crew delegations concurrently without reordering tool results', async () => {
    const { provider } = fakeProvider([
      [
        {
          type: 'tool_call',
          index: 0,
          id: 'crew_a',
          name: 'delegate_to_crew',
          args: '{"name":"A","instruction":"inspect A"}'
        },
        {
          type: 'tool_call',
          index: 1,
          id: 'crew_b',
          name: 'delegate_to_crew',
          args: '{"name":"B","instruction":"inspect B"}'
        },
        { type: 'done' }
      ],
      textResponse('Both reports are in.')
    ])

    let active = 0
    let maximumActive = 0
    let started = 0
    let release: () => void = () => undefined
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: Array<{ event: string; payload: unknown }> = []
    const result = await runEngineTurn(
      engineInput(provider, {
        onTool: async (callId) => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          started += 1
          if (started === 2) release()
          await bothStarted
          active -= 1
          return { content: `report ${callId}` }
        },
        emit: (event, payload) => events.push({ event, payload })
      })
    )

    expect(maximumActive).toBe(2)
    expect(
      result.messages
        .filter((message) => message.role === 'tool')
        .map((message) => message.toolCallId)
    ).toEqual(['crew_a', 'crew_b'])
    expect(events).toContainEqual({
      event: 'agent:crew_parallel',
      payload: expect.objectContaining({ count: 2, callIds: ['crew_a', 'crew_b'] })
    })
  })

  it('propagates provider errors instead of returning a successful turn', async () => {
    const { provider } = fakeProvider([new Error('provider 429: quota exhausted')])
    const events: Array<{ event: string; payload: unknown }> = []

    await expect(
      runEngineTurn(engineInput(provider, { emit: (event, payload) => events.push({ event, payload }) }))
    ).rejects.toThrow('provider 429')
    expect(events.some(({ event }) => event === 'agent:error')).toBe(true)
  })

  it('forwards cancellation into the active provider stream immediately', async () => {
    const controller = new AbortController()
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let providerSignal: AbortSignal | undefined
    const handler: StreamHandler = async function* (_messages, options) {
      providerSignal = options.signal
      markStarted()
      await new Promise<void>((_resolve, reject) => {
        const signal = options.signal
        if (!signal) {
          reject(new Error('missing provider abort signal'))
          return
        }
        if (signal.aborted) {
          reject(signal.reason ?? new Error('aborted'))
          return
        }
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
          once: true
        })
      })
    }
    const { provider } = fakeProvider([handler])
    const pending = runEngineTurn(engineInput(provider, { signal: controller.signal }))
    const rejection = expect(pending).rejects.toThrow(/stop now|abort/i)

    await started
    controller.abort(new Error('stop now'))
    await rejection
    expect(providerSignal).toBe(controller.signal)
  })

  it('distinguishes budget exhaustion from a completed answer', async () => {
    const { provider } = fakeProvider([
      [
        {
          type: 'tool_call',
          index: 0,
          id: 'only_call',
          name: 'read_file',
          args: '{}'
        },
        { type: 'done' }
      ]
    ])
    const result = await runEngineTurn(
      engineInput(provider, { config: { maxIterations: 1, backgroundReview: false } })
    )

    expect(result.stopReason).toBe('budget_exhausted')
    expect(result.finalResponse).toBeNull()
    expect(turnFailureMessage(result)).toMatch(/budget/i)
    expect(turnFailureMessage({ ...result, stopReason: 'final' })).toBeNull()
    expect(turnFailureMessage({ ...result, stopReason: 'interrupted' })).toBeNull()
    expect(
      turnFailureMessage({ ...result, stopReason: 'error', error: 'provider failed' })
    ).toBe('provider failed')
  })

  it('preserves assistant calls and their tool results in later-turn history', () => {
    const history = toEngineHistory([
      { id: 'u1', role: 'user', content: 'Inspect it', createdAt: '1' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        createdAt: '2',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } }]
      },
      {
        id: 't1',
        role: 'tool',
        content: 'contents',
        createdAt: '3',
        toolCallId: 'call_1',
        name: 'read_file'
      },
      { id: 'a2', role: 'assistant', content: 'Done', createdAt: '4' }
    ])

    expect(history.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant'
    ])
    expect(history[1].toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', args: { path: 'a.txt' } }
    ])
    expect(history[2]).toMatchObject({ toolCallId: 'call_1', name: 'read_file' })
  })

  it('keeps SelfImpulse tool schemas intact at the provider boundary', () => {
    const tool: AgentTool = {
      name: 'read_file',
      title: 'Read a file',
      description: 'Read a file',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      sideEffect: 'read',
      risk: 'low',
      approval: 'never',
      execute: async () => ({ content: '' })
    }

    expect(toolToWireSpec(tool)).toEqual({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      }
    })
  })

  it('exposes a typed failure for every non-final, non-interrupted stop', () => {
    const base: TurnResult = {
      finalResponse: null,
      messages: [],
      apiCallCount: 0,
      usage: { prompt: 0, completion: 0, total: 0 },
      toolCalls: 0,
      stopReason: 'final'
    }
    expect(turnFailureMessage({ ...base, stopReason: 'max_iterations' })).toMatch(/iteration/i)
    expect(turnFailureMessage({ ...base, stopReason: 'prelude_break' })).toMatch(/before/i)
    expect(turnFailureMessage(base)).toBeNull()
  })
})

describe('durable engine integration', () => {
  let journalRoot: string

  beforeEach(async () => {
    journalRoot = await mkdtemp(join(tmpdir(), 'selfimpulse-engine-journal-'))
  })

  afterEach(async () => {
    await rm(journalRoot, { recursive: true, force: true })
  })

  it('replays model and tool steps without calling new side-effect ports', async () => {
    const { provider: firstProvider, calls: firstCalls } = fakeProvider([
      [
        {
          type: 'tool_call',
          index: 0,
          id: 'call-replay',
          name: 'read_file',
          args: '{"path":"notes.txt"}'
        },
        { type: 'done' }
      ],
      textResponse('Recovered answer')
    ])
    const firstTool = vi.fn(async () => ({ content: 'file contents' }))
    const firstDurable = await new DurableStore(journalRoot).context('engine-replay')
    const first = await runEngineTurn(
      engineInput(firstProvider, { durable: firstDurable, onTool: firstTool })
    )
    expect(first.finalResponse).toBe('Recovered answer')
    expect(firstCalls).toHaveLength(2)
    expect(firstTool).toHaveBeenCalledTimes(1)

    const { provider: secondProvider, calls: secondCalls } = fakeProvider([])
    const secondTool = vi.fn(async () => ({ content: 'must not execute' }))
    const reopened = await new DurableStore(journalRoot).context('engine-replay')
    const second = await runEngineTurn(
      engineInput(secondProvider, { durable: reopened, onTool: secondTool })
    )
    expect(second.finalResponse).toBe('Recovered answer')
    expect(second.usage).toEqual(first.usage)
    expect(secondCalls).toHaveLength(0)
    expect(secondTool).not.toHaveBeenCalled()
  })

  it('does not cache a tool outcome produced after abort', async () => {
    const controller = new AbortController()
    const { provider } = fakeProvider([
      [
        {
          type: 'tool_call',
          index: 0,
          id: 'call-abort',
          name: 'read_file',
          args: '{"path":"notes.txt"}'
        },
        { type: 'done' }
      ]
    ])
    const durable = await new DurableStore(journalRoot).context('engine-abort', {
      signal: controller.signal
    })
    const interrupted = runEngineTurn(
      engineInput(provider, {
        durable,
        signal: controller.signal,
        onTool: async () => {
          controller.abort(new DOMException('Stopped', 'AbortError'))
          return { content: 'interrupted', isError: true }
        }
      })
    )
    await expect(interrupted).rejects.toThrow('Stopped')
    expect(durable.snapshot().entries['step:tool:call-abort']?.status).toBe('pending')

    const { provider: recoveredProvider, calls: recoveredCalls } = fakeProvider([
      textResponse('Finished after recovery')
    ])
    const recoveredTool = vi.fn(async () => ({ content: 'recovered contents' }))
    const reopened = await new DurableStore(journalRoot).context('engine-abort')
    const recovered = await runEngineTurn(
      engineInput(recoveredProvider, { durable: reopened, onTool: recoveredTool })
    )
    expect(recovered.finalResponse).toBe('Finished after recovery')
    expect(recoveredTool).toHaveBeenCalledTimes(1)
    expect(recoveredCalls).toHaveLength(1)
  })
})
