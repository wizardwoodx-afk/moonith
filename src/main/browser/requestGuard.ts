import { assertSafeNavigation } from '../selfimpulse/coworker/navigation'
import { BrowserError } from './errors'

export interface CdpTransport {
  onEvent?: (method: string, params: Record<string, unknown>, sessionId?: string) => void
  onClose?: () => void
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>
  close(): void
}

interface PendingCommand {
  method: string
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export function loopbackControlUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BrowserError('BROWSER_SECURITY', 'Chrome reported an invalid private control channel.')
  }
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new BrowserError('BROWSER_SECURITY', 'The browser control channel must remain on loopback.')
  }
  return url
}

/** Minimal private CDP transport. It connects only to Chrome's per-session loopback endpoint. */
export class WebSocketCdpTransport implements CdpTransport {
  onEvent?: CdpTransport['onEvent']
  onClose?: CdpTransport['onClose']
  private readonly pending = new Map<number, PendingCommand>()
  private nextId = 1
  private closed = false

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => void this.receive(event.data)
    socket.onerror = () => this.drop(new BrowserError('BROWSER_CLOSED', 'The private browser control channel failed.'))
    socket.onclose = () => this.drop(new BrowserError('BROWSER_CLOSED', 'The private browser control channel closed.'))
  }

  static async connect(webSocketUrl: string, timeoutMs = 8_000): Promise<WebSocketCdpTransport> {
    const url = loopbackControlUrl(webSocketUrl)
    const socket = new WebSocket(url)
    const transport = new WebSocketCdpTransport(socket)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new BrowserError('BROWSER_TIMEOUT', 'Chrome did not open its private control channel in time.'))
      }, timeoutMs)
      timer.unref?.()
      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new BrowserError('BROWSER_UNAVAILABLE', 'Could not connect to Chrome’s private control channel.'))
      }
    })
    socket.onerror = () => transport.drop(new BrowserError('BROWSER_CLOSED', 'The private browser control channel failed.'))
    return transport
  }

  private async receive(data: unknown): Promise<void> {
    try {
      const text = typeof data === 'string' ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data)
      const message = JSON.parse(text) as {
        id?: number
        method?: string
        params?: Record<string, unknown>
        sessionId?: string
        result?: unknown
        error?: { message?: string }
      }
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) {
          pending.reject(new Error(`${pending.method}: ${message.error.message ?? 'CDP command failed'}`))
        } else {
          pending.resolve(message.result)
        }
        return
      }
      if (message.method) this.onEvent?.(message.method, message.params ?? {}, message.sessionId)
    } catch {
      // Malformed diagnostic frames are ignored; commands still fail by timeout.
    }
  }

  private drop(error: Error): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.onClose?.()
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BrowserError('BROWSER_CLOSED', 'The private browser control channel is closed.'))
    }
    if (this.pending.size >= 512) {
      return Promise.reject(new BrowserError('BROWSER_ACTION_FAILED', 'Too many browser control commands are pending.'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BrowserError('BROWSER_TIMEOUT', `${method} did not respond in time.`))
      }, 10_000)
      timer.unref?.()
      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new BrowserError('BROWSER_CLOSED', 'The browser control channel was closed.'))
    }
    this.pending.clear()
    try {
      this.socket.close()
    } catch {
      // Already closed.
    }
  }
}

const GUARDED_TARGETS = new Set(['page', 'worker', 'service_worker', 'shared_worker'])
const MAX_PENDING_REQUESTS = 128

/**
 * Fail-closed HTTP(S) interception for every page/worker in a Stagehand
 * browser. Navigation checks cover redirects and subresources, not only tool
 * URLs. A lost guard closes the browser rather than leaving it unprotected.
 */
export class BrowserRequestGuard {
  private readonly sessions = new Set<string>()
  private readonly sessionSetup = new Map<string, Promise<void>>()
  private readonly pendingRequests = new Set<string>()
  private closed = false
  private blockedRequests = 0

  constructor(
    private readonly transport: CdpTransport,
    private readonly options: {
      verify?: (url: string) => Promise<unknown>
      onBlocked?: () => void
      onFatal?: (error: unknown) => void
    } = {}
  ) {}

  async start(): Promise<void> {
    this.transport.onEvent = (method, params, sessionId) => {
      void this.handleEvent(method, params, sessionId).catch((error) => this.fatal(error))
    }
    this.transport.onClose = () => {
      if (!this.closed) this.fatal(new BrowserError('BROWSER_CLOSED', 'Browser network protection disconnected.'))
    }
    await this.transport.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })
    const result = await this.transport.send('Target.getTargets')
    const targets = Array.isArray(result?.targetInfos) ? result.targetInfos : []
    for (const target of targets) {
      if (target?.targetId && GUARDED_TARGETS.has(target.type)) {
        await this.attachTarget(String(target.targetId))
      }
    }
  }

  private async handleEvent(method: string, params: Record<string, unknown>, sessionId?: string): Promise<void> {
    if (this.closed) return
    if (method === 'Target.attachedToTarget') {
      const target = params.targetInfo as { type?: string } | undefined
      const attachedSession = String(params.sessionId ?? '')
      if (!attachedSession) return
      if (!target?.type || !GUARDED_TARGETS.has(target.type)) {
        await this.transport.send('Runtime.runIfWaitingForDebugger', {}, attachedSession).catch(() => undefined)
        return
      }
      try {
        await this.setupSession(attachedSession)
      } catch (error) {
        const targetId = (params.targetInfo as { targetId?: string } | undefined)?.targetId
        if (targetId) await this.transport.send('Target.closeTarget', { targetId }).catch(() => undefined)
        throw error
      }
      return
    }
    if (method === 'Target.detachedFromTarget') {
      const detached = sessionId ?? String(params.sessionId ?? '')
      if (detached) {
        this.sessions.delete(detached)
        this.sessionSetup.delete(detached)
      }
      return
    }
    if (method === 'Fetch.requestPaused') {
      await this.handleRequest(params, sessionId)
    }
  }

  private async attachTarget(targetId: string): Promise<void> {
    const attached = await this.transport.send('Target.attachToTarget', { targetId, flatten: true })
    if (!attached?.sessionId) throw new Error('Chrome did not attach a page to the request guard.')
    await this.setupSession(String(attached.sessionId))
  }

  private async setupSession(sessionId: string): Promise<void> {
    const existing = this.sessionSetup.get(sessionId)
    if (existing) return existing
    const setup = (async () => {
      // Fetch is installed before resuming a new target. If this fails, the
      // target is closed; it is never allowed to continue without protection.
      await this.transport.send('Fetch.enable', {
        // Allow decisions are made by assertSafeNavigation, not by this
        // pattern. Intercept every scheme so file:, data:, and other local or
        // non-public destinations cannot bypass the navigation boundary.
        patterns: [{ urlPattern: '*', requestStage: 'Request' }]
      }, sessionId)
      this.sessions.add(sessionId)
      await this.transport.send('Runtime.runIfWaitingForDebugger', {}, sessionId)
    })()
    this.sessionSetup.set(sessionId, setup)
    try {
      await setup
    } catch (error) {
      this.sessionSetup.delete(sessionId)
      throw error
    }
  }

  private async handleRequest(params: Record<string, unknown>, sessionId?: string): Promise<void> {
    const requestId = String(params.requestId ?? '')
    const request = params.request as { url?: string } | undefined
    if (!sessionId || !requestId || !request?.url) {
      if (sessionId && requestId) await this.failRequest(sessionId, requestId)
      return
    }
    if (this.pendingRequests.has(requestId) || this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
      await this.failRequest(sessionId, requestId)
      return
    }
    this.pendingRequests.add(requestId)
    try {
      await (this.options.verify ?? assertSafeNavigation)(request.url)
      if (this.closed) return
      await this.transport.send('Fetch.continueRequest', { requestId }, sessionId)
    } catch {
      this.blockedRequests += 1
      this.options.onBlocked?.()
      await this.failRequest(sessionId, requestId)
    } finally {
      this.pendingRequests.delete(requestId)
    }
  }

  private async failRequest(sessionId: string, requestId: string): Promise<void> {
    await this.transport.send('Fetch.failRequest', {
      requestId,
      errorReason: 'BlockedByClient'
    }, sessionId).catch(() => undefined)
  }

  private fatal(error: unknown): void {
    if (this.closed) return
    this.closed = true
    this.options.onFatal?.(error)
  }

  stats(): { blockedRequests: number; guardedSessions: number } {
    return { blockedRequests: this.blockedRequests, guardedSessions: this.sessions.size }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.transport.onClose = undefined
    this.transport.onEvent = undefined
    this.transport.close()
  }
}
