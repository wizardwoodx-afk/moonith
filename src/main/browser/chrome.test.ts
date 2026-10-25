import { afterEach, describe, expect, it, vi } from 'vitest'
import { chromeCandidates, findChromeExecutable, parseDevToolsActivePort } from './chrome'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local Chrome discovery', () => {
  it('uses executable names on the existing PATH without downloading a browser', () => {
    expect(chromeCandidates('linux', { PATH: '/opt/bin:/usr/bin' })).toEqual([
      '/opt/bin/google-chrome-stable',
      '/usr/bin/google-chrome-stable',
      '/opt/bin/google-chrome',
      '/usr/bin/google-chrome',
      '/opt/bin/chromium-browser',
      '/usr/bin/chromium-browser',
      '/opt/bin/chromium',
      '/usr/bin/chromium'
    ])
  })

  it('rejects an invalid explicit CHROME_PATH with a useful recovery message', async () => {
    vi.stubEnv('CHROME_PATH', '/definitely/missing/selfimpulse-chrome')
    await expect(findChromeExecutable()).rejects.toThrow('CHROME_PATH does not point')
  })
})

describe('Chrome DevTools endpoint parsing', () => {
  it('constructs a loopback-only browser endpoint', () => {
    expect(parseDevToolsActivePort('9222\n/devtools/browser/session-id\n')).toEqual({
      httpUrl: 'http://127.0.0.1:9222',
      webSocketUrl: 'ws://127.0.0.1:9222/devtools/browser/session-id'
    })
  })

  it('rejects invalid ports and non-browser targets', () => {
    expect(() => parseDevToolsActivePort('0\n/devtools/browser/session-id')).toThrow('invalid private debugging endpoint')
    expect(() => parseDevToolsActivePort('9222\nhttps://example.com')).toThrow('invalid private debugging target')
  })
})
