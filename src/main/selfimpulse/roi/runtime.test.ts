import { describe, expect, it } from 'vitest'
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt
} from './runtime/index.js'

const ApprovalState = Annotation.Root({
  request: Annotation<string>(),
  approved: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false
  }),
  completions: Annotation<number>({
    reducer: (left, right) => left + right,
    default: () => 0
  })
})

describe('SELF-ΡΟΗ durable execution', () => {
  it('checkpoints an interrupt and resumes the interrupted node from its start', async () => {
    const checkpointer = new MemorySaver()
    let entries = 0
    const graph = new StateGraph(ApprovalState)
      .addNode('approval', (state) => {
        entries += 1
        const decision = interrupt({ kind: 'approval', request: state.request }) as {
          approved: boolean
        }
        return { approved: decision.approved, completions: 1 }
      })
      .addEdge(START, 'approval')
      .addEdge('approval', END)
      .compile({ checkpointer })
    const config = { configurable: { thread_id: 'roi-approval-test' } }

    const paused = await graph.invoke({ request: 'publish the report' }, config)
    const pending = (paused as typeof paused & { __interrupt__?: Array<{ value: unknown }> })
      .__interrupt__
    expect(pending?.[0]?.value).toEqual({
      kind: 'approval',
      request: 'publish the report'
    })
    expect(entries).toBe(1)

    const snapshot = await graph.getState(config)
    expect(snapshot.values.request).toBe('publish the report')

    const resumed = await graph.invoke(new Command({ resume: { approved: true } }), config)
    expect(resumed.approved).toBe(true)
    expect(resumed.completions).toBe(1)
    // Interrupt resume restarts this node, so side effects belong outside it
    // or behind an idempotent boundary. The completion reducer runs only once.
    expect(entries).toBe(2)
  })

  it('keeps independent thread checkpoints isolated', async () => {
    const checkpointer = new MemorySaver()
    const graph = new StateGraph(ApprovalState)
      .addNode('approval', (state) => {
        const decision = interrupt({ request: state.request }) as { approved: boolean }
        return { approved: decision.approved, completions: 1 }
      })
      .addEdge(START, 'approval')
      .addEdge('approval', END)
      .compile({ checkpointer })

    await graph.invoke(
      { request: 'first' },
      { configurable: { thread_id: 'roi-thread-a' } }
    )
    await graph.invoke(
      { request: 'second' },
      { configurable: { thread_id: 'roi-thread-b' } }
    )
    const first = await graph.getState({ configurable: { thread_id: 'roi-thread-a' } })
    const second = await graph.getState({ configurable: { thread_id: 'roi-thread-b' } })
    expect(first.values.request).toBe('first')
    expect(second.values.request).toBe('second')
  })
})
