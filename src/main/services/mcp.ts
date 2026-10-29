import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpServerConfig, McpServerStatus, McpToolInfo } from '@shared/types'
import { store } from '../store'
import type { AgentTool } from '../agent/tools/types'
import { sendTaskEvent } from '../emitter'
import { truncate } from '../util'

interface Connection {
  config: McpServerConfig
  client: Client
  tools: McpToolInfo[]
  status: 'ready' | 'error'
  error?: string
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'server'
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ])
}

class McpManager {
  private connections = new Map<string, Connection>()
  private starting = new Map<string, string>()

  private toolName(server: McpServerConfig, tool: string): string {
    return `mcp__${sanitizeName(server.name)}__${tool}`
  }

  async startAll(): Promise<void> {
    const configs = store.getPublicSettings().mcpServers.filter((server) => server.enabled)
    await Promise.all(configs.map((config) => this.connect(config)))
  }

  async connect(config: McpServerConfig): Promise<void> {
    await this.disconnect(config.id)
    if (!config.enabled) return
    this.starting.set(config.id, 'starting')

    let stderr = ''
    let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport
    try {
      const kind = config.transport ?? 'stdio'
      if (kind === 'http') {
        if (!config.url) throw new Error('This HTTP MCP server has no endpoint URL.')
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers }
        })
      } else if (kind === 'sse') {
        if (!config.url) throw new Error('This SSE MCP server has no endpoint URL.')
        transport = new SSEClientTransport(new URL(config.url), {
          eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: config.headers }) },
          requestInit: { headers: config.headers }
        })
      } else {
        if (!config.command) throw new Error('This stdio MCP server has no command.')
        const stdio = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
          stderr: 'pipe',
          cwd: process.cwd()
        })
        stdio.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
          if (stderr.length > 8000) stderr = stderr.slice(-8000)
        })
        transport = stdio
      }
    } catch (error) {
      this.starting.delete(config.id)
      const message = error instanceof Error ? error.message : String(error)
      this.connections.set(config.id, {
        config,
        client: new Client({ name: 'selfimpulse', version: '0.1.0' }, { capabilities: {} }),
        tools: [],
        status: 'error',
        error: message
      })
      sendTaskEvent({
        type: 'toast',
        level: 'error',
        message: `MCP server “${config.name}” failed: ${message}`
      })
      return
    }

    const client = new Client(
      { name: 'selfimpulse', version: '0.1.0' },
      { capabilities: {} }
    )

    try {
      await withTimeout(client.connect(transport), 120000, 'MCP server did not start within 120s.')
      const tools: McpToolInfo[] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined)
        for (const tool of page.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as Record<string, unknown>
          })
        }
        cursor = page.nextCursor
      } while (cursor)

      this.connections.set(config.id, { config, client, tools, status: 'ready' })
      this.starting.delete(config.id)
      sendTaskEvent({
        type: 'toast',
        level: 'success',
        message: `Connected MCP server “${config.name}” (${tools.length} tools)`
      })
    } catch (error) {
      this.starting.delete(config.id)
      const message = error instanceof Error ? error.message : String(error)
      this.connections.set(config.id, {
        config,
        client,
        tools: [],
        status: 'error',
        error: stderr ? `${message}\n${truncate(stderr, 1200)}` : message
      })
      sendTaskEvent({
        type: 'toast',
        level: 'error',
        message: `MCP server “${config.name}” failed: ${message}`
      })
      try {
        await client.close()
      } catch {
        /* ignore */
      }
    }
  }

  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id)
    if (!connection) return
    this.connections.delete(id)
    try {
      await connection.client.close()
    } catch {
      /* ignore */
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.disconnect(id)))
  }

  getStatuses(): McpServerStatus[] {
    const configs = store.getPublicSettings().mcpServers
    return configs.map((config) => {
      const connection = this.connections.get(config.id)
      const starting = this.starting.has(config.id)
      if (starting) {
        return { id: config.id, name: config.name, status: 'starting', tools: [] }
      }
      if (!config.enabled) {
        return { id: config.id, name: config.name, status: 'stopped', tools: [] }
      }
      if (!connection) {
        return { id: config.id, name: config.name, status: 'stopped', tools: [] }
      }
      return {
        id: config.id,
        name: config.name,
        status: connection.status,
        error: connection.error,
        tools: connection.tools
      }
    })
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{
    text: string
    isError: boolean
  }> {
    const connection = this.connections.get(serverId)
    if (!connection || connection.status !== 'ready') {
      return { text: 'MCP server is not connected.', isError: true }
    }
    try {
      const result = (await withTimeout(
        connection.client.callTool({ name: toolName, arguments: args }),
        180000,
        'MCP tool call timed out after 180s.'
      )) as {
        isError?: boolean
        content?: Array<{ type: string; text?: string; mimeType?: string; data?: string }>
        structuredContent?: unknown
      }
      const parts: string[] = []
      for (const item of result.content ?? []) {
        if (item.type === 'text' && item.text) parts.push(item.text)
        else if (item.type === 'image') parts.push(`[image ${item.mimeType ?? ''} ${item.data?.length ?? 0} bytes]`)
        else if (item.type === 'audio') parts.push(`[audio ${item.mimeType ?? ''}]`)
        else parts.push(`[${item.type}]`)
      }
      if (!parts.length && result.structuredContent) {
        parts.push(JSON.stringify(result.structuredContent))
      }
      return {
        text: truncate(parts.join('\n') || '(no output)', 30000),
        isError: Boolean(result.isError)
      }
    } catch (error) {
      return {
        text: `MCP tool error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      }
    }
  }

  getAgentTools(): AgentTool[] {
    const tools: AgentTool[] = []
    for (const connection of this.connections.values()) {
      if (connection.status !== 'ready') continue
      const allow = connection.config.toolAllowlist?.length
        ? new Set(connection.config.toolAllowlist)
        : undefined
      for (const tool of connection.tools) {
        if (allow && !allow.has(tool.name)) continue
        const name = this.toolName(connection.config, tool.name)
        tools.push({
          name,
          title: `MCP · ${connection.config.name} · ${tool.name}`,
          description: `[MCP server: ${connection.config.name}] ${tool.description ?? tool.name}`,
          inputSchema: tool.inputSchema ?? { type: 'object', additionalProperties: true },
          sideEffect: 'execute',
          risk: 'medium',
          approval: 'policy',
          execute: async (args: Record<string, unknown>) => {
            const result = await this.callTool(connection.config.id, tool.name, args ?? {})
            return { content: result.text, isError: result.isError }
          },
          summarize: (args: Record<string, unknown>) => `${connection.config.name} · ${tool.name} ${JSON.stringify(args).slice(0, 160)}`
        })
      }
    }
    return tools
  }
}

export const mcpManager = new McpManager()
