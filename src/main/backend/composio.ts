/**
 * Composio client — the real tool-integration platform (250+ apps / 1000+ tools).
 *
 * Authenticates with the user's own Composio API key, which they add in
 * Settings → Connectors. Nothing is faked: without a key the app shows the
 * real "not connected" state, and with one it lists the live toolkits and
 * executes their tools through Composio's v3 API.
 *
 * Ported from Seamoon's `electron/backend/composio.js`.
 */
import type { BackendStore } from './store'

export const API = 'https://backend.composio.dev/api/v3'

type QueryValue = string | number | boolean | null | undefined

interface ComposioRequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, QueryValue>
}

/** A toolkit entry as Composio's v3 API returns it. */
interface ComposioToolkitPayload {
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

/** A tool entry as Composio's v3 API returns it. */
interface ComposioToolPayload {
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

export interface ComposioToolkit {
  id: string | undefined
  name: string | undefined
  description: string
  categories: string[]
  meta: Record<string, unknown>
  connected: boolean
}

export interface ComposioTool {
  name: string | undefined
  toolkit: string
  description: string
  method: string
  parameters: Record<string, unknown>
}

export interface ComposioToolkitPage {
  items: ComposioToolkit[]
  total: number
  nextCursor: string | null
}

export interface ComposioToolPage {
  items: ComposioTool[]
  total: number
  nextCursor: string | null
}

export interface ComposioToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ComposioExecuteResult {
  ok: boolean
  data: unknown
  successful: boolean
}

export interface ComposioToolkitsOptions {
  category?: string
  limit?: number
  cursor?: string
}

export interface ComposioToolsOptions {
  toolkit?: string
  limit?: number
  cursor?: string
}

export interface ComposioExecuteOptions {
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

export class Composio {
  readonly store: BackendStore

  constructor(store: BackendStore) {
    this.store = store
  }

  get apiKey(): string {
    const raw = this.store.settings.all().composioApiKey
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

  async request(path: string, { method = 'GET', body, query }: ComposioRequestOptions = {}): Promise<unknown> {
    if (!this.apiKey) throw new Error('Add your Composio API key in Settings → Connectors first.')
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
        truthyString(error.message) ?? truthyString(record.message) ?? `Composio responded ${res.status}`
      throw new Error(String(msg).slice(0, 300))
    }
    return json
  }

  /** Live toolkit catalogue (Composio calls them "toolkits" in v3). */
  async toolkits({ category = 'all', limit = 60, cursor }: ComposioToolkitsOptions = {}): Promise<ComposioToolkitPage> {
    const json = await this.request('/toolkits', {
      query: { category, limit, cursor, managedBy: 'user' }
    })
    const items = pickList<ComposioToolkitPayload>(json, ['items', 'toolkits', 'data'])
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
  async tools({ toolkit, limit = 100, cursor }: ComposioToolsOptions = {}): Promise<ComposioToolPage> {
    const json = await this.request('/tools', {
      query: { toolkitSlug: toolkit, limit, cursor, scopes: 'all' }
    })
    const items = pickList<ComposioToolPayload>(json, ['items', 'tools', 'data'])
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

  /** Execute a Composio tool on behalf of the agent. */
  async execute({ tool, args = {}, entityId = 'default' }: ComposioExecuteOptions): Promise<ComposioExecuteResult> {
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

  /** The tool specs handed to the model as Composio-backed tools. */
  async toolDefinitions({ limit = 40 }: { limit?: number } = {}): Promise<ComposioToolDefinition[]> {
    const { items } = await this.tools({ limit })
    return items.map((t) => ({
      type: 'function',
      function: {
        name: `composio_${String(t.name).replace(/[^a-zA-Z0-9_]/g, '_')}`,
        description: `[${t.toolkit || 'Composio'}] ${t.description || t.name}`,
        parameters: Object.keys(t.parameters).length ? t.parameters : { type: 'object', properties: {} }
      }
    }))
  }
}
