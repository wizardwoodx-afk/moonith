import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STRUCTURED_OUTPUT_TOOL, type CompletionRequest } from '../types'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: mocks.create } }
  }
}))

import { streamOpenAI } from './openai'

function request(patch: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    kind: 'openai',
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
  mocks.create.mockReset()
})

describe('OpenAI structured browser output', () => {
  it('forces the synthetic schema tool and preserves streamed arguments and usage', async () => {
    mocks.create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-1',
                function: { name: 'selfimpulse_', arguments: '{"title":' }
              }]
            }
          }]
        }
        yield {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, function: { name: 'structured_output', arguments: '"Example"}' } }]
            },
            finish_reason: 'tool_calls'
          }]
        }
        yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }
      }
    })

    const result = await streamOpenAI(request({
      structuredOutput: {
        name: 'page_result',
        schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
      }
    }))

    const payload = mocks.create.mock.calls[0][0]
    expect(payload.tools.at(-1).function.name).toBe(STRUCTURED_OUTPUT_TOOL)
    expect(payload.tool_choice).toEqual({ type: 'function', function: { name: STRUCTURED_OUTPUT_TOOL } })
    expect(result.toolCalls).toEqual([{
      id: 'call-1',
      name: STRUCTURED_OUTPUT_TOOL,
      arguments: { title: 'Example' }
    }])
    expect(result.usage).toEqual({ input: 10, output: 4, total: 14 })
  })

  it('converts browser screenshots to multimodal user content', async () => {
    mocks.create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }
      }
    })
    await streamOpenAI(request({
      messages: [{
        id: 'message-image',
        role: 'user',
        content: 'Inspect the image',
        images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }],
        createdAt: new Date(0).toISOString()
      }]
    }))
    const payload = mocks.create.mock.calls[0][0]
    expect(payload.messages[1].content).toEqual([
      { type: 'text', text: 'Inspect the image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }
    ])
  })
})
