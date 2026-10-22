import Anthropic from '@anthropic-ai/sdk'
import type { ProviderEvent, ProviderToolSpec, WireMessage } from './provider'

/**
 * The Anthropic branch of the unified provider.
 *
 * The backend speaks the OpenAI wire format to everything else; Anthropic has
 * its own message shape, so this module converts the same message list into
 * Anthropic blocks and emits the same event stream. One event contract, two
 * wire formats.
 */

type AnthropicMessage = Anthropic.MessageParam

function toAnthropicMessages(messages: WireMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []

  const push = (role: 'user' | 'assistant', blocks: Anthropic.ContentBlockParam[]): void => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role && Array.isArray(last.content)) {
      last.content.push(...blocks)
      return
    }
    out.push({ role, content: blocks })
  }

  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'user') {
      const text = (message.content ?? '').trim()
      if (text) push('user', [{ type: 'text', text }])
      continue
    }
    if (message.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = []
      const text = (message.content ?? '').trim()
      if (text) blocks.push({ type: 'text', text })
      for (const call of message.tool_calls ?? []) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        } catch {
          input = {}
        }
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input
        })
      }
      push('assistant', blocks)
      continue
    }
    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id ?? '',
          content: message.content ?? ''
        }
      ])
    }
  }

  if (!out.length || out[0].role !== 'user') {
    out.unshift({
      role: 'user',
      content: [{ type: 'text', text: 'Begin the task. Use the available tools when helpful.' }]
    })
  }
  return out
}

function toAnthropicTools(tools: ProviderToolSpec[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters as Anthropic.Tool.InputSchema
  }))
}

export interface AnthropicStreamOptions {
  apiKey: string
  baseUrl?: string
  model: string
  messages: WireMessage[]
  tools?: ProviderToolSpec[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export async function* streamAnthropic(
  options: AnthropicStreamOptions
): AsyncGenerator<ProviderEvent, void, unknown> {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl || undefined
  })

  const system = options.messages
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content ?? ''))
    .join('\n\n')

  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(options.messages),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.tools && options.tools.length
        ? { tools: toAnthropicTools(options.tools) }
        : {})
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const queue: ProviderEvent[] = []
  let finished = false
  let wake: (() => void) | null = null
  const notify = (): void => {
    const resolve = wake
    wake = null
    resolve?.()
  }

  stream.on('text', (delta) => {
    queue.push({ type: 'text', delta })
    notify()
  })

  const finalPromise = stream.finalMessage()
  finalPromise.then(
    () => {
      finished = true
      notify()
    },
    () => {
      finished = true
      notify()
    }
  )

  // The SDK pushes text deltas through an event emitter; this bridges them into
  // the generator so the caller sees the same incremental text as every other
  // provider.
  for (;;) {
    while (queue.length) {
      yield queue.shift() as ProviderEvent
    }
    if (finished) break
    await new Promise<void>((resolve) => {
      wake = resolve
    })
  }

  const final = await finalPromise

  let index = 0
  for (const block of final.content) {
    if (block.type !== 'tool_use') continue
    yield {
      type: 'tool_call',
      index: index++,
      id: block.id,
      name: block.name,
      args: JSON.stringify(block.input ?? {})
    }
  }

  yield {
    type: 'usage',
    usage: {
      prompt_tokens: final.usage.input_tokens ?? 0,
      completion_tokens: final.usage.output_tokens ?? 0,
      total_tokens: (final.usage.input_tokens ?? 0) + (final.usage.output_tokens ?? 0)
    }
  }

  yield { type: 'done' }
}
