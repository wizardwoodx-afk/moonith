export interface EngineEvent {
  type: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export interface EngineSession {
  id: string
  title?: string
  parentID?: string
  model?: { providerID: string; id: string }
  tokens?: Record<string, number>
  cost?: number
}

export interface EngineToolCall {
  name: string
  args: Record<string, unknown>
  callId: string
}

export class EngineHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`Engine request failed (${status}): ${body.slice(0, 400)}`)
    this.name = 'EngineHttpError'
  }
}

/**
 * Thin HTTP client for the execution engine. The engine authenticates with
 * HTTP basic auth; the password lives only in this process and the child's
 * environment.
 */
export class EngineClient {
  private readonly authorization: string
  private stream?: AbortController
  private readonly listeners = new Set<(event: EngineEvent) => void>()

  constructor(
    private readonly baseUrl: string,
    password: string
  ) {
    this.authorization = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')
  }

  private headers(): Record<string, string> {
    return { authorization: this.authorization, 'content-type': 'application/json' }
  }

  async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    })
    const text = await response.text()
    if (!response.ok) throw new EngineHttpError(response.status, text)
    if (!text) return undefined as T
    const parsed = JSON.parse(text) as { data?: T } & T
    return (parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed) as T
  }

  async health(): Promise<boolean> {
    try {
      await this.request('GET', '/api/model')
      return true
    } catch {
      return false
    }
  }

  createSession(input: {
    title: string
    model?: { providerID: string; id: string }
    directory: string
    /** Runs the session as a child of another one, the way the engine's own
     *  subagent tool does. The child inherits the parent's location. */
    parentID?: string
  }): Promise<EngineSession> {
    return this.request<EngineSession>('POST', '/api/session', {
      title: input.title,
      ...(input.model ? { model: input.model } : {}),
      ...(input.parentID ? { parentID: input.parentID } : {}),
      location: { directory: input.directory.split('\\').join('/') }
    })
  }

  listInstructions(sessionId: string): Promise<Array<{ key: string; value: unknown }>> {
    return this.request<Array<{ key: string; value: unknown }>>(
      'GET',
      `/api/experimental/session/${encodeURIComponent(sessionId)}/instructions/entries`
    )
  }

  getSession(sessionId: string): Promise<EngineSession> {
    return this.request<EngineSession>('GET', `/api/session/${encodeURIComponent(sessionId)}`)
  }

  prompt(sessionId: string, text: string): Promise<unknown> {
    return this.request('POST', `/api/session/${encodeURIComponent(sessionId)}/prompt`, { text })
  }

  /**
   * The engine brings a directory's MCP servers online in the background after
   * the location starts, and a prompt sent before that settles is built without
   * the bridge tools. Wait for the workspace's bridge server so the first step
   * already sees them.
   */
  async waitForTools(directory: string, timeoutMs = 20_000): Promise<boolean> {
    const location = encodeURIComponent(directory.split('\\').join('/'))
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const servers = await this.request<Array<{ name: string; status?: { status?: string } }>>(
          'GET',
          `/api/mcp?location[directory]=${location}`
        )
        const bridge = (servers ?? []).find((server) => server.name === 'selfimpulse')
        if (!bridge) return true
        if (bridge.status?.status === 'connected') {
          // The tool registry refreshes on a short debounce after the connect.
          await new Promise((resolve) => setTimeout(resolve, 250))
          return true
        }
        if (bridge.status?.status === 'failed' || bridge.status?.status === 'disabled') return false
      } catch {
        // The location may still be starting; keep polling until the deadline.
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return false
  }

  interrupt(sessionId: string): Promise<unknown> {
    return this.request('POST', `/api/session/${encodeURIComponent(sessionId)}/interrupt`, {})
  }

  /**
   * Attaches a durable instruction to a session. The engine renders it inside
   * its own instruction block, which is where a system prompt belongs — no
   * file in the user's workspace has to hold it.
   */
  putInstruction(sessionId: string, key: string, value: unknown): Promise<void> {
    return this.request(
      'PUT',
      `/api/experimental/session/${encodeURIComponent(sessionId)}/instructions/entries/${encodeURIComponent(key)}`,
      { value }
    )
  }

  replyPermission(
    sessionId: string,
    requestId: string,
    decision: 'once' | 'always' | 'reject'
  ): Promise<unknown> {
    return this.request(
      'POST',
      `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
      { decision }
    )
  }

  /** One long-lived event stream; events fan out to registered listeners. */
  startStream(onError?: (error: Error) => void): void {
    if (this.stream) return
    const controller = new AbortController()
    this.stream = controller
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(this.baseUrl + '/api/event', {
            headers: this.headers(),
            signal: controller.signal
          })
          if (!response.ok || !response.body) throw new Error(`Event stream failed (${response.status})`)
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let boundary = buffer.indexOf('\n\n')
            while (boundary >= 0) {
              const chunk = buffer.slice(0, boundary)
              buffer = buffer.slice(boundary + 2)
              const line = chunk.split('\n').find((item) => item.startsWith('data:'))
              if (line) {
                try {
                  const event = JSON.parse(line.slice(5).trim()) as EngineEvent
                  for (const listener of this.listeners) listener(event)
                } catch {
                  // A truncated frame is not worth killing the stream over.
                }
              }
              boundary = buffer.indexOf('\n\n')
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return
          onError?.(error instanceof Error ? error : new Error(String(error)))
        }
        // Reconnect unless the whole client was closed.
        if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    })()
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.stream?.abort()
    this.stream = undefined
    this.listeners.clear()
  }
}
