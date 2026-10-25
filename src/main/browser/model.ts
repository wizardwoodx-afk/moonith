import type { ClientLLM } from '@browserbasehq/stagehand'
import type { ChatMessage, MessageImage, ProviderKind, TokenUsage } from '@shared/types'
import {
  STRUCTURED_OUTPUT_TOOL,
  type CompletionRequest,
  type CompletionResult
} from '../agent/types'
import { BrowserError } from './errors'

export interface BrowserModelConfig {
  kind: ProviderKind
  providerId: string
  apiKey: string
  baseUrl?: string
  model: string
}

export interface BrowserModelHooks {
  complete?: (request: CompletionRequest) => Promise<CompletionResult>
  protectMessages?: (messages: ChatMessage[]) => ChatMessage[] | Promise<ChatMessage[]>
  recordUsage?: (config: BrowserModelConfig, usage?: TokenUsage) => void | Promise<void>
  timeoutMs?: number
}

type GenerateParams = Parameters<ClientLLM['generate']>[0]
type GenerateResult = Awaited<ReturnType<ClientLLM['generate']>>
type StagehandMessage = GenerateParams['messages'][number]
type ContentBlock = StagehandMessage['content'] extends infer T
  ? T extends Array<infer U>
    ? U
    : T
  : never

const MAX_TOTAL_TEXT = 2_000_000
const MAX_IMAGES = 6
const MAX_IMAGE_BASE64 = 14_000_000
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function boundedText(value: string, total: { length: number }): string {
  total.length += value.length
  if (total.length > MAX_TOTAL_TEXT) {
    throw new BrowserError(
      'BROWSER_MODEL_UNAVAILABLE',
      'This browser page is too large for one model request. Narrow the instruction or extract a specific element instead.'
    )
  }
  return value
}

function appendBlock(
  block: ContentBlock,
  text: string[],
  images: MessageImage[],
  total: { length: number }
): void {
  if (block.type === 'text') {
    text.push(boundedText(block.text, total))
    return
  }
  if (block.type === 'image') {
    if (!IMAGE_TYPES.has(block.mimeType)) {
      throw new BrowserError('BROWSER_MODEL_UNAVAILABLE', `Unsupported browser image type: ${block.mimeType}.`)
    }
    if (block.data.length > MAX_IMAGE_BASE64 || images.length >= MAX_IMAGES) {
      throw new BrowserError(
        'BROWSER_MODEL_UNAVAILABLE',
        'The browser captured too many or too large images for one model request.'
      )
    }
    images.push({ data: block.data, mimeType: block.mimeType as MessageImage['mimeType'] })
    return
  }
  if (block.type === 'tool_use') {
    text.push(boundedText(`Tool ${block.name} input:\n${JSON.stringify(block.input)}`, total))
    return
  }
  if (block.type === 'tool_result') {
    for (const child of block.content) appendBlock(child, text, images, total)
    if (block.structuredContent) {
      text.push(boundedText(`Structured tool result:\n${JSON.stringify(block.structuredContent)}`, total))
    }
  }
}

/** Convert Stagehand's text/image/tool blocks without discarding visual input. */
export function toCompletionMessages(input: StagehandMessage[]): ChatMessage[] {
  const total = { length: 0 }
  return input.map((message, index) => {
    const text: string[] = []
    const images: MessageImage[] = []
    const blocks = Array.isArray(message.content) ? message.content : [message.content]
    for (const block of blocks) appendBlock(block, text, images, total)
    return {
      id: `browser-model-${index}`,
      role: message.role,
      content: text.join('\n'),
      ...(images.length ? { images } : {}),
      createdAt: new Date(0).toISOString()
    }
  })
}

export function parseStructuredText(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  if (!candidate) {
    throw new BrowserError('BROWSER_MODEL_INVALID', 'The model returned an empty structured browser result.')
  }
  try {
    return JSON.parse(candidate) as unknown
  } catch (error) {
    throw new BrowserError(
      'BROWSER_MODEL_INVALID',
      'The model did not return valid structured JSON for the browser operation. Retry with a narrower extraction request.',
      { cause: error }
    )
  }
}

function usageResult(usage?: TokenUsage): TokenUsage | undefined {
  if (!usage) return undefined
  return {
    input: Math.max(0, usage.input),
    output: Math.max(0, usage.output),
    total: Math.max(usage.total, usage.input + usage.output)
  }
}

/**
 * Stagehand's local ClientLLM callback over SelfImpulse's existing provider
 * transport. API keys stay in this main-process closure and never enter tool
 * arguments, Stagehand's browser runtime, or renderer state.
 */
export function createBrowserModel(
  resolveConfig: () => BrowserModelConfig | Promise<BrowserModelConfig>,
  hooks: BrowserModelHooks = {}
): ClientLLM {
  return {
    async generate(params: GenerateParams): Promise<GenerateResult> {
      const config = await resolveConfig()
      if (!config.apiKey || !config.model) {
        throw new BrowserError(
          'BROWSER_MODEL_UNAVAILABLE',
          'Connect and select a model for this task before using AI browser actions.'
        )
      }
      const complete = hooks.complete ?? (await import('../agent/providers')).streamCompletion
      const converted = toCompletionMessages(params.messages)
      const messages = hooks.protectMessages
        ? await hooks.protectMessages(converted)
        : converted
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), hooks.timeoutMs ?? 60_000)
      timer.unref?.()
      let result: CompletionResult
      try {
        const responseFormat = params.responseFormat
        const schema = responseFormat?.type === 'json_schema' ? responseFormat.schema : undefined
        if (schema !== undefined && (!schema || typeof schema !== 'object' || Array.isArray(schema))) {
          throw new BrowserError('BROWSER_MODEL_INVALID', 'Stagehand requested an invalid structured-output schema.')
        }
        result = await complete({
          kind: config.kind,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          system: params.systemPrompt ?? 'Complete the browser operation precisely.',
          messages,
          tools: (('tools' in params ? params.tools : undefined) ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description ?? tool.title ?? tool.name,
            parameters: tool.inputSchema as Record<string, unknown>
          })),
          structuredOutput: responseFormat?.type === 'json_schema'
            ? {
                name: responseFormat.name,
                description: responseFormat.description,
                schema: schema as Record<string, unknown>
              }
            : undefined,
          temperature: params.temperature,
          stopSequences: params.stopSequences,
          toolChoice: 'toolChoice' in params ? params.toolChoice?.mode : undefined,
          signal: controller.signal,
          onText: () => undefined
        })
      } catch (error) {
        if (error instanceof BrowserError) throw error
        if (controller.signal.aborted) {
          throw new BrowserError(
            'BROWSER_TIMEOUT',
            'The model did not finish the browser operation in time. Retry once or narrow the instruction.',
            { cause: error }
          )
        }
        throw new BrowserError(
          'BROWSER_MODEL_UNAVAILABLE',
          error instanceof Error ? error.message : String(error),
          { cause: error }
        )
      } finally {
        clearTimeout(timer)
      }

      const usage = usageResult(result.usage)
      await hooks.recordUsage?.(config, usage)
      const responseFormat = params.responseFormat
      if (responseFormat?.type === 'json_schema') {
        const call = result.toolCalls.find((item) => item.name === STRUCTURED_OUTPUT_TOOL)
        const structuredContent = call?.arguments ?? parseStructuredText(result.text)
        return {
          role: 'assistant',
          content: { type: 'text', text: JSON.stringify(structuredContent) },
          outputFormat: 'json_schema',
          structuredContent,
          ...(usage
            ? {
                usage: {
                  inputTokens: usage.input,
                  outputTokens: usage.output,
                  totalTokens: usage.total
                }
              }
            : {})
        } as GenerateResult
      }

      const toolBlocks = result.toolCalls.map((call) => ({
        type: 'tool_use' as const,
        id: call.id,
        name: call.name,
        input: call.arguments
      }))
      const content = [
        ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
        ...toolBlocks
      ]
      return {
        role: 'assistant',
        content: content.length === 1 && content[0]?.type === 'text' ? content[0] : content,
        ...(result.finishReason ? { stopReason: result.finishReason } : {}),
        ...(usage
          ? {
              usage: {
                inputTokens: usage.input,
                outputTokens: usage.output,
                totalTokens: usage.total
              }
            }
          : {})
      } as GenerateResult
    }
  }
}
