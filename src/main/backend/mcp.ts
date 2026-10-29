/**
 * Minimal MCP (Model Context Protocol) client.
 * Supports stdio servers (JSON-RPC over stdio) and HTTP servers (JSON-RPC over POST).
 *
 * Ported from the earlier desktop shell.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { BackendMcpServer, BackendStore } from './store'
import { npxCommand, npxEnvironment } from './npx'

/**
 * Third-party MCP servers are not trusted with the host's provider credentials.
 * Scrub credential-shaped variables and loader hooks before spawning a server,
 * matching the security policy of npx package executions.
 */
export function buildMcpStdioEnv(
  userEnv: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...npxEnvironment(baseEnv), ...userEnv }
}

export interface McpServerInfo {
  name?: string
  version?: string
  [key: string]: unknown
}

export interface McpServerInput {
  id?: string
  name?: string
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  enabled?: boolean
}

export interface McpToolInfo {
  id: string
  serverId: string
  serverName: string
  name: string
  description: string
  schema: Record<string, unknown>
}

export interface McpToolFailure {
  id: string
  serverId: string
  serverName: string
  error: string
}

export type McpToolEntry = McpToolInfo | McpToolFailure

export interface McpConnectResult {
  ok: boolean
  serverInfo: McpServerInfo | null
}

interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
}

interface McpStdioConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface McpHttpConfig {
  url: string
  headers?: Record<string, string>
}

interface McpClient {
  serverInfo: McpServerInfo | null
  start?(): Promise<void>
  initialize(): Promise<unknown>
  listTools(): Promise<Tool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>
  stop(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function toToolList(value: unknown): Tool[] {
  if (!isRecord(value)) return []
  const list: unknown = value.tools
  if (!Array.isArray(list)) return []
  return list as Tool[]
}

/**
 * MCP servers answer with either plain JSON or a Server-Sent-Events stream
 * ("event: message\ndata: {...}"). Both have to be understood.
 */
function parseMcpResponse(raw: string): unknown {
  const text = String(raw || '').trim()
  if (!text) return {}
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text) as unknown

  // SSE: collect the data: frames and take the last complete one.
  const frames = text
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n')
    )
    .filter(Boolean)
  for (let i = frames.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(frames[i]) as unknown
    } catch {
      /* try the previous frame */
    }
  }
  throw new Error('MCP response was not valid JSON or SSE')
}

function toServerConfig(server: BackendMcpServer): McpServerConfig {
  return {
    id: server.id,
    name: server.name,
    command: server.command,
    args: server.args,
    env: server.env,
    url: typeof server.url === 'string' ? server.url : '',
    headers: isStringRecord(server.headers) ? server.headers : {}
  }
}

class McpStdioClient implements McpClient {
  private readonly command: string
  private readonly args: string[]
  private readonly env: Record<string, string>
  private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private buffer = ''
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >()
  private nextId = 1
  serverInfo: McpServerInfo | null = null

  constructor(config: McpStdioConfig) {
    this.command = config.command
    this.args = config.args || []
    this.env = config.env || {}
  }

  async start(): Promise<void> {
    const stdio: ['pipe', 'pipe', 'pipe'] = ['pipe', 'pipe', 'pipe']
    const env = buildMcpStdioEnv(this.env)
    /* On Windows `npx` is a cmd shim: spawning it pops a console window, and
     * Node refuses to exec a .cmd without a shell. Run its JS entrypoint. */
    const invocation =
      process.platform === 'win32' && /^npx(?:\.cmd)?$/i.test(this.command)
        ? npxCommand(this.args, env)
        : { command: this.command, args: this.args, env }
    this.proc = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      stdio,
      windowsHide: true
    })
    this.proc.stdout.on('data', (chunk: Buffer | string) => this._onData(chunk))
    this.proc.stderr.on('data', () => {})
    this.proc.on('exit', () => {
      for (const [, p] of this.pending) p.reject(new Error('MCP server exited'))
      this.pending.clear()
    })
  }

  _onData(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as unknown
        if (!isRecord(msg)) continue
        const id = msg.id
        if (typeof id !== 'number' || !this.pending.has(id)) continue
        const p = this.pending.get(id)
        this.pending.delete(id)
        if (!p) continue
        const error = msg.error
        if (error) {
          const message = isRecord(error) && typeof error.message === 'string' ? error.message : ''
          p.reject(new Error(message || 'MCP error'))
        } else {
          p.resolve(msg.result)
        }
      } catch {
        /* ignore non-JSON lines */
      }
    }
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc!.stdin.write(payload + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP ${method} timed out`))
        }
      }, 30000)
    })
  }

  async initialize(): Promise<unknown> {
    const res = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'selfimpulse', version: '0.1.0' }
    })
    this.serverInfo = (isRecord(res) ? res.serverInfo ?? null : null) as McpServerInfo | null
    this.proc!.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    )
    return res
  }

  async listTools(): Promise<Tool[]> {
    const res = await this.request('tools/list', {})
    return toToolList(res)
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.request('tools/call', { name, arguments: args })) as CallToolResult
  }

  stop(): void {
    try {
      this.proc?.kill()
    } catch {
      /* ignore */
    }
    this.proc = null
  }
}

class McpHttpClient implements McpClient {
  private readonly url: string
  private readonly headers: Record<string, string>
  private nextId = 1
  serverInfo: McpServerInfo | null = null

  constructor(config: McpHttpConfig) {
    this.url = config.url
    this.headers = config.headers || {}
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...this.headers
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params })
    })
    if (!res.ok) throw new Error(`MCP HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const raw = await res.text()
    const json = parseMcpResponse(raw)
    if (isRecord(json) && json.error) {
      const message = isRecord(json.error) && typeof json.error.message === 'string' ? json.error.message : ''
      throw new Error(message || 'MCP error')
    }
    return isRecord(json) ? json.result : undefined
  }

  async initialize(): Promise<unknown> {
    const res = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'selfimpulse', version: '0.1.0' }
    })
    this.serverInfo = (isRecord(res) ? res.serverInfo ?? null : null) as McpServerInfo | null
    return res
  }

  async listTools(): Promise<Tool[]> {
    const res = await this.request('tools/list', {})
    return toToolList(res)
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.request('tools/call', { name, arguments: args })) as CallToolResult
  }

  stop(): void {}
}

export class McpManager {
  private readonly store: BackendStore
  readonly workspace?: string
  private readonly clients = new Map<string, McpClient>()

  constructor(store: BackendStore, workspace?: string) {
    this.store = store
    this.workspace = workspace
  }

  config(): BackendMcpServer[] {
    return this.store.mcpServers.all()
  }

  async connect(id: string): Promise<McpConnectResult> {
    const cfg = this.store.mcpServers.find((s) => s.id === id)
    if (!cfg) throw new Error('MCP server not found')
    const config = toServerConfig(cfg)
    const client: McpClient = config.url ? new McpHttpClient(config) : new McpStdioClient(config)
    await client.start?.()
    await client.initialize()
    this.clients.set(id, client)
    return { ok: true, serverInfo: client.serverInfo }
  }

  async disconnect(id: string): Promise<{ ok: boolean }> {
    const c = this.clients.get(id)
    if (c) c.stop()
    this.clients.delete(id)
    return { ok: true }
  }

  async listTools(): Promise<McpToolEntry[]> {
    const out: McpToolEntry[] = []
    for (const cfg of this.config()) {
      try {
        if (!this.clients.has(cfg.id)) await this.connect(cfg.id)
        const client = this.clients.get(cfg.id)
        if (!client) throw new Error('MCP server not found')
        const tools = await client.listTools()
        for (const t of tools) {
          out.push({
            id: `${cfg.id}:${t.name}`,
            serverId: cfg.id,
            serverName: cfg.name,
            name: t.name,
            description: t.description || '',
            schema: (t.inputSchema || {}) as Record<string, unknown>
          })
        }
      } catch (err) {
        out.push({
          id: `${cfg.id}:__error__`,
          serverId: cfg.id,
          serverName: cfg.name,
          error: (err as Error).message
        })
      }
    }
    return out
  }

  async callTool(fullId: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const [serverId, ...rest] = fullId.split(':')
    const name = rest.join(':')
    if (!this.clients.has(serverId)) await this.connect(serverId)
    return this.clients.get(serverId)!.callTool(name, args)
  }

  add(cfg: McpServerInput): BackendMcpServer {
    const entry: BackendMcpServer = {
      id: cfg.id || `mcp_${Date.now().toString(36)}`,
      name: cfg.name || 'MCP server',
      url: cfg.url || '',
      command: cfg.command || '',
      args: cfg.args || [],
      env: cfg.env || {},
      headers: cfg.headers || {},
      enabled: cfg.enabled !== false
    }
    this.store.mcpServers.insert(entry)
    return entry
  }

  remove(id: string): boolean {
    void this.disconnect(id)
    return this.store.mcpServers.remove(id)
  }
}
