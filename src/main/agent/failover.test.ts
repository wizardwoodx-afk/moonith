import { describe, expect, it } from 'vitest'
import { isFailoverWorthy } from './failover'

describe('provider failover eligibility', () => {
  it('falls over on rate limits, quota and transient server errors', () => {
    expect(isFailoverWorthy(Object.assign(new Error('limited'), { status: 429 }), false)).toBe(true)
    expect(isFailoverWorthy(Object.assign(new Error('no credits'), { status: 402 }), false)).toBe(true)
    expect(isFailoverWorthy(Object.assign(new Error('down'), { status: 503 }), false)).toBe(true)
    expect(isFailoverWorthy(new Error('quota exceeded for this billing period'), false)).toBe(true)
    expect(isFailoverWorthy(new Error('fetch failed'), false)).toBe(true)
  })

  it('does not fall over after text has already streamed', () => {
    expect(isFailoverWorthy(Object.assign(new Error('limited'), { status: 429 }), true)).toBe(false)
  })

  it('does not fall over on bad configuration or auth', () => {
    expect(isFailoverWorthy(Object.assign(new Error('bad key'), { status: 401 }), false)).toBe(false)
    expect(isFailoverWorthy(Object.assign(new Error('missing'), { status: 404 }), false)).toBe(false)
    expect(isFailoverWorthy(new Error('Invalid model id'), false)).toBe(false)
  })

  it('aborted runs are not retried', () => {
    expect(isFailoverWorthy(Object.assign(new Error('aborted'), { name: 'AbortError' }), false)).toBe(false)
  })
})
