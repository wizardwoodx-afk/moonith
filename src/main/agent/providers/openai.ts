import OpenAI from 'openai'
import type {
  CompletionRequest,
  CompletionResult,
  ProviderToolCall,
  ProviderToolSpec
} from '../types'
import { STRUCTURED_OUTPUT_TOOL } from '../types'
import type { ChatMessage, TokenUsage } from '@shared/types'
import { safeJsonParse } from '../../util'

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

function toOpenAIMessages(system: string, messages: ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: system }]
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'user') {
      if (message.images?.length) {
        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []
        if (message.content.trim()) content.push({ type: 'text', text: message.content })
        for (const image of message.images) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.data}` }
          })
        }
        out.push({ role: 'user', content })
      } else if (message.content.trim()) {
        out.push({ role: 'user', content: message.content })
      }
      continue
    }
    if (message.images?.length) throw new Error('Only user messages can contain images.')
    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls?.length
        ? message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments ?? {})
            }
          }))
        : undefined
      if (message.content.trim() || toolCalls?.length) {
        out.push({
          role: 'assistant',
          content: message.content.trim() || null,
          tool_calls: toolCalls
        })
      }
      continue
    }
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        content: message.content
      })
    }
  }
  return out
}

function toOpenAITools(tools: ProviderToolSpec[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

export async function streamOpenAI(request: CompletionRequest): Promise<CompletionResult> {
  const client = new OpenAI({
    apiKey: request.apiKey,
    baseURL: request.baseUrl || undefined
  })
  const tools = request.structuredOutput
    ? [
        ...request.tools,
        {
          name: STRUCTURED_OUTPUT_TOOL,
          description: request.structuredOutput.description ?? 'Return the requested structured result.',
          parameters: request.structuredOutput.schema
        }
      ]
    : request.tools

  const stream = await client.chat.completions.create(
    {
      model: request.model,
      temperature: request.temperature,
      stop: request.stopSequences,
      messages: toOpenAIMessages(request.system, request.messages),
      tools: tools.length ? toOpenAITools(tools) : undefined,
      tool_choice: request.structuredOutput
        ? { type: 'function', function: { name: STRUCTURED_OUTPUT_TOOL } }
        : request.toolChoice === 'none'
          ? 'none'
          : request.toolChoice === 'required'
            ? 'required'
            : tools.length
              ? 'auto'
              : undefined,
      stream: true,
      stream_options: request.kind === 'openai' ? { include_usage: true } : undefined
    },
    { signal: request.signal }
  )

  let text = ''
  let finishReason: string | undefined
  let usage: TokenUsage | undefined
  const pending = new Map<
    number,
    { id: string; name: string; args: string }
  >()

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = {
        input: chunk.usage.prompt_tokens ?? 0,
        output: chunk.usage.completion_tokens ?? 0,
        total: chunk.usage.total_tokens ?? 0
      }
    }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta
    if (!delta) continue
    if (delta.content) {
      text += delta.content
      request.onText(delta.content)
    }
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? 0
      const item = pending.get(index) ?? { id: '', name: '', args: '' }
      if (call.id) item.id = call.id
      if (call.function?.name) item.name += call.function.name
      if (call.function?.arguments) item.args += call.function.arguments
      pending.set(index, item)
    }
  }

  const toolCalls: ProviderToolCall[] = [...pending.values()]
    .filter((item) => item.name)
    .map((item) => ({
      id: item.id || `call_${Math.random().toString(36).slice(2)}`,
      name: item.name,
      arguments: safeJsonParse<Record<string, unknown>>(item.args) ?? {}
    }))

  return { text, toolCalls, usage, finishReason }
}
