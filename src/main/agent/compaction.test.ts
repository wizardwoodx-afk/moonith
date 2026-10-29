import { describe, expect, it } from 'vitest'
import type { ModelMessage } from '../backend/core/types'
import type { ChatMessage } from '@shared/types'
import {
  estimateTokens,
  groupTurns,
  outboundContext,
  planCompaction,
  renderTranscript,
  summaryMessage
} from './compaction'

const filler = (seed: string): string => seed.repeat(40)

function turn(index: number): ModelMessage[] {
  return [
    { role: 'user', content: `step ${index}: ${filler('read the config')} ` },
    {
      role: 'assistant',
      content: `reading ${index}`,
      toolCalls: [{ id: `call_${index}`, name: 'read_file', args: { path: `src/${index}.ts` } }]
    },
    { role: 'tool', content: `${filler('file body')} ${index}`, toolCallId: `call_${index}` },
    { role: 'assistant', content: `noted ${index}: ${filler('answer')} ` }
  ]
}

function transcript(turns: number): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: 'system', content: 'You are the agent.' }]
  for (let index = 1; index <= turns; index++) messages.push(...turn(index))
  return messages
}

describe('groupTurns', () => {
  it('keeps an assistant turn welded to the tool results that answer it', () => {
    const groups = groupTurns(transcript(3))
    expect(groups[0]).toEqual([{ role: 'system', content: 'You are the agent.' }])
    for (const group of groups.slice(1)) {
      const first = group[0]
      expect(first.role).not.toBe('tool')
      for (const message of group.slice(1)) expect(message.role).toBe('tool')
    }
  })
})

describe('planCompaction', () => {
  it('does nothing while the transcript fits the budget', () => {
    expect(planCompaction(transcript(2), { budgetTokens: 100_000 })).toBeNull()
  })

  it('folds the oldest turns and keeps the recent tail', () => {
    const messages = transcript(12)
    const plan = planCompaction(messages, { budgetTokens: 100 })
    expect(plan).not.toBeNull()
    const plan_ = plan as NonNullable<typeof plan>
    expect(plan_.cut).toBeGreaterThan(1)
    expect(plan_.fold.length + plan_.keep.length).toBe(messages.length)
    // The system prompt survives on the kept side even though it is at index 0.
    expect(plan_.keep[0].role).toBe('system')
    expect(plan_.keep.length).toBeGreaterThan(1)
  })

  it('never cuts between an assistant tool call and its result', () => {
    const messages = transcript(12)
    const plan = planCompaction(messages, { budgetTokens: 100 }) as NonNullable<
      ReturnType<typeof planCompaction>
    >
    const foldedIds = new Set(
      plan.fold.flatMap((message) => (message.toolCalls ?? []).map((call) => call.id))
    )
    for (const kept of plan.keep) {
      if (kept.role !== 'tool' || !kept.toolCallId) continue
      expect(foldedIds.has(kept.toolCallId)).toBe(false)
    }
    // Equivalently: the message the cut lands on is never an orphaned result.
    expect(messages[plan.cut].role).not.toBe('tool')
  })

  it('trusts the provider token count over the character estimate', () => {
    const messages = transcript(12)
    expect(estimateTokens(messages)).toBeLessThan(10_000)
    // Fits on the estimate and nothing has been measured: leave it alone.
    expect(planCompaction(messages, { budgetTokens: 10_000 })).toBeNull()
    // The provider says the last call cost far more than the estimate: fold.
    expect(planCompaction(messages, { budgetTokens: 10_000, measuredTokens: 40_000 })).not.toBeNull()
  })

  it('folds only fresh turns on a second pass', () => {
    const early = transcript(12)
    const first = planCompaction(early, { budgetTokens: 100 }) as NonNullable<
      ReturnType<typeof planCompaction>
    >
    const later = [...early, ...transcript(12).slice(1)]
    const second = planCompaction(later, { budgetTokens: 100, foldedThrough: first.cut }) as NonNullable<
      ReturnType<typeof planCompaction>
    >
    expect(second.cut).toBeGreaterThan(first.cut)
    expect(second.fold.some((message) => first.fold.includes(message))).toBe(false)
  })
})

describe('outboundContext', () => {
  it('sends the system prompt, the notes, then the verbatim tail', () => {
    const messages = transcript(12)
    const plan = planCompaction(messages, { budgetTokens: 100 }) as NonNullable<
      ReturnType<typeof planCompaction>
    >
    const outbound = outboundContext(messages, 'Folded notes go here.', plan.cut)
    expect(outbound[0].role).toBe('system')
    expect(outbound[1].name).toBe('context_summary')
    expect(outbound[1].synthetic).toBe(true)
    expect(outbound[1].content).toContain('Folded notes go here.')
    expect(outbound.length).toBe(plan.keep.length + 1)
    expect(outbound.slice(2)).toEqual(plan.keep.slice(1))
  })

  it('sends the transcript untouched before the first compaction', () => {
    const messages = transcript(3)
    expect(outboundContext(messages, '', 1)).toBe(messages)
  })
})

describe('renderTranscript', () => {
  it('names the tool and its arguments so the summariser can quote them', () => {
    const text = renderTranscript(transcript(1))
    expect(text).toContain('called read_file')
    expect(text).toContain('src/1.ts')
    expect(text).toContain('tool result:')
    expect(summaryMessage('notes').content).toContain('notes')
  })
})

describe('Qoder-style compacted message structure', () => {
  it('preserves executive summary markers and folded message payloads', () => {
    const rawMessages = [
      { id: 'm1', role: 'user' as const, content: 'Analyze the system performance', createdAt: new Date().toISOString() },
      { id: 'm2', role: 'assistant' as const, content: 'Scanning metrics and profiling latency...', createdAt: new Date().toISOString() },
      { id: 'm3', role: 'user' as const, content: 'Apply the recommendations', createdAt: new Date().toISOString() },
      { id: 'm4', role: 'assistant' as const, content: 'Applied optimizations. All tests passing.', createdAt: new Date().toISOString() }
    ]

    const folded = rawMessages.slice(0, 2)
    const kept = rawMessages.slice(2)
    const summary = '### Context Executive Summary\n- Initial Objective: Analyze system performance\n- Retaining recent turns'

    const compactedRecord: ChatMessage = {
      id: 'compact-test-1',
      role: 'assistant' as const,
      content: summary,
      createdAt: new Date().toISOString(),
      isCompacted: true,
      compactedSummary: summary,
      savedTokens: 420,
      foldedCount: folded.length,
      foldedMessages: folded
    }

    const compactedTaskMessages: ChatMessage[] = [compactedRecord, ...kept]

    expect(compactedTaskMessages[0].isCompacted).toBe(true)
    expect(compactedTaskMessages[0].foldedCount).toBe(2)
    expect(compactedTaskMessages[0].foldedMessages?.length).toBe(2)
    expect(compactedTaskMessages[0].savedTokens).toBe(420)
    expect(compactedTaskMessages.length).toBe(3)
  })
})
