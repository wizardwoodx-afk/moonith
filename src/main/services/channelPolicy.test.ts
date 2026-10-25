import { describe, expect, it } from 'vitest'
import { protectChannelReply, telegramChatAuthorized } from './channelPolicy'

describe('Telegram channel policy', () => {
  it('denies every chat by default and permits only exact configured IDs', () => {
    expect(telegramChatAuthorized([], 42)).toBe(false)
    expect(telegramChatAuthorized(['42', '-100123'], 42)).toBe(true)
    expect(telegramChatAuthorized(['42', '-100123'], -100123)).toBe(true)
    expect(telegramChatAuthorized(['42'], 43)).toBe(false)
  })

  it('redacts or blocks outgoing secrets according to enterprise DLP', () => {
    const reply = 'Contact person@example.com'
    expect(protectChannelReply(reply, { mode: 'redact', categories: ['email'] })).toEqual({
      text: 'Contact [redacted:email]',
      blocked: false,
      findings: 1
    })
    expect(protectChannelReply(reply, { mode: 'block', categories: ['email'] })).toEqual({
      text: null,
      blocked: true,
      findings: 1
    })
    expect(protectChannelReply(reply, { mode: 'off', categories: ['email'] }).text).toBe(reply)
  })
})
