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

export const BUILTIN_CONNECTOR_TOOLKITS: ToolkitRecord[] = [
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Manage repositories, track issues, automate pull requests, review diffs, and inspect release assets.',
    categories: ['Development', 'Version Control'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'API_KEY'],
    tools: 38
  },
  {
    slug: 'slack',
    name: 'Slack',
    description: 'Send channel alerts, post executive summaries, read team threads, and upload artifacts to workspaces.',
    categories: ['Communication', 'Chat'],
    noAuth: false,
    authSchemes: ['OAUTH2'],
    tools: 26
  },
  {
    slug: 'googleworkspace',
    name: 'Google Workspace',
    description: 'Create Google Docs, edit Sheets spreadsheets, search Drive files, compose Gmail, and schedule Calendar events.',
    categories: ['Productivity', 'Office'],
    noAuth: false,
    authSchemes: ['OAUTH2'],
    tools: 42
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Track engineering cycles, create priority tickets, update sprint roadmaps, and triage project bugs.',
    categories: ['Project Management', 'Development'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'API_KEY'],
    tools: 24
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Query knowledge bases, write formatted documentation pages, update structured databases, and sync properties.',
    categories: ['Knowledge Base', 'Productivity'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'API_KEY'],
    tools: 19
  },
  {
    slug: 'jira',
    name: 'Jira Software',
    description: 'Enterprise agile project tracking, backlog grooming, workflow transitions, and bug triage.',
    categories: ['Project Management', 'Enterprise'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'BASIC_AUTH'],
    tools: 32
  },
  {
    slug: 'discord',
    name: 'Discord',
    description: 'Broadcast notifications to community servers, manage channel topics, send rich embeds, and ping roles.',
    categories: ['Communication', 'Community'],
    noAuth: false,
    authSchemes: ['BOT_TOKEN', 'OAUTH2'],
    tools: 18
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Query customer records, generate invoices, inspect subscription statuses, and verify payment transactions.',
    categories: ['Finance', 'Payments'],
    noAuth: false,
    authSchemes: ['API_KEY'],
    tools: 28
  },
  {
    slug: 'salesforce',
    name: 'Salesforce CRM',
    description: 'Enterprise customer relationship management, sales pipeline tracking, lead scoring, and account analytics.',
    categories: ['CRM', 'Enterprise'],
    noAuth: false,
    authSchemes: ['OAUTH2'],
    tools: 35
  },
  {
    slug: 'erpnext',
    name: 'ERPNext & Frappe',
    description: 'Open-source enterprise resource planning: manage accounting ledgers, inventory stock, invoices, and HR payroll.',
    categories: ['ERP', 'Business Operations'],
    noAuth: false,
    authSchemes: ['API_KEY', 'BASIC_AUTH'],
    tools: 22
  },
  {
    slug: 'figma',
    name: 'Figma',
    description: 'Extract UI design frames, inspect token values, export vector assets, and post design review comments.',
    categories: ['Design', 'Collaboration'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'ACCESS_TOKEN'],
    tools: 15
  },
  {
    slug: 'trello',
    name: 'Trello',
    description: 'Organize kanban boards, move workflow cards, assign team members, and manage checklist tasks.',
    categories: ['Project Management', 'Productivity'],
    noAuth: false,
    authSchemes: ['OAUTH1', 'API_KEY'],
    tools: 17
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'Inbound marketing analytics, customer contact management, deals pipeline, and automated email campaigns.',
    categories: ['CRM', 'Marketing'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'API_KEY'],
    tools: 30
  },
  {
    slug: 'gitlab',
    name: 'GitLab',
    description: 'CI/CD pipeline triggers, merge request automation, container registry inspection, and code repos.',
    categories: ['Development', 'DevOps'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'ACCESS_TOKEN'],
    tools: 25
  },
  {
    slug: 'clickup',
    name: 'ClickUp',
    description: 'Unified task hierarchy, sprints management, custom fields, time tracking, and team dashboards.',
    categories: ['Project Management', 'Productivity'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'API_KEY'],
    tools: 21
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    description: 'Relational cloud databases, formula fields, view filtering, record creation, and webhook integrations.',
    categories: ['Database', 'Productivity'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'API_KEY'],
    tools: 16
  },
  {
    slug: 'twitter',
    name: 'X (Twitter)',
    description: 'Publish executive updates, monitor brand mentions, search public threads, and analyze engagement metrics.',
    categories: ['Social Media', 'Marketing'],
    noAuth: false,
    authSchemes: ['OAUTH2'],
    tools: 12
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Customer support ticketing, SLA tracking, macro triggers, and resolution analytics.',
    categories: ['Support', 'Customer Service'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'API_KEY'],
    tools: 20
  },
  {
    slug: 'zoom',
    name: 'Zoom',
    description: 'Create scheduled video conferences, retrieve cloud transcripts, inspect attendee rosters, and download recordings.',
    categories: ['Communication', 'Video'],
    noAuth: false,
    authSchemes: ['OAUTH2'],
    tools: 14
  },
  {
    slug: 'asana',
    name: 'Asana',
    description: 'Portfolio goal alignment, task dependencies, milestone tracking, and cross-departmental roadmaps.',
    categories: ['Project Management', 'Productivity'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'ACCESS_TOKEN'],
    tools: 22
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'PostgreSQL database administration, SQL execution, row-level security, auth users, and bucket storage.',
    categories: ['Database', 'Backend'],
    noAuth: false,
    authSchemes: ['API_KEY'],
    tools: 24
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    description: 'Application error monitoring, performance trace inspection, release health, and crash alert triage.',
    categories: ['Monitoring', 'DevOps'],
    noAuth: false,
    authSchemes: ['ACCESS_TOKEN'],
    tools: 18
  },
  {
    slug: 'posthog',
    name: 'PostHog',
    description: 'Product analytics, feature flags toggle, session recordings, and cohort user funnel tracking.',
    categories: ['Analytics', 'Product'],
    noAuth: false,
    authSchemes: ['API_KEY'],
    tools: 16
  },
  {
    slug: 'shopify',
    name: 'Shopify',
    description: 'E-commerce store catalog, inventory stock adjustments, order fulfillment, and checkout insights.',
    categories: ['E-Commerce', 'Retail'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'ACCESS_TOKEN'],
    tools: 27
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    description: 'Live customer chat, help center article publishing, inbound lead routing, and outbound product tours.',
    categories: ['Support', 'CRM'],
    noAuth: false,
    authSchemes: ['OAUTH2', 'ACCESS_TOKEN'],
    tools: 19
  },
  {
    slug: 'vercel',
    name: 'Vercel',
    description: 'Inspect preview deployments, promote production builds, configure domain DNS, and audit edge logs.',
    categories: ['Cloud Hosting', 'DevOps'],
    noAuth: false,
    authSchemes: ['ACCESS_TOKEN'],
    tools: 18
  },
  {
    slug: 'aws',
    name: 'Amazon Web Services',
    description: 'Query S3 cloud buckets, trigger Lambda serverless jobs, monitor CloudWatch logs, and inspect EC2 instances.',
    categories: ['Cloud Infrastructure', 'DevOps'],
    noAuth: false,
    authSchemes: ['AWS_IAM'],
    tools: 45
  },
  {
    slug: 'docker',
    name: 'Docker Engine',
    description: 'Manage local and remote container lifecycles, inspect image manifests, tail stdout logs, and compose networks.',
    categories: ['Containers', 'DevOps'],
    noAuth: true,
    authSchemes: ['NONE'],
    tools: 15
  },
  {
    slug: 'kubernetes',
    name: 'Kubernetes Cluster',
    description: 'Inspect pod statuses, roll out deployment updates, tail container logs, and query namespace resources.',
    categories: ['Orchestration', 'DevOps'],
    noAuth: false,
    authSchemes: ['KUBECONFIG', 'BEARER_TOKEN'],
    tools: 28
  },
  {
    slug: 'postgres',
    name: 'PostgreSQL Direct',
    description: 'Run parameterized queries, inspect schemas, generate migration plans, and benchmark query performance.',
    categories: ['Database', 'Data Storage'],
    noAuth: false,
    authSchemes: ['CONNECTION_URI'],
    tools: 12
  },
  {
    slug: 'msteams',
    name: 'Microsoft Teams',
    description: 'Post team cards, message channels, create meeting invites, and integrate with Office 365 groups.',
    categories: ['Communication', 'Enterprise'],
    noAuth: false,
    authSchemes: ['OAUTH2'],
    tools: 20
  },
  {
    slug: 'pagerduty',
    name: 'PagerDuty',
    description: 'Incident escalation policies, on-call schedules, emergency incident response, and resolution tracking.',
    categories: ['Operations', 'Monitoring'],
    noAuth: false,
    authSchemes: ['API_KEY'],
    tools: 16
  }
]

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
    ? categoriesValue.map((c) => text(c)).filter(Boolean)
    : []
  const authSchemesValue = item.auth_schemes ?? meta.auth_schemes
  const authSchemes = Array.isArray(authSchemesValue)
    ? authSchemesValue.map((s) => text(s).toUpperCase()).filter(Boolean)
    : []
  return {
    slug: toolkitSlug(item),
    name: text(item.name) || text(item.title) || toolkitSlug(item) || 'Toolkit',
    description: text(item.description) || text(meta.description),
    categories,
    logo: text(item.logo) || text(meta.logo) || undefined,
    noAuth: Boolean(item.no_auth ?? meta.no_auth),
    authSchemes,
    tools: count(item.total_tools ?? item.tools_count ?? meta.total_tools)
  }
}

function parseAuthConfig(item: JsonRecord): AuthConfigRecord {
  return {
    id: text(item.id),
    toolkit: toolkitSlug(item),
    scheme: text(item.auth_scheme).toUpperCase()
  }
}

function parseAccount(item: JsonRecord): AccountRecord {
  return {
    id: text(item.id),
    toolkit: toolkitSlug(item),
    status: statusOf(item.status),
    authConfigId: text(item.auth_config_id) || undefined,
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

    const config = store.getConnectorsConfig()
    const map = new Map<string, ToolkitRecord>()
    for (const item of BUILTIN_CONNECTOR_TOOLKITS) {
      map.set(item.slug, item)
    }

    if (config.apiKey) {
      try {
        const json = await this.request('/toolkits', {
          query: { limit: 200, sort_by: 'usage' }
        })
        for (const item of listFrom(json).map(parseToolkit).filter((i) => Boolean(i.slug))) {
          map.set(item.slug, item)
        }
      } catch {
        // Fall back to built-in items
      }
    }

    const items = Array.from(map.values())
    this.toolkitCache = { at: Date.now(), value: items }
    return items
  }

  private async listAuthConfigs(force: boolean): Promise<Map<string, AuthConfigRecord>> {
    if (!force && this.authCache && Date.now() - this.authCache.at < CACHE_MS) {
      return this.authCache.value
    }
    const items = new Map<string, AuthConfigRecord>()
    const config = store.getConnectorsConfig()
    if (!config.apiKey) return items

    try {
      const json = await this.request('/auth_configs', { query: { limit: 200 } })
      for (const item of listFrom(json).map(parseAuthConfig)) {
        if (item.id && item.toolkit && !items.has(item.toolkit)) items.set(item.toolkit, item)
      }
    } catch {
      // Offline fallback
    }
    this.authCache = { at: Date.now(), value: items }
    return items
  }

  private async listAccounts(force: boolean): Promise<Map<string, AccountRecord>> {
    if (!force && this.accountCache && Date.now() - this.accountCache.at < CACHE_MS) {
      return this.accountCache.value
    }
    const items = new Map<string, AccountRecord>()
    const config = store.getConnectorsConfig()
    if (!config.apiKey) return items

    try {
      const userId = config.userId
      const json = await this.request('/connected_accounts', {
        query: { limit: 200, user_ids: userId }
      })
      for (const item of listFrom(json).map(parseAccount)) {
        if (!item.id || !item.toolkit) continue
        const existing = items.get(item.toolkit)
        if (!existing || (isActive(item.status) && !isActive(existing.status))) {
          items.set(item.toolkit, item)
        }
      }
    } catch {
      // Offline fallback
    }
    this.accountCache = { at: Date.now(), value: items }
    return items
  }

  private async toolkitTools(slug: string): Promise<MarketTool[]> {
    const cached = this.toolCache.get(slug)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

    const config = store.getConnectorsConfig()
    if (config.apiKey) {
      try {
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
      } catch {
        // Fall back to sample tools
      }
    }

    // Default rich sample tools for offline display
    const sampleItems: MarketTool[] = [
      {
        slug: `${slug}_query`,
        name: `${slug.toUpperCase()} Query & Search`,
        description: `Execute search, filtering, and data extraction on ${slug}.`,
        toolkit: slug,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or query expression' },
            limit: { type: 'number', description: 'Max items to retrieve' }
          },
          required: ['query']
        }
      },
      {
        slug: `${slug}_manage`,
        name: `${slug.toUpperCase()} Resource Mutator`,
        description: `Create, update, or transition records and states in ${slug}.`,
        toolkit: slug,
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Action command e.g. create, update, delete' },
            payload: { type: 'object', description: 'Record data' }
          },
          required: ['action']
        }
      }
    ]
    this.toolCache.set(slug, { at: Date.now(), value: sampleItems })
    return sampleItems
  }

  async getState(force = false): Promise<ConnectorsState> {
    const config = store.getConnectorsConfig()
    const userId = config.userId
    const hasKey = Boolean(config.apiKey)

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

        if (isEnabled && (active || noAuth || !hasKey) && fetched < MAX_ENABLED_TOOLKITS) {
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
            // Keep connection state visible instead of failing the whole page.
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
          authScheme: authConfig?.scheme ?? toolkit.authSchemes[0],
          connectionStatus: active ? 'connected' : pending ? 'pending' : noAuth ? 'no_auth' : 'not_connected',
          connectedAccountId: account?.id,
          authConfigId: authConfig?.id,
          connectable: !noAuth
        })
      }

      return {
        configured: hasKey,
        enabled: config.enabled,
        userId,
        toolkits: toolkitInfos,
        tools
      }
    } catch {
      // In case of any parsing exception, return built-in toolkits
      const fallbackToolkits: ConnectorsToolkitInfo[] = BUILTIN_CONNECTOR_TOOLKITS.map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
        categories: t.categories,
        logo: t.logo,
        connected: t.noAuth,
        tools: t.tools,
        enabled: config.toolkits.includes(t.slug),
        authScheme: t.authSchemes[0],
        connectionStatus: t.noAuth ? 'no_auth' : 'not_connected',
        connectable: !t.noAuth
      }))
      return {
        configured: hasKey,
        enabled: config.enabled,
        userId,
        toolkits: fallbackToolkits,
        tools: []
      }
    }
  }

  async save(patch: { apiKey?: string; enabled?: boolean; toolkits?: string[] }): Promise<ConnectorsState> {
    const current = store.getConnectorsConfig()
    const apiKey = patch.apiKey !== undefined ? patch.apiKey.trim() : current.apiKey
    const enabled = patch.enabled !== undefined ? patch.enabled : current.enabled
    const toolkits =
      patch.toolkits !== undefined
        ? Array.from(new Set(patch.toolkits)).slice(0, MAX_ENABLED_TOOLKITS)
        : current.toolkits
    await store.saveConnectors({ apiKey, enabled, toolkits })
    this.invalidate()
    return this.getState(true)
  }

  async connect(slug: string): Promise<ConnectorsConnectResult> {
    const config = store.getConnectorsConfig()
    if (!config.apiKey) {
      // If user hasn't put in an API key yet, add to enabled toolkits in local mode
      const updated = Array.from(new Set([...config.toolkits, slug]))
      await store.saveConnectors({ toolkits: updated })
      return {
        status: 'active',
        redirectUrl: '',
        message: `${slug.toUpperCase()} enabled in offline sandbox mode.`
      }
    }

    const toolkits = await this.listToolkits(false)
    const toolkit = toolkits.find((item) => item.slug === slug)
    if (!toolkit) throw new Error(`Toolkit "${slug}" not found.`)
    if (toolkit.noAuth) {
      if (!config.toolkits.includes(slug)) {
        await store.saveConnectors({
          toolkits: [...config.toolkits, slug].slice(0, MAX_ENABLED_TOOLKITS)
        })
      }
      return { status: 'active', redirectUrl: '' }
    }

    const authConfigs = await this.listAuthConfigs(false)
    const authConfig = authConfigs.get(slug)
    const scheme = authConfig?.scheme ?? toolkit.authSchemes[0]
    const json = (await this.request('/connected_accounts', {
      method: 'POST',
      body: {
        user_id: config.userId,
        toolkit: slug,
        auth_scheme: scheme,
        ...(authConfig?.id ? { auth_config_id: authConfig.id } : {})
      }
    })) as { redirect_url?: string; redirectUrl?: string; id?: string; status?: string }

    const redirectUrl = text(json.redirect_url) || text(json.redirectUrl)
    if (!config.toolkits.includes(slug)) {
      await store.saveConnectors({
        toolkits: [...config.toolkits, slug].slice(0, MAX_ENABLED_TOOLKITS)
      })
    }
    this.invalidate()
    return {
      status: isPending(text(json.status)) ? 'pending' : 'active',
      redirectUrl: redirectUrl || '',
      connectedAccountId: text(json.id) || undefined
    }
  }

  async disconnect(slug: string): Promise<ConnectorsState> {
    if (!slug) throw new Error('Choose a toolkit first.')
    const accounts = await this.listAccounts(true)
    const account = accounts.get(slug)
    if (account?.id) {
      await this.request(`/connected_accounts/${encodeURIComponent(account.id)}`, {
        method: 'DELETE'
      }).catch(() => undefined)
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
    if (!config.enabled || !config.toolkits.length) return []
    const [toolkits, accounts] = await Promise.all([
      this.listToolkits(false).catch(() => [] as ToolkitRecord[]),
      this.listAccounts(false).catch(() => new Map<string, AccountRecord>())
    ])
    const bySlug = new Map(toolkits.map((toolkit) => [toolkit.slug, toolkit]))
    const tools: AgentTool[] = []
    const hasKey = Boolean(config.apiKey)

    for (const slug of config.toolkits.slice(0, MAX_ENABLED_TOOLKITS)) {
      const toolkit = bySlug.get(slug)
      const account = accounts.get(slug)
      const active = isActive(account?.status ?? '')
      const noAuth = toolkit?.noAuth ?? false
      if (hasKey && !active && !noAuth) continue

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
            if (hasKey) {
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
                  content: `Connector tool error: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  isError: true
                }
              }
            } else {
              // Simulated sandbox output
              return {
                content: JSON.stringify({
                  success: true,
                  connector: slug,
                  tool: tool.slug,
                  arguments: args,
                  status: 'simulated_success',
                  result: `Executed ${tool.name} with provided parameters.`
                }, null, 2),
                isError: false
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
