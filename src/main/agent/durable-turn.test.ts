/**
 * Two turns in one task, one journal.
 *
 * The journal is scoped to the task because approvals resume through it, and a
 * completed step is replayed rather than re-run. Model steps used to be named
 * `model:1`, `model:2`… so the second message in a task replayed the first
 * turn's answer verbatim instead of reaching the provider. This drives the real
 * graph twice against one journal and proves each turn makes its own call.
 */
import { describe, expect, it } from 'vitest'
import { runEngineTurn } from './engine'
import type { ModelMessage } from '../backend/core/types'
import type { Provider } from '../backend/provider'

/** Completed steps replay, exactly like the durable journal behind a task. */
function taskJournal(): {
  durable: unknown
  paths: () => string[]
} {
  const done = new Map<string, unknown>()
  return {
    durable: {
      actorId: 'task_demo',
      hasCompleted: (path: string) => done.has(path),
      run: async (path: string, fn: () => Promise<unknown>): Promise<unknown> => {
        if (done.has(path)) return done.get(path)
        const value = await fn()
        done.set(path, value)
        return value
      }
    },
    paths: () => [...done.keys()]
  }
}

function countingProvider(): {
  provider: Provider
  requests: string[][]
} {
  const requests: string[][] = []
  const provider = {
    settings: { providerId: 'stub', model: 'stub' },
    async *stream(messages: { role: string; content: string | null }[]) {
      requests.push(messages.map((message) => `${message.role}:${message.content ?? ''}`))
      yield { type: 'text', delta: `answer ${requests.length}` }
      yield { type: 'usage', usage: { prompt: 10 } }
    }
  }
  return { provider: provider as unknown as Provider, requests }
}

const emptyStore = {
  memories: { all: () => [], insert: () => null, remove: () => false }
} as never

function turn(
  provider: Provider,
  durable: unknown,
  history: ModelMessage[],
  userMessage: string
): Promise<{ finalResponse: string | null }> {
  return runEngineTurn({
    provider,
    durable: durable as never,
    tools: [],
    systemPrompt: 'You are the agent.',
    history,
    userMessage,
    memoryStore: emptyStore,
    skillsDir: '',
    config: {},
    signal: new AbortController().signal,
    onText: () => undefined,
    onTool: async () => ({ content: 'unused' }),
    emit: () => undefined
  })
}

describe('durable model steps', () => {
  it('calls the provider on every turn instead of replaying a completed step', async () => {
    const { durable, paths } = taskJournal()
    const { provider, requests } = countingProvider()

    const first = await turn(provider, durable, [], 'hey')
    const second = await turn(
      provider,
      durable,
      [
        { role: 'user', content: 'hey' },
        { role: 'assistant', content: 'answer 1' }
      ],
      'what is this one??'
    )

    expect(requests).toHaveLength(2)
    expect(requests[1].some((line) => line.includes('what is this one??'))).toBe(true)
    expect(first.finalResponse).toBe('answer 1')
    expect(second.finalResponse).toBe('answer 2')
    // Both turns journaled their own step; neither overwrote the other.
    expect(paths()).toHaveLength(2)
  })
})
