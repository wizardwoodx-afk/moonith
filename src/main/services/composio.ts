import type { ComposioState, ComposioToolInfo, ComposioToolkitInfo } from '@shared/types'
import type { AgentTool } from '../agent/tools/types'
import { store } from '../store'
import { truncate } from '../util'

const API = 'https://backend.composio.dev/api/v3'
const CACHE_MS = 180_000
const TOOL_LIMIT = 100

interface MarketTool {
  slug: string
  name: string
  description: string
  toolkit: string
  parameters: Record<string, unknown>
}

interface ToolkitCache {
  at: number
  items: Array<{
    slug: string
    name: string
    description: string
    categories: string[]
    connected: boolean
  }>
}

class ComposioManager {
  private toolkitCache: ToolkitCache | null = null
  private toolCache = new Map<string, { at: number; items: MarketTool[] }>()
  private accountCache: { at: number; items: Map<string, string> } | null = null

  invalidate(): void {
    this.toolkitCache = null
    this.toolCache.clear()
    this.accountCache = null
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}
  ): Promise<unknown> {
    const config = store.getComposioConfig()
    if (!config.apiKey) throw new Error('Add a Composio API key first.')
    const url = new URL(`${API}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
    const text = await response.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    if (!response.ok) {
      const record = json as Record<string, unknown> | null
      const nested = record?.error as { message?: string } | undefined
      const message =
        nested?.message ||
        (typeof record?.message === 'string' ? record.message : '') ||
        `Composio responded ${response.status}`
      throw new Error(truncate(message, 300))
    }
    return json
  }

  private async connectedAccounts(force: boolean): Promise<Map<string, string>> {
    if (!force && this.accountCache && Date.now() - this.accountCache.at < CACHE_MS) {
      return this.accountCache.items
    }
    let items = new Map<string, string>()
    try {
      const json = (await this.request('/connected_accounts', {
        query: { limit: 100 }
      })) as {
        items?: Array<Record<string, unknown>>
        connected_accounts?: Array<Record<string, unknown>>
        data?: Array<Record<string, unknown>>
      }
      const raw = json.items ?? json.connected_accounts ?? json.data ?? []
      for (const item of raw) {
        const toolkit = String(
          (item.toolkit as { slug?: string } | undefined)?.slug ?? item.toolkit_slug ?? ''
        )
        const id = String(item.id ?? '')
        const status = String(item.status ?? '').toUpperCase()
        if (!toolkit || !id) continue
        if (status && status !== 'ACTIVE') continue
        if (!items.has(toolkit)) items.set(toolkit, id)
      }
    } catch {
      // Some Composio plans do not expose connected accounts; tool calls then rely on defaults.
      items = new Map()
    }
    this.accountCache = { at: Date.now(), items }
    return items
  }

  private async toolkits(force: boolean): Promise<ToolkitCache['items']> {
    if (!force && this.toolkitCache && Date.now() - this.toolkitCache.at < CACHE_MS) {
      return this.toolkitCache.items
    }
    const json = (await this.request('/toolkits', {
      query: { category: 'all', limit: 100, managedBy: 'user' }
    })) as {
      items?: Array<Record<string, unknown>>
      toolkits?: Array<Record<string, unknown>>
      data?: Array<Record<string, unknown>>
    }
    const raw = json.items ?? json.toolkits ?? json.data ?? []
    const items = raw.map((item) => {
      const accounts = item.connectedAccounts ?? item.connected_accounts
      return {
        slug: String(item.slug ?? item.key ?? item.name ?? ''),
        name: String(item.name ?? item.slug ?? 'Toolkit'),
        description: String(item.description ?? ''),
        categories: Array.isArray(item.categories)
          ? item.categories.map(String)
          : item.category
            ? [String(item.category)]
            : [],
        connected: Array.isArray(accounts) && accounts.length > 0
      }
    })
    this.toolkitCache = { at: Date.now(), items }
    return items
  }

  private async toolkitTools(slug: string): Promise<MarketTool[]> {
    const cached = this.toolCache.get(slug)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.items
    const json = (await this.request('/tools', {
      query: { toolkitSlug: slug, limit: TOOL_LIMIT, scopes: 'all' }
    })) as {
      items?: Array<Record<string, unknown>>
      tools?: Array<Record<string, unknown>>
      data?: Array<Record<string, unknown>>
    }
    const raw = json.items ?? json.tools ?? json.data ?? []
    const items = raw.map((item) => ({
      slug: String(item.slug ?? item.name ?? ''),
      name: String(item.name ?? item.slug ?? 'Tool'),
      description: String(item.description ?? ''),
      toolkit: String(
        (item.toolkit as { slug?: string } | undefined)?.slug ?? item.appName ?? item.app_name ?? slug
      ),
      parameters: (item.parameters ?? item.inputParameters ?? { type: 'object', properties: {} }) as Record<
        string,
        unknown
      >
    }))
    this.toolCache.set(slug, { at: Date.now(), items })
    return items
  }

  async getState(force = false): Promise<ComposioState> {
    const config = store.getComposioConfig()
    if (!config.apiKey) {
      return {
        configured: false,
        enabled: config.enabled,
        toolkits: [],
        tools: []
      }
    }
    if (!config.enabled) {
      return {
        configured: true,
        enabled: false,
        toolkits: [],
        tools: []
      }
    }
    try {
      const toolkits = await this.toolkits(force)
      const accounts = await this.connectedAccounts(force)
      const enabled = new Set(config.toolkits)
      const toolkitInfos: ComposioToolkitInfo[] = []
      const tools: ComposioToolInfo[] = []
      for (const toolkit of toolkits) {
        const isEnabled = enabled.has(toolkit.slug)
        let count = 0
        if (isEnabled) {
          const list = await this.toolkitTools(toolkit.slug)
          count = list.length
          for (const tool of list) {
            tools.push({
              slug: tool.slug,
              name: tool.name,
              description: tool.description,
              toolkit: toolkit.slug,
              enabled: true
            })
          }
        }
        toolkitInfos.push({
          ...toolkit,
          connected: accounts.has(toolkit.slug),
          tools: count,
          enabled: isEnabled
        })
      }
      return {
        configured: true,
        enabled: true,
        toolkits: toolkitInfos.sort((a, b) => a.name.localeCompare(b.name)),
        tools
      }
    } catch (error) {
      return {
        configured: true,
        enabled: true,
        toolkits: [],
        tools: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async getAgentTools(): Promise<AgentTool[]> {
    const config = store.getComposioConfig()
    if (!config.apiKey || !config.enabled || !config.toolkits.length) return []
    const accounts = await this.connectedAccounts(false).catch(() => new Map<string, string>())
    const tools: AgentTool[] = []
    for (const slug of config.toolkits.slice(0, 20)) {
      let list: MarketTool[]
      try {
        list = await this.toolkitTools(slug)
      } catch {
        continue
      }
      for (const tool of list) {
        if (tools.length >= 80) break
        const name = `composio_${tool.slug.replace(/[^a-zA-Z0-9_]/g, '_')}`
        const schema =
          tool.parameters && typeof tool.parameters === 'object' && Object.keys(tool.parameters).length
            ? tool.parameters
            : { type: 'object', properties: {}, additionalProperties: true }
        tools.push({
          name,
          title: `Composio · ${slug} · ${tool.name}`,
          description: `[${tool.toolkit || slug}] ${tool.description || tool.name}`,
          inputSchema: schema,
          sideEffect: 'network',
          risk: 'medium',
          approval: 'policy',
          execute: async (args: Record<string, unknown>) => {
            try {
              const accountId = accounts.get(slug)
              const json = (await this.request(`/tools/execute/${encodeURIComponent(tool.slug)}`, {
                method: 'POST',
                body: accountId
                  ? { arguments: args ?? {}, connected_account_id: accountId }
                  : { arguments: args ?? {}, user_id: 'knight' }
              })) as { data?: unknown; successful?: boolean; error?: unknown }
              const payload = json.data ?? json
              return {
                content: truncate(JSON.stringify(payload, null, 2), 30000),
                isError: json.successful === false
              }
            } catch (error) {
              return {
                content: `Composio tool error: ${error instanceof Error ? error.message : String(error)}`,
                isError: true
              }
            }
          },
          summarize: (args: Record<string, unknown>) =>
            `${tool.slug} ${truncate(JSON.stringify(args), 160)}`
        })
      }
    }
    return tools
  }
}

export const composioManager = new ComposioManager()
