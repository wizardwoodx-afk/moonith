import type {
  ConnectorsConnectResult,
  ConnectorsState,
  ConnectorsToolInfo,
  ConnectorsToolkitInfo
} from '@shared/types'
import type { AgentTool } from '../agent/tools/types'
import { store } from '../store'
import { truncate } from '../util'

const API = 'https://backend.composio.dev/api/v3.1'
const CACHE_MS = 60_000
const TOOL_LIMIT = 100
const MAX_ENABLED_TOOLKITS = 20
const MAX_AGENT_TOOLS = 80

interface MarketTool {
  slug: string
  name: string
  description: string
  toolkit: string
  parameters: Record<string, unknown>
}

interface ToolkitRecord {
  slug: string
  name: string
  description: string
  categories: string[]
  logo?: string
  noAuth: boolean
  authSchemes: string[]
  tools: number
}

interface AuthConfigRecord {
  id: string
  toolkit: string
  scheme: string
}

interface AccountRecord {
  id: string
  toolkit: string
  status: string
  authConfigId?: string
  scheme?: string
}

interface Cache<T> {
  at: number
  value: T
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function listFrom(json: unknown): JsonRecord[] {
  const record = asRecord(json)
  for (const key of ['items', 'toolkits', 'tools', 'data', 'connected_accounts']) {
    const value = record[key]
    if (Array.isArray(value)) return value.map(asRecord)
  }
  return []
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function statusOf(value: unknown): string {
  return text(value).toUpperCase()
}

function isActive(status: string): boolean {
  return status === 'ACTIVE'
}

function isPending(status: string): boolean {
  return status === 'INITIALIZING' || status === 'INITIATED'
}

function toolkitSlug(item: JsonRecord): string {
  const toolkit = asRecord(item.toolkit)
  return text(toolkit.slug) || text(item.toolkit_slug) || text(item.slug)
}

function parseToolkit(item: JsonRecord): ToolkitRecord {
  const meta = asRecord(item.meta)
  const categoriesValue = item.categories ?? meta.categories
  const categories = Array.isArray(categoriesValue)
    ? categoriesValue
        .map((entry) => {
          if (typeof entry === 'string') return entry
          const record = asRecord(entry)
          return text(record.name) || text(record.slug)
        })
        .filter(Boolean)
    : text(item.category)
      ? [text(item.category)]
      : []
  const schemesValue = item.auth_schemes ?? meta.auth_schemes
  const authSchemes = Array.isArray(schemesValue)
    ? schemesValue
        .map((entry) => {
          if (typeof entry === 'string') return entry
          const record = asRecord(entry)
          return text(record.scheme) || text(record.name) || text(record.mode)
        })
        .filter(Boolean)
    : text(item.auth_scheme)
      ? [text(item.auth_scheme)]
      : []
  const slug = text(item.slug) || text(item.key)
  return {
    slug,
    name: text(item.name) || slug || 'Toolkit',
    description: text(meta.description) || text(item.description),
    categories,
    logo: text(meta.logo) || text(item.logo) || undefined,
    noAuth: item.no_auth === true || meta.no_auth === true,
    authSchemes,
    tools: count(meta.tools_count) || count(item.tools_count)
  }
}

function parseAuthConfig(item: JsonRecord): AuthConfigRecord {
  return {
    id: text(item.id),
    toolkit: toolkitSlug(item),
    scheme: text(item.auth_scheme) || text(asRecord(item.auth_config).auth_scheme)
  }
}

function parseAccount(item: JsonRecord): AccountRecord {
  return {
    id: text(item.id),
    toolkit: toolkitSlug(item),
    status: statusOf(item.status),
    authConfigId: text(asRecord(item.auth_config).id) || text(item.auth_config_id) || undefined,
    scheme: text(asRecord(item.auth_config).auth_scheme) || undefined
  }
}

function apiError(json: unknown, fallback: string): string {
  const record = asRecord(json)
  const error = asRecord(record.error)
  const message =
    text(error.message) ||
    text(record.message) ||
    text(error.slug) ||
    text(record.detail) ||
    fallback
  const suggestion = text(error.suggested_fix)
  return truncate(suggestion ? `${message} ${suggestion}` : message, 360)
}

class ConnectorsManager {
  private toolkitCache: Cache<ToolkitRecord[]> | null = null
  private toolCache = new Map<string, Cache<MarketTool[]>>()
  private authCache: Cache<Map<string, AuthConfigRecord>> | null = null
  private accountCache: Cache<Map<string, AccountRecord>> | null = null

  invalidate(): void {
    this.toolkitCache = null
    this.toolCache.clear()
    this.authCache = null
    this.accountCache = null
  }

  private async request(
    path: string,
    options: {
      method?: string
      body?: unknown
      query?: Record<string, string | number | boolean | undefined>
    } = {}
  ): Promise<unknown> {
    const config = store.getConnectorsConfig()
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
    const raw = await response.text()
    let json: unknown = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = { raw }
    }
    if (!response.ok) {
      throw new Error(apiError(json, `Composio responded ${response.status}`))
    }
    return json
  }

  private async listToolkits(force: boolean): Promise<ToolkitRecord[]> {
    if (!force && this.toolkitCache && Date.now() - this.toolkitCache.at < CACHE_MS) {
      return this.toolkitCache.value
    }
    const json = await this.request('/toolkits', {
      query: { limit: 200, sort_by: 'usage' }
    })
    const items = listFrom(json)
      .map(parseToolkit)
      .filter((item) => Boolean(item.slug))
    this.toolkitCache = { at: Date.now(), value: items }
    return items
  }

  private async listAuthConfigs(force: boolean): Promise<Map<string, AuthConfigRecord>> {
    if (!force && this.authCache && Date.now() - this.authCache.at < CACHE_MS) {
      return this.authCache.value
    }
    const json = await this.request('/auth_configs', { query: { limit: 200 } })
    const items = new Map<string, AuthConfigRecord>()
    for (const item of listFrom(json).map(parseAuthConfig)) {
      if (item.id && item.toolkit && !items.has(item.toolkit)) items.set(item.toolkit, item)
    }
    this.authCache = { at: Date.now(), value: items }
    return items
  }

  private async listAccounts(force: boolean): Promise<Map<string, AccountRecord>> {
    if (!force && this.accountCache && Date.now() - this.accountCache.at < CACHE_MS) {
      return this.accountCache.value
    }
    const userId = store.getConnectorsConfig().userId
    const json = await this.request('/connected_accounts', {
      query: { limit: 200, user_ids: userId }
    })
    const items = new Map<string, AccountRecord>()
    for (const item of listFrom(json).map(parseAccount)) {
      if (!item.id || !item.toolkit) continue
      const existing = items.get(item.toolkit)
      if (!existing || (isActive(item.status) && !isActive(existing.status))) {
        items.set(item.toolkit, item)
      }
    }
    this.accountCache = { at: Date.now(), value: items }
    return items
  }

  private async toolkitTools(slug: string): Promise<MarketTool[]> {
    const cached = this.toolCache.get(slug)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
    const json = await this.request('/tools', {
      query: { toolkit_slug: slug, toolkit_versions: 'latest', limit: TOOL_LIMIT }
    })
    const items = listFrom(json)
      .map((item) => ({
        slug: text(item.slug) || text(item.name),
        name: text(item.name) || text(item.slug) || 'Tool',
        description: text(item.description),
        toolkit: toolkitSlug(item) || slug,
        parameters: (item.parameters ??
          item.input_parameters ??
          item.inputParameters ??
          { type: 'object', properties: {} }) as Record<string, unknown>
      }))
      .filter((item) => Boolean(item.slug))
    this.toolCache.set(slug, { at: Date.now(), value: items })
    return items
  }

  async getState(force = false): Promise<ConnectorsState> {
    const config = store.getConnectorsConfig()
    const userId = config.userId
    if (!config.apiKey) {
      return { configured: false, enabled: config.enabled, userId, toolkits: [], tools: [] }
    }
    if (!config.enabled) {
      return { configured: true, enabled: false, userId, toolkits: [], tools: [] }
    }
    try {
      const [toolkits, authConfigs, accounts] = await Promise.all([
        this.listToolkits(force),
        this.listAuthConfigs(force).catch(() => new Map<string, AuthConfigRecord>()),
        this.listAccounts(force).catch(() => new Map<string, AccountRecord>())
      ])
      const enabled = new Set(config.toolkits)
      const toolkitInfos: ConnectorsToolkitInfo[] = []
      const tools: ConnectorsToolInfo[] = []
      let fetched = 0
      for (const toolkit of toolkits) {
        const account = accounts.get(toolkit.slug)
        const authConfig = authConfigs.get(toolkit.slug)
        const active = isActive(account?.status ?? '')
        const pending = isPending(account?.status ?? '')
        const noAuth = toolkit.noAuth
        const isEnabled = enabled.has(toolkit.slug)
        let toolCount = toolkit.tools
        if (isEnabled && (active || noAuth) && fetched < MAX_ENABLED_TOOLKITS) {
          fetched += 1
          try {
            const list = await this.toolkitTools(toolkit.slug)
            toolCount = list.length
            for (const tool of list) {
              tools.push({
                slug: tool.slug,
                name: tool.name,
                description: tool.description,
                toolkit: toolkit.slug,
                enabled: true
              })
            }
          } catch {
            // A toolkit can be connected while its tool catalogue is temporarily
            // unavailable; keep the connection state visible instead of failing
            // the whole page.
          }
        }
        toolkitInfos.push({
          slug: toolkit.slug,
          name: toolkit.name,
          description: toolkit.description,
          categories: toolkit.categories,
          logo: toolkit.logo,
          connected: active || noAuth,
          tools: toolCount,
          enabled: isEnabled,
          authScheme: authConfig?.scheme || toolkit.authSchemes[0],
          connectionStatus: noAuth
            ? 'no_auth'
            : active
              ? 'connected'
              : pending
                ? 'pending'
                : account && account.status && account.status !== 'ACTIVE'
                  ? 'error'
                  : 'not_connected',
          connectedAccountId: active ? account?.id : undefined,
          authConfigId: authConfig?.id,
          connectable: !noAuth
        })
      }
      return {
        configured: true,
        enabled: true,
        userId,
        toolkits: toolkitInfos.sort(
          (a, b) =>
            Number(b.enabled) - Number(a.enabled) ||
            Number(b.connected) - Number(a.connected) ||
            a.name.localeCompare(b.name)
        ),
        tools
      }
    } catch (error) {
      return {
        configured: true,
        enabled: true,
        userId,
        toolkits: [],
        tools: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async connect(toolkit: string): Promise<ConnectorsConnectResult> {
    const slug = String(toolkit ?? '').trim()
    if (!slug) throw new Error('Choose a toolkit first.')
    const config = store.getConnectorsConfig()
    if (!config.apiKey) throw new Error('Add a Composio API key first.')

    const toolkits = await this.listToolkits(false)
    const info = toolkits.find((item) => item.slug === slug)
    if (info?.noAuth) {
      return {
        redirectUrl: '',
        status: 'no_auth',
        message: `${info.name} does not require an account connection. Enable it and its tools are ready.`
      }
    }

    const authConfigs = await this.listAuthConfigs(false)
    let authConfig = authConfigs.get(slug)
    if (!authConfig) {
      const created = await this.request('/auth_configs', {
        method: 'POST',
        body: {
          toolkit: { slug },
          auth_config: {
            type: 'use_composio_managed_auth',
            credentials: {}
          }
        }
      })
      const record = asRecord(created)
      const auth = asRecord(record.auth_config)
      const id = text(auth.id)
      if (!id) {
        throw new Error(
          `${info?.name ?? slug} needs credentials that Composio cannot manage automatically. Add an auth config in the Composio dashboard, then refresh.`
        )
      }
      authConfig = {
        id,
        toolkit: slug,
        scheme: text(auth.auth_scheme)
      }
      this.authCache = null
    }

    const link = await this.request('/connected_accounts/link', {
      method: 'POST',
      body: {
        auth_config_id: authConfig.id,
        user_id: config.userId,
        alias: `${config.userId}-${slug}`.slice(0, 120)
      }
    })
    const record = asRecord(link)
    const redirectUrl = text(record.redirect_url)
    const connectedAccountId = text(record.connected_account_id) || undefined
    this.accountCache = null
    if (!redirectUrl) {
      throw new Error('Composio did not return a connection link. Refresh and try again.')
    }
    return {
      redirectUrl,
      connectedAccountId,
      status: 'pending',
      message: 'Finish the connection in your browser, then refresh Composio.'
    }
  }

  async disconnect(toolkit: string): Promise<ConnectorsState> {
    const slug = String(toolkit ?? '').trim()
    if (!slug) throw new Error('Choose a toolkit first.')
    const accounts = await this.listAccounts(true)
    const account = accounts.get(slug)
    if (account?.id) {
      await this.request(`/connected_accounts/${encodeURIComponent(account.id)}`, {
        method: 'DELETE'
      })
    }
    const config = store.getConnectorsConfig()
    await store.saveConnectors({
      toolkits: config.toolkits.filter((item) => item !== slug)
    })
    this.invalidate()
    return this.getState(true)
  }

  async getAgentTools(): Promise<AgentTool[]> {
    const config = store.getConnectorsConfig()
    if (!config.apiKey || !config.enabled || !config.toolkits.length) return []
    const [toolkits, accounts] = await Promise.all([
      this.listToolkits(false).catch(() => [] as ToolkitRecord[]),
      this.listAccounts(false).catch(() => new Map<string, AccountRecord>())
    ])
    const bySlug = new Map(toolkits.map((toolkit) => [toolkit.slug, toolkit]))
    const tools: AgentTool[] = []
    for (const slug of config.toolkits.slice(0, MAX_ENABLED_TOOLKITS)) {
      const toolkit = bySlug.get(slug)
      const account = accounts.get(slug)
      const active = isActive(account?.status ?? '')
      const noAuth = toolkit?.noAuth ?? false
      if (!active && !noAuth) continue
      let list: MarketTool[]
      try {
        list = await this.toolkitTools(slug)
      } catch {
        continue
      }
      for (const tool of list) {
        if (tools.length >= MAX_AGENT_TOOLS) break
        const name = `connectors_${tool.slug.replace(/[^a-zA-Z0-9_]/g, '_')}`
        const schema =
          tool.parameters && typeof tool.parameters === 'object' && Object.keys(tool.parameters).length
            ? tool.parameters
            : { type: 'object', properties: {}, additionalProperties: true }
        tools.push({
          name,
          title: `Connector · ${toolkitName(bySlug, slug)} · ${tool.name}`,
          description: `[connector · ${slug}] ${tool.description || tool.name}`,
          inputSchema: schema,
          sideEffect: 'network',
          risk: 'medium',
          approval: 'policy',
          execute: async (args: Record<string, unknown>) => {
            try {
              const json = (await this.request(`/tools/execute/${encodeURIComponent(tool.slug)}`, {
                method: 'POST',
                body: {
                  arguments: args ?? {},
                  user_id: config.userId,
                  ...(active && account?.id ? { connected_account_id: account.id } : {}),
                  version: 'latest'
                }
              })) as { data?: unknown; successful?: boolean; error?: unknown }
              const payload = json.data ?? json
              return {
                content: truncate(JSON.stringify(payload, null, 2), 30000),
                isError: json.successful === false
              }
            } catch (error) {
              return {
                content: `Composio tool error: ${
                  error instanceof Error ? error.message : String(error)
                }`,
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

function toolkitName(map: Map<string, ToolkitRecord>, slug: string): string {
  return map.get(slug)?.name ?? slug
}

export const connectorsManager = new ConnectorsManager()
