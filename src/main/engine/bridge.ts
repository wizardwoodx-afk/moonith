import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'

export interface BridgeTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface BridgeRuntime {
  listTools(): BridgeTool[]
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }>
}

interface Message {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: string
}

/**
 * The engine discovers tools from an MCP server. Instead of a separate
 * implementation, a small bridge process speaks MCP to the engine and forwards
 * tool calls here over a private named pipe, so every call still runs through
 * SelfImpulse's governance, approvals and tool implementations.
 *
 * Several tasks can run at once, and MCP calls carry no task identity, so each
 * running turn registers under a short scope and its tools are advertised as
 * `<scope>_<tool>`. The engine prefixes the server name, giving the model
 * `selfimpulse_<scope>_<tool>`; the bridge strips both prefixes on the way back.
 */
class ToolBridgeHost {
  private server?: Server
  private socket?: Socket
  private token = ''
  private runtimes = new Map<string, BridgeRuntime>()
  private pipePath = ''

  async start(): Promise<{ pipePath: string; token: string }> {
    if (this.server && this.pipePath) return { pipePath: this.pipePath, token: this.token }
    this.token = randomBytes(18).toString('base64url')
    this.pipePath = `\\\\.\\pipe\\selfimpulse-engine-${process.pid}-${randomBytes(6).toString('hex')}`
    const server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.pipePath, () => resolve())
    })
    this.server = server
    return { pipePath: this.pipePath, token: this.token }
  }

  register(scope: string, runtime: BridgeRuntime): void {
    this.runtimes.set(scope, runtime)
    this.notifyToolsChanged()
  }

  unregister(scope: string): void {
    if (!this.runtimes.delete(scope)) return
    this.notifyToolsChanged()
  }

  private scopes(): string[] {
    return [...this.runtimes.keys()].sort((a, b) => b.length - a.length)
  }

  private notifyToolsChanged(): void {
    this.send({ method: 'tools_changed' })
  }

  private accept(socket: Socket): void {
    socket.setEncoding('utf8')
    this.socket?.destroy()
    this.socket = socket
    let buffer = ''
    let authorized = false
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let boundary = buffer.indexOf('\n')
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 1)
        boundary = buffer.indexOf('\n')
        if (!line) continue
        let message: Message
        try {
          message = JSON.parse(line) as Message
        } catch {
          continue
        }
        if (!authorized) {
          if ((message as { token?: string }).token !== this.token) {
            socket.destroy()
            return
          }
          authorized = true
          continue
        }
        void this.handle(message)
      }
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined
    })
  }

  private async handle(message: Message): Promise<void> {
    if (message.id === undefined) return
    try {
      if (message.method === 'list') {
        const tools: BridgeTool[] = []
        for (const [scope, runtime] of this.runtimes) {
          for (const tool of runtime.listTools()) {
            tools.push({ ...tool, name: `${scope}_${tool.name}` })
          }
        }
        this.send({ id: message.id, result: tools })
        return
      }
      if (message.method === 'call') {
        const name = String(message.params?.name ?? '')
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>
        const scope = this.scopes().find((candidate) => name.startsWith(`${candidate}_`))
        const runtime = scope ? this.runtimes.get(scope) : undefined
        if (!scope || !runtime) throw new Error('No task is running, so tools are not available.')
        const result = await runtime.callTool(name.slice(scope.length + 1), args)
        this.send({ id: message.id, result })
        return
      }
      throw new Error(`Unknown bridge method ${message.method ?? '(none)'}`)
    } catch (error) {
      this.send({ id: message.id, error: error instanceof Error ? error.message : String(error) })
    }
  }

  private send(message: Message): void {
    this.socket?.write(JSON.stringify(message) + '\n')
  }

  async stop(): Promise<void> {
    this.runtimes.clear()
    this.socket?.destroy()
    this.socket = undefined
    const server = this.server
    this.server = undefined
    this.pipePath = ''
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export const toolBridge = new ToolBridgeHost()
