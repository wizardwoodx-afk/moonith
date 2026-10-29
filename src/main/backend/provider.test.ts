import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Provider,
  dropUnsignedToolTurns,
  sameProviderEndpoint,
  type WireMessage
} from './provider'

type Call = NonNullable<WireMessage['tool_calls']>[number]

function signedCall(id: string, signature = `sig-${id}`): Call {
  return {
    id,
    type: 'function',
    function: { name: 'search', arguments: JSON.stringify({ q: id }) },
    extra_content: { google: { thought_signature: signature } }
  }
}

function unsignedCall(id: string): Call {
  return { id, type: 'function', function: { name: 'search', arguments: JSON.stringify({ q: id }) } }
}

function toolResult(callId: string): WireMessage {
  return { role: 'tool', content: `result of ${callId}`, tool_call_id: callId }
}

describe('sameProviderEndpoint', () => {
  it('is true for identical URLs so an unchanged endpoint keeps its stored key', () => {
    expect(sameProviderEndpoint('https://api.mistral.ai/v1', 'https://api.mistral.ai/v1')).toBe(true)
  })

  it('is true across trailing-slash differences because that is a cosmetic edit', () => {
    expect(sameProviderEndpoint('https://api.mistral.ai/v1', 'https://api.mistral.ai/v1/')).toBe(true)
    expect(sameProviderEndpoint('https://api.mistral.ai', 'https://api.mistral.ai/')).toBe(true)
    expect(sameProviderEndpoint(' https://api.mistral.ai/v1 ', 'https://api.mistral.ai/v1')).toBe(
      true
    )
  })

  it('is true across host case differences because hosts are case-insensitive server identity', () => {
    expect(sameProviderEndpoint('https://API.MISTRAL.AI/v1', 'https://api.mistral.ai/v1')).toBe(true)
  })

  it('is false for a query change and true for a fragment-only change', () => {
    expect(sameProviderEndpoint('https://a.example/v1?api-key=old', 'https://a.example/v1')).toBe(false)
    expect(sameProviderEndpoint('https://a.example/v1?a=1', 'https://a.example/v1?b=2')).toBe(false)
    expect(sameProviderEndpoint('https://a.example/v1?api-version=2', 'https://a.example/v1?api-version=1')).toBe(false)
    expect(sameProviderEndpoint('https://a.example/v1#frag', 'https://a.example/v1')).toBe(true)
  })

  it('is false for a path change so an edited route never receives the old key', () => {
    expect(sameProviderEndpoint('https://a.example/v1', 'https://a.example/v2')).toBe(false)
    expect(sameProviderEndpoint('https://a.example', 'https://a.example/v1')).toBe(false)
  })

  it('is false for a path case change because the parsed-URL branch keeps pathname case', () => {
    expect(sameProviderEndpoint('https://a.example/V1', 'https://a.example/v1')).toBe(false)
  })

  it('is false for a different origin so a key can never follow the URL to another host', () => {
    expect(sameProviderEndpoint('https://a.example/v1', 'https://b.example/v1')).toBe(false)
  })

  it('is false for a scheme downgrade and a non-default port change, true for a redundant default port', () => {
    expect(sameProviderEndpoint('https://a.example/v1', 'http://a.example/v1')).toBe(false)
    expect(sameProviderEndpoint('https://a.example/v1', 'https://a.example:8443/v1')).toBe(false)
    expect(sameProviderEndpoint('https://a.example:443/v1', 'https://a.example/v1')).toBe(true)
  })

  it('is true only when both sides are missing, and false when one side has an endpoint', () => {
    expect(sameProviderEndpoint(undefined, undefined)).toBe(true)
    expect(sameProviderEndpoint('', '   ')).toBe(true)
    expect(sameProviderEndpoint('https://a.example/v1', undefined)).toBe(false)
    expect(sameProviderEndpoint('https://a.example/v1', '')).toBe(false)
  })

  it('falls back to a trimmed, case-sensitive text match for non-URL strings', () => {
    expect(sameProviderEndpoint('LocalProxy', 'localproxy')).toBe(false)
    expect(sameProviderEndpoint('localproxy', 'localproxy/')).toBe(true)
    expect(sameProviderEndpoint('localproxy', 'otherproxy')).toBe(false)
  })

  it('is false for a hostname-only string compared against the full URL (mixed branches)', () => {
    expect(sameProviderEndpoint('a.example/v1', 'https://a.example/v1')).toBe(false)
  })
})

describe('dropUnsignedToolTurns', () => {
  it('passes an all-signed transcript through with the original message objects untouched', () => {
    const assistant: WireMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [signedCall('call_a'), signedCall('call_b')]
    }
    const messages: WireMessage[] = [
      { role: 'system', content: 'rules' },
      assistant,
      toolResult('call_a'),
      toolResult('call_b')
    ]
    const out = dropUnsignedToolTurns(messages)
    expect(out).toHaveLength(4)
    expect(out[1]).toBe(assistant)
    expect(out[1].tool_calls).toBe(assistant.tool_calls)
  })

  it('keeps the signed call in a mixed assistant turn and drops only the unsigned call', () => {
    const assistant: WireMessage = {
      role: 'assistant',
      content: 'thinking',
      tool_calls: [signedCall('call_a'), unsignedCall('call_b')],
      latency_ms: 42
    }
    const out = dropUnsignedToolTurns([
      assistant,
      toolResult('call_a'),
      toolResult('call_b')
    ])
    expect(out).toHaveLength(2)
    expect(out[0].tool_calls).toEqual([signedCall('call_a')])
    expect(out[0].content).toBe('thinking')
    expect(out[0].latency_ms).toBe(42)
    expect(out[1].tool_call_id).toBe('call_a')
  })

  it('removes an assistant message whose calls are all unsigned instead of emitting an empty tool_calls array', () => {
    const out = dropUnsignedToolTurns([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [unsignedCall('call_a')] },
      toolResult('call_a'),
      { role: 'user', content: 'and now?' }
    ])
    expect(out).toHaveLength(2)
    expect(out.some((m) => m.role === 'assistant')).toBe(false)
    expect(out.some((m) => m.tool_calls && m.tool_calls.length === 0)).toBe(false)
    expect(out[1].content).toBe('and now?')
  })

  it('treats an empty-string signature as unsigned so a blank field cannot smuggle a rejection', () => {
    const out = dropUnsignedToolTurns([
      { role: 'assistant', content: null, tool_calls: [signedCall('call_a', '')] },
      toolResult('call_a')
    ])
    expect(out).toHaveLength(0)
  })

  it('keeps tool messages that have no tool_call_id or reference an unknown call', () => {
    const noId: WireMessage = { role: 'tool', content: 'loose' }
    const unknownId = toolResult('call_ghost')
    const out = dropUnsignedToolTurns([noId, unknownId])
    expect(out).toEqual([noId, unknownId])
  })

  it('preserves ordering and unrelated turns across a multi-turn mixed transcript', () => {
    const messages: WireMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'hello', tool_calls: undefined },
      { role: 'assistant', content: null, tool_calls: [signedCall('keep_1'), unsignedCall('drop_1')] },
      toolResult('keep_1'),
      toolResult('drop_1'),
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: null, tool_calls: [unsignedCall('drop_2')] },
      toolResult('drop_2'),
      { role: 'assistant', content: null, tool_calls: [signedCall('keep_2')] },
      toolResult('keep_2'),
      { role: 'assistant', content: 'final answer' }
    ]
    const out = dropUnsignedToolTurns(messages)
    expect(out.map((m) => `${m.role}:${m.role === 'tool' ? m.tool_call_id : (m.content ?? 'calls')}`)).toEqual([
      'system:rules',
      'user:u1',
      'assistant:hello',
      'assistant:calls',
      'tool:keep_1',
      'user:u2',
      'assistant:calls',
      'tool:keep_2',
      'assistant:final answer'
    ])
    expect(out[3].tool_calls).toEqual([signedCall('keep_1')])
    expect(out[6].tool_calls).toEqual([signedCall('keep_2')])
  })

  it('leaves an assistant message with an empty tool_calls array in place, filtering only non-empty ones', () => {
    const empty: WireMessage = { role: 'assistant', content: 'x', tool_calls: [] }
    const out = dropUnsignedToolTurns([empty])
    expect(out).toEqual([empty])
  })
})

describe('stream call site gates dropUnsignedToolTurns on Google endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function capturedBody(baseUrl: string, messages: WireMessage[]): Promise<{
    messages: WireMessage[]
  }> {
    const fetchMock = vi.fn(async (_input: unknown, init?: unknown) => {
      calls.push((init as { body: string }).body)
      return {
        ok: true,
        body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) }
      }
    })
    const calls: string[] = []
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const provider = new Provider({ baseUrl, apiKey: 'test-key', model: 'test-model' })
    for await (const event of provider.stream(messages)) void event
    expect(calls).toHaveLength(1)
    return JSON.parse(calls[0])
  }

  it('drops the unsigned call before sending when the base URL is a Google endpoint', async () => {
    const body = await capturedBody('https://generativelanguage.googleapis.com/v1beta/openai', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [unsignedCall('call_a')] },
      toolResult('call_a')
    ])
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('sends the unsigned call untouched for a non-Google provider, which tolerates replay', async () => {
    const messages: WireMessage[] = [
      { role: 'assistant', content: null, tool_calls: [unsignedCall('call_a')] },
      toolResult('call_a')
    ]
    const body = await capturedBody('https://api.openai.com/v1', messages)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].tool_calls).toHaveLength(1)
  })
})
