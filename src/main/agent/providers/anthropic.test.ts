import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STRUCTURED_OUTPUT_TOOL, type CompletionRequest } from '../types'

const mocks = vi.hoisted(() => ({ stream: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { stream: mocks.stream }
  }
}))

import { streamAnthropic } from './anthropic'

function request(patch: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    kind: 'anthropic',
    apiKey: 'test-key',
    model: 'model-1',
    system: 'Complete the browser operation.',
    messages: [{ id: 'message-1', role: 'user', content: 'Read the page', createdAt: new Date(0).toISOString() }],
    tools: [],
    signal: new AbortController().signal,
    onText: vi.fn(),
    ...patch
  }
}

beforeEach(() => {
  mocks.stream.mockReset()
})

describe('Anthropic structured browser output', () => {
  it('forces the synthetic schema tool and returns its typed input', async () => {
    const stream = Object.assign(new EventEmitter(), {
      finalMessage: vi.fn(async () => {
        stream.emit('text', 'Extracted.')
        return {
          content: [
            { type: 'text', text: 'Extracted.' },
            {
              type: 'tool_use',
              id: 'call-1',
              name: STRUCTURED_OUTPUT_TOOL,
              input: { title: 'Example', count: 2 }
            }
          ],
          usage: { input_tokens: 11, output_tokens: 5 },
          stop_reason: 'tool_use'
        }
      })
    })
    mocks.stream.mockReturnValue(stream)

    const result = await streamAnthropic(request({
      structuredOutput: {
        name: 'page_result',
        schema: { type: 'object', properties: { title: { type: 'string' }, count: { type: 'number' } } }
      }
    }))

    const payload = mocks.stream.mock.calls[0][0]
    expect(payload.tools.at(-1).name).toBe(STRUCTURED_OUTPUT_TOOL)
    expect(payload.tool_choice).toEqual({ type: 'tool', name: STRUCTURED_OUTPUT_TOOL })
    expect(result.text).toBe('Extracted.')
    expect(result.toolCalls).toEqual([{
      id: 'call-1',
      name: STRUCTURED_OUTPUT_TOOL,
      arguments: { title: 'Example', count: 2 }
    }])
    expect(result.usage).toEqual({ input: 11, output: 5, total: 16 })
  })

  it('converts browser screenshots to Anthropic image blocks', async () => {
    const stream = Object.assign(new EventEmitter(), {
      finalMessage: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Done' }],
        usage: { input_tokens: 2, output_tokens: 1 },
        stop_reason: 'end_turn'
      }))
    })
    mocks.stream.mockReturnValue(stream)
    await streamAnthropic(request({
      messages: [{
        id: 'message-image',
        role: 'user',
        content: 'Inspect the image',
        images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }],
        createdAt: new Date(0).toISOString()
      }]
    }))
    const payload = mocks.stream.mock.calls[0][0]
    expect(payload.messages[0].content).toEqual([
      { type: 'text', text: 'Inspect the image' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' }
      }
    ])
  })
})
