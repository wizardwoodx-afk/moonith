import type { ModelMessage } from '../backend/core/types'

/**
 * Context compaction for the live turn loop.
 *
 * The engine used to send the entire transcript to the provider on every
 * iteration (engine.ts built `[system, ...history]` and never looked back), so
 * a long task walked into the model's context ceiling and the call simply
 * failed. This folds the oldest whole turns into a running summary and keeps
 * the recent tail verbatim.
 *
 * The fold cut only ever lands on a GROUP boundary — an assistant message that
 * carries tool calls travels with every tool result that answers it. Cutting
 * inside such a group leaves the provider with an orphaned `tool_call_id` and
 * it rejects the request, which would be worse than the overflow.
 */

/** Rough token count. Providers charge by tokens; four characters is the
 *  cheapest estimate that does not need a tokenizer dependency. */
export function estimateTokens(messages: ModelMessage[]): number {
  let characters = 0
  for (const message of messages) {
    characters += (message.content ?? '').length
    for (const call of message.toolCalls ?? []) {
      characters += call.name.length + JSON.stringify(call.args ?? {}).length
    }
  }
  return Math.ceil(characters / 4)
}

/** Tokens left for the answer, the tool schemas and the system prompt. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 48_000

/** Whole turns kept verbatim at the end of the transcript. */
const KEEP_GROUPS = 6

export interface CompactionPlan {
  /** Index in the transcript where the kept tail starts. Everything from 1 up
   *  to this index is folded into the summary. */
  cut: number
  /** The turns being folded, oldest first. */
  fold: ModelMessage[]
  /** The turns that stay verbatim, including the system prompt. */
  keep: ModelMessage[]
}

/**
 * Split a transcript into atomic groups. Index 0 (the system prompt) is always
 * its own group, so it can never be folded away.
 */
export function groupTurns(messages: ModelMessage[]): ModelMessage[][] {
  const groups: ModelMessage[][] = []
  if (!messages.length) return groups

  groups.push([messages[0]])
  let current: ModelMessage[] | null = null
  for (const message of messages.slice(1)) {
    // A tool result belongs to the assistant turn that asked for it.
    if (message.role === 'tool' && current) {
      current.push(message)
      continue
    }
    current = [message]
    groups.push(current)
  }
  return groups
}

export function planCompaction(
  messages: ModelMessage[],
  options: {
    budgetTokens?: number
    /** Already folded up to this index on a previous pass. */
    foldedThrough?: number
    /** Prompt tokens the provider reported for the last call. Char/4
     *  undercounts code and CJK, so a real number wins when we have one. */
    measuredTokens?: number
  } = {}
): CompactionPlan | null {
  const budget = options.budgetTokens ?? DEFAULT_CONTEXT_TOKEN_BUDGET
  const foldedThrough = Math.max(1, options.foldedThrough ?? 1)
  const live = [messages[0], ...messages.slice(foldedThrough)]
  const size = Math.max(estimateTokens(live), options.measuredTokens ?? 0)
  if (size <= budget) return null

  const groups = groupTurns(messages.slice(foldedThrough))
  // Keep the most recent tail; fold the rest. Fewer groups than the tail is
  // nothing worth folding yet — one oversized tool result is bounded by the
  // per-result caps, not by compaction.
  if (groups.length <= KEEP_GROUPS) return null

  const folded = groups.slice(0, groups.length - KEEP_GROUPS).flat()
  const cut = folded.length + foldedThrough
  // Refuse a pass that folds almost nothing; it would spend a model call to
  // move two messages.
  if (estimateTokens(folded) < budget / 8) return null

  return {
    cut,
    fold: folded,
    keep: [messages[0], ...messages.slice(cut)]
  }
}

export const COMPACTION_SYSTEM = `You compress part of a working transcript for an agent that has to keep going without it.

Return a single block of notes, no preamble and no closing remark, that preserves:
- what the user actually asked for, and any correction they made since
- decisions already taken and the reason for each
- file paths, commands, identifiers, numbers and names, quoted exactly as written
- work already completed, and what is still open
- any failure that has not been resolved

Under 300 words. Never invent anything the transcript does not say. Never write in the first person.`

/** Render the transcript the summariser is asked to compress. */
export function renderTranscript(messages: ModelMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    const body = (message.content ?? '').trim()
    if (message.role === 'tool') {
      if (body) lines.push(`tool result: ${body}`)
      continue
    }
    if (body) lines.push(`${message.role}: ${body}`)
    for (const call of message.toolCalls ?? []) {
      lines.push(`${message.role} called ${call.name} with ${JSON.stringify(call.args ?? {})}`)
    }
  }
  return lines.join('\n')
}

export function summaryMessage(summary: string): ModelMessage {
  return {
    role: 'user',
    content: `Earlier in this task, before the part you can see:\n\n${summary}`,
    synthetic: true,
    name: 'context_summary'
  }
}

/** The transcript actually sent to the provider: system prompt, the running
 *  summary of everything folded away, then the verbatim tail. */
export function outboundContext(
  messages: ModelMessage[],
  summary: string,
  foldedThrough: number
): ModelMessage[] {
  if (!summary) return messages
  return [messages[0], summaryMessage(summary), ...messages.slice(Math.max(1, foldedThrough))]
}
