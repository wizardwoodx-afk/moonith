import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { STRUCTURED_OUTPUT_TOOL, type CompletionRequest, type CompletionResult } from '../agent/types'
import { createBrowserModel, parseStructuredText, toCompletionMessages } from './model'
import { BrowserError } from './errors'

const config = {
  kind: 'openai' as const,
  providerId: 'provider-1',
  apiKey: 'provider-secret',
  model: 'model-1'
}

async function generate(model: ReturnType<typeof createBrowserModel>, params: Record<string, unknown>): Promise<any> {
  return (model.generate as (input: Record<string, unknown>) => Promise<any>)(params)
}

describe('Stagehand provider adapter', () => {
  it('preserves visual input when converting a browser page for the task provider', () => {
    const [message] = toCompletionMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this screenshot' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
        ]
      }
    ] as never)
    expect(message.content).toBe('Inspect this screenshot')
    expect(message.images).toEqual([{ data: 'aGVsbG8=', mimeType: 'image/png' }])
  })

  it('uses synthetic structured output and applies DLP before provider egress', async () => {
    const complete = vi.fn(async (_request: CompletionRequest): Promise<CompletionResult> => ({
      text: '',
      toolCalls: [{
        id: 'call-1',
        name: STRUCTURED_OUTPUT_TOOL,
        arguments: { title: 'Example', count: 2 }
      }],
      usage: { input: 12, output: 3, total: 15 }
    }))
    const protectMessages = vi.fn((messages: ChatMessage[]) => messages.map((message) => ({
      ...message,
      content: message.content.replace('person@example.com', '[redacted:email]')
    })))
    const recordUsage = vi.fn()
    const model = createBrowserModel(() => config, { complete, protectMessages, recordUsage })

    const result = await generate(model, {
      systemPrompt: 'Extract the requested fields.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Owner: person@example.com' }] }],
      tools: [],
      responseFormat: {
        type: 'json_schema',
        name: 'page_result',
        schema: {
          type: 'object',
          properties: { title: { type: 'string' }, count: { type: 'number' } },
          required: ['title', 'count']
        }
      }
    })

    expect(result.structuredContent).toEqual({ title: 'Example', count: 2 })
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3, totalTokens: 15 })
    const request = complete.mock.calls[0][0]
    expect(request.structuredOutput?.name).toBe('page_result')
    expect(request.messages[0].content).toBe('Owner: [redacted:email]')
    expect(JSON.stringify(request)).not.toContain('person@example.com')
    expect(recordUsage).toHaveBeenCalledWith(config, { input: 12, output: 3, total: 15 })
  })

  it('maps ordinary Stagehand tool calls without losing provider arguments', async () => {
    const complete = vi.fn(async (_request: CompletionRequest): Promise<CompletionResult> => ({
      text: 'I found the control.',
      toolCalls: [{ id: 'call-2', name: 'click', arguments: { selector: '#save' } }]
    }))
    const model = createBrowserModel(() => config, { complete })
    const result = await generate(model, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Find the save button' }] }],
      tools: [{
        name: 'click',
        description: 'Click an element',
        inputSchema: { type: 'object', properties: { selector: { type: 'string' } } }
      }],
      toolChoice: { mode: 'auto' }
    })
    expect(complete.mock.calls[0][0].tools[0].name).toBe('click')
    expect(complete.mock.calls[0][0].toolChoice).toBe('auto')
    expect(result.content).toEqual([
      { type: 'text', text: 'I found the control.' },
      { type: 'tool_use', id: 'call-2', name: 'click', input: { selector: '#save' } }
    ])
  })

  it('redacts provider credentials from operational errors', async () => {
    const secret = 'sk-test_1234567890abcdef'
    const complete = vi.fn(async (_request: CompletionRequest): Promise<CompletionResult> => {
      throw new Error(`Provider rejected ${secret}`)
    })
    const model = createBrowserModel(() => config, { complete })
    const error = await generate(model, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the page' }] }]
    }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(BrowserError)
    expect((error as Error).message).not.toContain(secret)
    expect((error as Error).message).toContain('[redacted:api-key]')
  })
})

describe('structured browser text', () => {
  it('accepts a fenced JSON object from a compatible provider', () => {
    expect(parseStructuredText('```json\n{"title":"Example"}\n```')).toEqual({ title: 'Example' })
  })

  it('rejects an empty or non-JSON response with an actionable error', () => {
    expect(() => parseStructuredText('')).toThrow('empty structured browser result')
    expect(() => parseStructuredText('not json')).toThrow('valid structured JSON')
  })
})
