import Anthropic from '@anthropic-ai/sdk'
import type {
  CompletionRequest,
  CompletionResult,
  ProviderToolCall,
  ProviderToolSpec
} from '../types'
import type { ChatMessage, TokenUsage } from '@shared/types'
import { safeJsonParse } from '../../util'
import { formatAnthropicUserBlocks } from '../multimodal'

type AnthropicMessage = Anthropic.MessageParam

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
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
      const userBlocks = formatAnthropicUserBlocks(message)
      if (userBlocks.length) push('user', userBlocks)
      continue
    }
    if (message.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = []
      if (message.content.trim()) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: (call.arguments ?? {}) as Record<string, unknown>
        })
      }
      push('assistant', blocks)
      continue
    }
    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          content: message.content,
          is_error: message.error
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
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema
  }))
}

export async function streamAnthropic(request: CompletionRequest): Promise<CompletionResult> {
  const client = new Anthropic({
    apiKey: request.apiKey,
    baseURL: request.baseUrl || undefined
  })

  const stream = client.messages.stream(
    {
      model: request.model,
      max_tokens: 8192,
      system: request.system,
      messages: toAnthropicMessages(request.messages),
      tools: request.tools.length ? toAnthropicTools(request.tools) : undefined
    },
    { signal: request.signal }
  )

  let text = ''
  stream.on('text', (delta) => {
    text += delta
    request.onText(delta)
  })

  const final = await stream.finalMessage()
  const toolCalls: ProviderToolCall[] = []
  for (const block of final.content) {
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>
      })
    }
  }

  const usage: TokenUsage | undefined = final.usage
    ? {
        input: final.usage.input_tokens ?? 0,
        output: final.usage.output_tokens ?? 0,
        total: (final.usage.input_tokens ?? 0) + (final.usage.output_tokens ?? 0)
      }
    : undefined

  if (!text.trim()) {
    text = final.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  return {
    text,
    toolCalls,
    usage,
    finishReason: final.stop_reason ?? undefined
  }
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  return safeJsonParse<Record<string, unknown>>(raw) ?? {}
}
