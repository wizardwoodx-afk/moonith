/**
 * Connectors client — the real tool-integration platform (250+ apps / 1000+ tools).
 *
 * Authenticates with the user's own Connectors API key, which they add in
 * Settings → Connectors. Nothing is faked: without a key the app shows the
 * real "not connected" state, and with one it lists the live toolkits and
 * executes their tools through Connectors's v3 API.
 *
 * Ported from the earlier desktop shell.
 */
import type { BackendStore } from './store'

export const API = 'https://backend.composio.dev/api/v3'

type QueryValue = string | number | boolean | null | undefined

interface ConnectorsRequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, QueryValue>
}

/** A toolkit entry as Connectors's v3 API returns it. */
interface ConnectorsToolkitPayload {
  slug?: string
  key?: string
  name?: string
  description?: string
  categories?: string[]
  category?: string
  meta?: Record<string, unknown>
  connectedAccounts?: unknown[]
  connected_accounts?: unknown[]
}

/** A tool entry as Connectors's v3 API returns it. */
interface ConnectorsToolPayload {
  slug?: string
  name?: string
  toolkit?: { slug?: string }
  appName?: string
  app_name?: string
  description?: string
  method?: string
  parameters?: Record<string, unknown>
  inputParameters?: Record<string, unknown>
}

export interface ConnectorsToolkit {
  id: string | undefined
  name: string | undefined
  description: string
  categories: string[]
  meta: Record<string, unknown>
  connected: boolean
}

export interface ConnectorsTool {
  name: string | undefined
  toolkit: string
  description: string
  method: string
  parameters: Record<string, unknown>
}

export interface ConnectorsToolkitPage {
  items: ConnectorsToolkit[]
  total: number
  nextCursor: string | null
}

export interface ConnectorsToolPage {
  items: ConnectorsTool[]
  total: number
  nextCursor: string | null
}

export interface ConnectorsToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ConnectorsExecuteResult {
  ok: boolean
  data: unknown
  successful: boolean
}

export interface ConnectorsToolkitsOptions {
  category?: string
  limit?: number
  cursor?: string
}

export interface ConnectorsToolsOptions {
  toolkit?: string
  limit?: number
  cursor?: string
}

export interface ConnectorsExecuteOptions {
  tool: string
  args?: Record<string, unknown>
  entityId?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function pickList<T>(json: unknown, keys: readonly string[]): T[] {
  const record = asRecord(json)
  for (const key of keys) {
    const value = record[key]
    if (value) return value as T[]
  }
  return []
}

function truthyString(value: unknown): string | undefined {
  return value ? String(value) : undefined
}

export class Connectors {
  readonly store: BackendStore

  constructor(store: BackendStore) {
    this.store = store
  }

  get apiKey(): string {
    const raw = this.store.settings.all().connectorsApiKey
    return raw ? String(raw) : ''
  }

  get connected(): boolean {
    return Boolean(this.apiKey)
  }

  headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey
    }
  }

  async request(path: string, { method = 'GET', body, query }: ConnectorsRequestOptions = {}): Promise<unknown> {
    if (!this.apiKey) throw new Error('Add your Connectors API key in Settings → Connectors first.')
    const url = new URL(`${API}${path}`)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    if (!res.ok) {
      const record = asRecord(json)
      const error = asRecord(record.error)
      const msg =
        truthyString(error.message) ?? truthyString(record.message) ?? `Connectors responded ${res.status}`
      throw new Error(String(msg).slice(0, 300))
    }
    return json
  }

  /** Live toolkit catalogue (Connectors calls them "toolkits" in v3). */
  async toolkits({ category = 'all', limit = 60, cursor }: ConnectorsToolkitsOptions = {}): Promise<ConnectorsToolkitPage> {
    const json = await this.request('/toolkits', {
      query: { category, limit, cursor, managedBy: 'user' }
    })
    const items = pickList<ConnectorsToolkitPayload>(json, ['items', 'toolkits', 'data'])
    const record = asRecord(json)
    return {
      items: items.map((t) => ({
        id: t.slug || t.key || t.name,
        name: t.name || t.slug,
        description: t.description || '',
        categories: t.categories || (t.category ? [t.category] : []),
        meta: t.meta || {},
        connected: Boolean(t.connectedAccounts?.length || t.connected_accounts?.length)
      })),
      total: typeof record.total === 'number' ? record.total : items.length,
      nextCursor: truthyString(record.nextCursor) ?? truthyString(record.next_cursor) ?? null
    }
  }

  /** Live tool catalogue, optionally filtered by toolkit. */
  async tools({ toolkit, limit = 100, cursor }: ConnectorsToolsOptions = {}): Promise<ConnectorsToolPage> {
    const json = await this.request('/tools', {
      query: { toolkitSlug: toolkit, limit, cursor, scopes: 'all' }
    })
    const items = pickList<ConnectorsToolPayload>(json, ['items', 'tools', 'data'])
    const record = asRecord(json)
    return {
      items: items.map((t) => ({
        name: t.slug || t.name,
        toolkit: t.toolkit?.slug || t.appName || t.app_name || '',
        description: t.description || '',
        method: t.method || 'execute',
        parameters: t.parameters || t.inputParameters || {}
      })),
      total: typeof record.total === 'number' ? record.total : items.length,
      nextCursor: truthyString(record.nextCursor) ?? truthyString(record.next_cursor) ?? null
    }
  }

  /** Execute a Connectors tool on behalf of the agent. */
  async execute({ tool, args = {}, entityId = 'default' }: ConnectorsExecuteOptions): Promise<ConnectorsExecuteResult> {
    const json = await this.request(`/tools/execute/${encodeURIComponent(tool)}`, {
      method: 'POST',
      body: { arguments: args, entity_id: entityId, connected_account_id: 'default' }
    })
    const record = asRecord(json)
    const successful = record.successful
    return {
      ok: true,
      data: record.data ?? json,
      successful: typeof successful === 'boolean' ? successful : true
    }
  }

  /** The tool specs handed to the model as Connectors-backed tools. */
  async toolDefinitions({ limit = 40 }: { limit?: number } = {}): Promise<ConnectorsToolDefinition[]> {
    const { items } = await this.tools({ limit })
    return items.map((t) => ({
      type: 'function',
      function: {
        name: `connectors_${String(t.name).replace(/[^a-zA-Z0-9_]/g, '_')}`,
        description: `[${t.toolkit || 'Connectors'}] ${t.description || t.name}`,
        parameters: Object.keys(t.parameters).length ? t.parameters : { type: 'object', properties: {} }
      }
    }))
  }
}
