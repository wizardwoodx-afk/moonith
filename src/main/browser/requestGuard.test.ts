import { describe, expect, it, vi } from 'vitest'
import { BrowserRequestGuard, loopbackControlUrl, type CdpTransport } from './requestGuard'

interface GuardInternals {
  handleRequest(params: Record<string, unknown>, sessionId?: string): Promise<void>
  setupSession(sessionId: string): Promise<void>
}

function fakeTransport() {
  const send = vi.fn(async (method: string) => method === 'Target.getTargets' ? { targetInfos: [] } : {})
  const transport: CdpTransport = {
    send,
    close: vi.fn()
  }
  return { transport, send }
}

describe('private Chrome control channel', () => {
  it('accepts only loopback WebSocket endpoints', () => {
    expect(loopbackControlUrl('ws://127.0.0.1:9222/devtools/browser/abc').hostname).toBe('127.0.0.1')
    expect(loopbackControlUrl('ws://[::1]:9222/devtools/browser/abc').hostname).toBe('[::1]')
    expect(() => loopbackControlUrl('ws://example.com/devtools/browser/abc')).toThrow('loopback')
    expect(() => loopbackControlUrl('https://127.0.0.1:9222/devtools/browser/abc')).toThrow('loopback')
    expect(() => loopbackControlUrl('ws://user:pass@127.0.0.1/devtools/browser/abc')).toThrow('loopback')
    expect(() => loopbackControlUrl('not a URL')).toThrow('invalid private control channel')
  })
})

describe('BrowserRequestGuard', () => {
  it('continues a request only after the navigation verifier accepts it', async () => {
    const { transport, send } = fakeTransport()
    const verify = vi.fn(async () => new URL('https://example.com'))
    const guard = new BrowserRequestGuard(transport, { verify })
    await (guard as unknown as GuardInternals).handleRequest({
      requestId: 'request-1',
      request: { url: 'https://example.com' }
    }, 'session-1')
    expect(verify).toHaveBeenCalledWith('https://example.com')
    expect(send).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'request-1' }, 'session-1')
    expect(guard.stats().blockedRequests).toBe(0)
  })

  it('fails closed and records a blocked request when verification rejects', async () => {
    const { transport, send } = fakeTransport()
    const onBlocked = vi.fn()
    const guard = new BrowserRequestGuard(transport, {
      verify: vi.fn(async () => { throw new Error('private address') }),
      onBlocked
    })
    await (guard as unknown as GuardInternals).handleRequest({
      requestId: 'request-2',
      request: { url: 'http://169.254.169.254/latest/meta-data' }
    }, 'session-1')
    expect(send).toHaveBeenCalledWith('Fetch.failRequest', {
      requestId: 'request-2',
      errorReason: 'BlockedByClient'
    }, 'session-1')
    expect(send).not.toHaveBeenCalledWith('Fetch.continueRequest', expect.anything(), expect.anything())
    expect(onBlocked).toHaveBeenCalledOnce()
    expect(guard.stats().blockedRequests).toBe(1)
  })

  it('fails malformed paused requests instead of allowing them by default', async () => {
    const { transport, send } = fakeTransport()
    const guard = new BrowserRequestGuard(transport)
    await (guard as unknown as GuardInternals).handleRequest({ requestId: 'request-3' }, 'session-1')
    expect(send).toHaveBeenCalledWith('Fetch.failRequest', {
      requestId: 'request-3',
      errorReason: 'BlockedByClient'
    }, 'session-1')
  })

  it('intercepts every URL scheme before resuming a target', async () => {
    const { transport, send } = fakeTransport()
    const guard = new BrowserRequestGuard(transport)
    await (guard as unknown as GuardInternals).setupSession('session-1')
    expect(send).toHaveBeenCalledWith('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }]
    }, 'session-1')
    expect(send).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger', {}, 'session-1')
    expect(guard.stats().guardedSessions).toBe(1)
  })

  it('treats a lost control channel as fatal, but not an intentional close', async () => {
    const { transport } = fakeTransport()
    const onFatal = vi.fn()
    const guard = new BrowserRequestGuard(transport, { onFatal })
    await guard.start()
    transport.onClose?.()
    expect(onFatal).toHaveBeenCalledOnce()

    const second = fakeTransport()
    const secondFatal = vi.fn()
    const secondGuard = new BrowserRequestGuard(second.transport, { onFatal: secondFatal })
    await secondGuard.start()
    secondGuard.close()
    second.transport.onClose?.()
    expect(secondFatal).not.toHaveBeenCalled()
  })
})
