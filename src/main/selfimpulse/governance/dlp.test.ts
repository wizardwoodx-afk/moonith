import { describe, expect, it } from 'vitest'
import { ALL_SENSITIVE_DATA_CATEGORIES } from '@shared/governance'
import {
  detectSensitiveData,
  inspectSensitiveText,
  protectData,
  redactSensitiveText,
  scrubAuditValue
} from './dlp'

describe('sensitive-data detection', () => {
  it('detects common credential formats without returning the secret', () => {
    const text = [
      'OpenAI sk-test_1234567890abcdef',
      'GitHub ghp_12345678901234567890',
      'AWS AKIA1234567890ABCDEF',
      'Bearer abcdefghijklmnopqrstuvwxyz123456'
    ].join('\n')
    const matches = detectSensitiveData(text, ['api-key'])
    expect(matches).toHaveLength(4)
    expect(matches.every((match) => match.category === 'api-key')).toBe(true)
    expect(JSON.stringify(matches)).not.toContain('1234567890abcdef')
    expect(redactSensitiveText(text, ['api-key']).text).not.toContain('ghp_')
  })

  it('detects emails, JWTs, PEM keys, and nested secret assignments', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'
    const pem = '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----'
    const text = `person@example.com\n${jwt}\n${pem}\npassword = "correct horse"`
    const categories = detectSensitiveData(text).map((match) => match.category)
    expect(categories).toContain('email')
    expect(categories).toContain('jwt')
    expect(categories).toContain('private-key')
    expect(categories).toContain('secret')
  })

  it('uses Luhn validation to avoid treating every long number as a card', () => {
    expect(detectSensitiveData('Card 4111 1111 1111 1111', ['credit-card'])).toHaveLength(1)
    expect(detectSensitiveData('Order 4111 1111 1111 1112', ['credit-card'])).toHaveLength(0)
    expect(detectSensitiveData('0000 0000 0000 0000', ['credit-card'])).toHaveLength(0)
  })

  it('keeps optional phone detection out of the default category set', () => {
    expect(ALL_SENSITIVE_DATA_CATEGORIES).toContain('phone')
    expect(detectSensitiveData('Call +91 98765 43210', ['email'])).toHaveLength(0)
    expect(detectSensitiveData('Call +91 98765 43210', ['phone'])).toHaveLength(1)
  })
})

describe('recursive DLP protection', () => {
  it('redacts nested messages and tool arguments without mutating the input', () => {
    const input = {
      content: 'Email person@example.com',
      args: {
        headers: { authorization: 'short-but-sensitive' },
        values: ['sk-test_1234567890abcdef', 42, true]
      }
    }
    const result = protectData(input, {
      mode: 'redact',
      categories: ['email', 'secret', 'api-key']
    })
    expect(result.total).toBe(3)
    expect(result.value).toEqual({
      content: 'Email [redacted:email]',
      args: {
        headers: { authorization: '[redacted:secret]' },
        values: ['[redacted:api-key]', 42, true]
      }
    })
    expect(input.args.headers.authorization).toBe('short-but-sensitive')
    expect(input.args.values[0]).toContain('sk-test_')
  })

  it('protects sensitive fields even when their values are not strings', () => {
    const result = protectData(
      { password: 1234, access_token: { value: 'x' } },
      { mode: 'redact', categories: ['secret'] }
    )
    expect(result.total).toBe(2)
    expect(result.value).toEqual({
      password: '[redacted:secret]',
      access_token: '[redacted:secret]'
    })
  })

  it('leaves data unchanged in block mode so the caller can fail before egress', () => {
    const input = { prompt: 'person@example.com' }
    const result = protectData(input, { mode: 'block', categories: ['email'] })
    expect(result.value).toEqual(input)
    expect(result.total).toBe(1)
  })

  it('provides a local inspection preview with category counts only', () => {
    const result = inspectSensitiveText('a@example.com and b@example.com', ['email'])
    expect(result).toEqual({
      total: 2,
      findings: [{ category: 'email', count: 2 }],
      redacted: '[redacted:email] and [redacted:email]'
    })
  })

  it('always scrubs audit metadata even when task DLP is off', () => {
    expect(scrubAuditValue({ detail: 'token sk-test_1234567890abcdef' })).toEqual({
      detail: 'token [redacted:api-key]'
    })
  })

  it('fails closed instead of skipping content beyond the nesting limit', () => {
    let input: unknown = { content: 'person@example.com' }
    for (let depth = 0; depth < 40; depth++) input = { nested: input }
    const redacted = protectData(input, { mode: 'redact', categories: ['email'] })
    expect(redacted.total).toBeGreaterThan(0)
    expect(JSON.stringify(redacted.value)).not.toContain('person@example.com')
    expect(JSON.stringify(redacted.value)).toContain('[redacted:deep-nesting]')
    expect(protectData(input, { mode: 'block', categories: ['email'] }).total).toBeGreaterThan(0)
  })
})
