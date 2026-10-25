import type { ChatMessage, ProviderKind, TokenUsage } from '@shared/types'

export interface ProviderToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ProviderToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export const STRUCTURED_OUTPUT_TOOL = 'selfimpulse_structured_output'

export interface StructuredOutputRequest {
  name: string
  description?: string
  schema: Record<string, unknown>
}

export interface CompletionRequest {
  kind: ProviderKind
  apiKey: string
  baseUrl?: string
  model: string
  system: string
  messages: ChatMessage[]
  tools: ProviderToolSpec[]
  /** Request one schema-bound tool call through the existing provider transport. */
  structuredOutput?: StructuredOutputRequest
  temperature?: number
  stopSequences?: string[]
  toolChoice?: 'auto' | 'required' | 'none'
  signal: AbortSignal
  onText: (delta: string) => void
}

export interface CompletionResult {
  text: string
  toolCalls: ProviderToolCall[]
  usage?: TokenUsage
  finishReason?: string
}

export function addUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    total: a.total + b.total
  }
}
