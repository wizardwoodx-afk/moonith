/**
 * Compaction in the live turn loop.
 *
 * The unit tests in compaction.test.ts cover the maths. This one drives the
 * real graph with a stub provider and proves the two things that actually
 * decide whether a long task survives: the provider is never handed the whole
 * transcript once it is over budget, and it is handed a summary in place of the
 * turns that were folded away.
 */
import { describe, expect, it } from 'vitest'
import { runEngineTurn } from './engine'
import type { ModelMessage, ToolCall } from '../backend/core/types'
import type { Provider } from '../backend/provider'

const bulky = (seed: string): string => seed.repeat(60)

function turn(index: number): ModelMessage[] {
  const call: ToolCall = { id: `call_${index}`, name: 'read_file', args: { path: `src/${index}.ts` } }
  return [
    { role: 'user', content: `turn ${index}: ${bulky('inspect the module')} ` },
    { role: 'assistant', content: `reading ${index}`, toolCalls: [call] },
    { role: 'tool', content: `${bulky('file contents here')} ${index}`, toolCallId: call.id },
    { role: 'assistant', content: `done ${index}: ${bulky('summary of findings')} ` }
  ]
}

function history(turns: number): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (let index = 1; index <= turns; index++) messages.push(...turn(index))
  return messages
}

/** Records every wire request so the test can read what the model was given. */
function stubProvider(reply: string): { provider: Provider; sent: string[][] } {
  const sent: string[][] = []
  const provider = {
    settings: { providerId: 'stub', model: 'stub' },
    async *stream(
      messages: { role: string; content: string | null }[]
    ): AsyncGenerator<{ type: 'text'; delta: string } | { type: 'usage'; usage: { prompt: number } }> {
      sent.push(messages.map((message) => `${message.role}:${message.content ?? ''}`))
      // The compaction call gets notes back; every other call ends the turn.
      const isCompaction = messages[0]?.content?.startsWith('You compress part')
      yield { type: 'text', delta: isCompaction ? 'Folded notes: the user wanted the module read.' : reply }
      yield { type: 'usage', usage: { prompt: 900 } }
    }
  }
  return { provider: provider as unknown as Provider, sent }
}

const emptyStore = {
  memories: { all: () => [], insert: () => null, remove: () => false }
} as never

function run(provider: Provider, turns: number, budgetTokens = 1_000): Promise<unknown> {
  return runEngineTurn({
    provider,
    tools: [],
    systemPrompt: 'You are the agent.',
    history: history(turns),
    userMessage: 'Keep going.',
    memoryStore: emptyStore,
    skillsDir: '',
    config: {},
    contextTokenBudget: budgetTokens,
    signal: new AbortController().signal,
    onText: () => undefined,
    onTool: async () => ({ content: 'unused' }),
    emit: () => undefined
  })
}

describe('the failure breaker', () => {
  /** A provider that only ever asks for the same tool. */
  function loopProvider(): { provider: Provider; calls: number } {
    const state = { provider: null as unknown as Provider, calls: 0 }
    state.provider = {
      settings: { providerId: 'stub', model: 'stub' },
      async *stream() {
        state.calls++
        yield {
          type: 'tool_call',
          index: 0,
          id: `call_${state.calls}`,
          name: 'probe',
          args: '{}'
        }
        yield { type: 'usage', usage: { prompt: 10 } }
      }
    } as unknown as Provider
    return state
  }

  const probeTool = {
    name: 'probe',
    title: 'Probe',
    description: 'Always fails.',
    inputSchema: { type: 'object', properties: {} },
    sideEffect: 'read',
    risk: 'low',
    approval: 'never'
  } as never

  it('stops a run that keeps failing the same tool instead of burning the budget', async () => {
    const { provider, calls } = loopProvider()
    const events: string[] = []
    let attempts = 0

    const result = (await runEngineTurn({
      provider,
      tools: [probeTool],
      systemPrompt: 'You are the agent.',
      history: [],
      userMessage: 'Do the thing.',
      memoryStore: emptyStore,
      skillsDir: '',
      config: {},
      contextTokenBudget: 50_000,
      signal: new AbortController().signal,
      onText: () => undefined,
      onTool: async () => {
        attempts++
        return { content: 'boom', isError: true }
      },
      emit: (event) => events.push(event)
    })) as { stopReason: string; apiCallCount: number }

    expect(result.stopReason).toBe('circuit_open')
    expect(events).toContain('agent:circuit_open')
    // Four failures are enough to prove the tool is stuck; 500 is not.
    expect(attempts).toBe(4)
    expect(calls).toBeLessThan(10)
  })
})

describe('turn-loop compaction', () => {
  it('sends the notes and the tail instead of the whole transcript', async () => {
    const { provider, sent } = stubProvider('Carrying on with the plan.')
    await run(provider, 12)

    const compactionCall = sent.find((messages) => messages[0].startsWith('system:You compress part'))
    const mainCall = sent.find((messages) => messages[0] === 'system:You are the agent.')

    expect(compactionCall).toBeDefined()
    expect(mainCall).toBeDefined()
    const main = mainCall as string[]
    // Twelve turns is 48 messages; the model must not see all of them plus the
    // system prompt, the user message and any context row.
    expect(main.length).toBeLessThan(20)
    expect(main.some((message) => message.includes('Earlier in this task, before the part you can see'))).toBe(
      true
    )
    expect(main.some((message) => message.includes('Folded notes: the user wanted the module read.'))).toBe(
      true
    )
    // The newest turn is still verbatim: compaction never eats the present.
    expect(main[main.length - 1]).toContain('Keep going.')
    expect(main[main.length - 2]).toContain('done 12')
  })

  it('sends the whole transcript when it fits', async () => {
    const { provider, sent } = stubProvider('All here.')
    await run(provider, 2, 50_000)

    const main = sent.find((messages) => messages[0] === 'system:You are the agent.') as string[]
    expect(sent.some((messages) => messages[0].startsWith('system:You compress part'))).toBe(false)
    expect(main.filter((message) => message.startsWith('user:turn')).length).toBe(2)
  })
})

/**
 * The answer critic holds a finished answer back once, so a turn that touched
 * the world has to check its own conclusion before the user sees it.
 */
describe('the answer critic', () => {
  function script(replies: Array<{ text?: string; tool?: string }>) {
    const sent: string[][] = []
    let call = 0
    const provider = {
      settings: { providerId: 'stub', model: 'stub' },
      async *stream(messages: { role: string; content: string | null }[]) {
        sent.push(messages.map((message) => `${message.role}:${message.content ?? ''}`))
        const reply = replies[Math.min(call, replies.length - 1)]
        call++
        if (reply?.tool) {
          yield { type: 'tool_call', index: 0, id: `c${call}`, name: reply.tool, args: '{}' }
        } else {
          yield { type: 'text', delta: reply?.text ?? 'The report is written.' }
        }
        yield { type: 'usage', usage: { prompt: 10 } }
      }
    } as unknown as Provider
    return { provider, sent }
  }

  const probeTool = {
    name: 'probe',
    title: 'Probe',
    description: 'Read something.',
    inputSchema: { type: 'object', properties: {} },
    sideEffect: 'read',
    risk: 'low',
    approval: 'never'
  } as never

  function drive(provider: Provider, tools: unknown[]) {
    return runEngineTurn({
      provider,
      tools: tools as never,
      systemPrompt: 'You are the agent.',
      history: [],
      userMessage: 'Write the report.',
      memoryStore: emptyStore,
      skillsDir: '',
      config: {},
      contextTokenBudget: 200_000,
      signal: new AbortController().signal,
      onText: () => undefined,
      onTool: async () => ({ content: 'read ok' }),
      emit: () => undefined
    })
  }

  it('holds a worked answer back once and asks for a self-check', async () => {
    const { provider, sent } = script([{ tool: 'probe' }, { text: 'Done: the report says X.' }])
    await drive(provider, [probeTool])
    const criticRows = sent.flatMap((rows) => rows.filter((row) => row.startsWith('user:Before this answer is delivered')))
    expect(criticRows.length).toBe(1)
    expect(criticRows[0]).toContain('Write the report.')
  })

  it('never fires for a plain answer that touched nothing', async () => {
    const { provider, sent } = script([{ text: 'Paris is the capital of France.' }])
    await drive(provider, [])
    expect(sent.flatMap((rows) => rows.filter((row) => row.includes('Before this answer is delivered')))).toEqual([])
  })

  it('critiques once, not every time it answers', async () => {
    const { provider, sent } = script([{ tool: 'probe' }, { text: 'first draft' }, { text: 'checked answer' }])
    await drive(provider, [probeTool])
    expect(sent.flatMap((rows) => rows.filter((row) => row.startsWith('user:Before this answer is delivered'))).length).toBe(1)
  })
})
