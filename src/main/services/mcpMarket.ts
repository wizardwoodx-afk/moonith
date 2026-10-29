import type {
  McpMarketDetail,
  McpMarketInstallResult,
  McpMarketSearchResult,
  McpServerConfig,
  McpTransport
} from '@shared/types'
import { runNpx } from '../backend/npx'
import { store } from '../store'
import { mcpManager } from './mcp'

const BASE = 'https://market.lobehub.com'
const CLI = '@lobehub/market-cli'
const CACHE_MS = 60_000

interface RawManifest {
  identifier?: string
  name?: string
  description?: string
  author?: string
  version?: string
  icon?: string
  category?: string
  homepage?: string
  tools?: Array<{ name?: string }>
  deploymentOptions?: RawDeployment | RawDeployment[]
}

interface RawDeployment {
  connection?: {
    type?: string
    command?: string
    args?: string[]
    url?: string
    configSchema?: unknown
  }
  description?: string
  installationMethod?: string
  installationDetails?: { packageName?: string } | null
  isRecommended?: boolean
  systemDependencies?: Array<{
    name?: string
    checkCommand?: string
    installInstructions?: Record<string, string>
  }>
}

interface Deployment {
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  description: string
  requiresConfiguration: boolean
  systemDependencies: string[]
}

const searchCache = new Map<string, { at: number; items: McpMarketSearchResult[] }>()

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeId(value: string): string {
  const id = String(value ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(id)) {
    throw new Error('That marketplace server identifier is not valid.')
  }
  return id
}

function parseCliJson(stdout: string): Record<string, unknown> {
  const first = stdout.indexOf('{')
  const last = stdout.lastIndexOf('}')
  if (first === -1 || last <= first) {
    throw new Error('The community marketplace returned a response SelfImpulse could not read.')
  }
  try {
    return JSON.parse(stdout.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    throw new Error('The community marketplace returned malformed JSON.')
  }
}

function transportFrom(type: string): McpTransport | null {
  const value = type.trim().toLowerCase()
  if (!value) return null
  if (value === 'stdio' || value === 'command' || value === 'local') return 'stdio'
  if (value === 'sse' || value.includes('sse')) return 'sse'
  if (value.includes('http') || value === 'remote' || value === 'streamable') return 'http'
  return null
}

function deploymentsFrom(manifest: RawManifest): RawDeployment[] {
  const raw = manifest.deploymentOptions
  if (Array.isArray(raw)) return raw
  return raw ? [raw] : []
}

function chooseDeployment(manifest: RawManifest): Deployment | null {
  const options = deploymentsFrom(manifest)
    .map((option): Deployment | null => {
      const connection = asRecord(option.connection)
      const transport = transportFrom(text(connection.type))
      if (!transport) return null
      const command = text(connection.command)
      const url = text(connection.url)
      if (transport === 'stdio' && !command) return null
      if ((transport === 'http' || transport === 'sse') && !url) return null
      const dep: Deployment = {
        transport,
        args: Array.isArray(connection.args) ? connection.args.map(String) : [],
        description: text(option.description),
        requiresConfiguration: Boolean(connection.configSchema),
        systemDependencies: Array.isArray(option.systemDependencies)
          ? option.systemDependencies
              .map((dependency) => text(dependency.name) || text(dependency.checkCommand))
              .filter(Boolean)
          : []
      }
      if (command) dep.command = command
      if (url) dep.url = url
      return dep
    })
    .filter((option): option is Deployment => option !== null)
  if (!options.length) return null
  return options.find((option) => option.transport === 'stdio') ?? options[0]
}

function searchItem(item: Record<string, unknown>): McpMarketSearchResult {
  const id = text(item.identifier)
  const rawConnection = text(item.connectionType).toLowerCase()
  const connectionType: McpMarketSearchResult['connectionType'] =
    transportFrom(rawConnection) ??
    (item.haveCloudEndpoint === true || /remote|hosted|http/.test(rawConnection) ? 'http' : 'stdio')
  return {
    id,
    name: text(item.name) || id,
    description: text(item.description),
    author: text(item.author),
    version: text(item.version),
    icon: text(item.icon) || undefined,
    category: text(item.category) || undefined,
    installs: num(item.installCount),
    connectionType,
    validated: item.isValidated === true,
    manifestUrl:
      text(item.manifestUrl) ||
      (id ? `${BASE}/api/v1/plugins/${encodeURIComponent(id)}/manifest` : ''),
    siteUrl: id ? `https://lobehub.com/mcp/${encodeURIComponent(id)}` : 'https://lobehub.com/mcp',
    tools: []
  }
}

function detailFrom(id: string, manifest: RawManifest): McpMarketDetail {
  const deployment = chooseDeployment(manifest)
  const tools = Array.isArray(manifest.tools)
    ? manifest.tools.map((tool) => text(tool.name)).filter(Boolean)
    : []
  return {
    id: text(manifest.identifier) || id,
    name: text(manifest.name) || id,
    description: text(manifest.description),
    author: text(manifest.author),
    version: text(manifest.version),
    icon: text(manifest.icon) || undefined,
    category: text(manifest.category) || undefined,
    installs: 0,
    connectionType: deployment?.transport ?? 'other',
    validated: true,
    manifestUrl: `${BASE}/api/v1/plugins/${encodeURIComponent(id)}/manifest`,
    siteUrl: `https://lobehub.com/mcp/${encodeURIComponent(id)}`,
    tools,
    homepage: text(manifest.homepage) || undefined,
    deployment: deployment
      ? {
          transport: deployment.transport,
          command: deployment.command,
          args: deployment.args,
          url: deployment.url
        }
      : null,
    deploymentDescription: deployment?.description,
    systemDependencies: deployment?.systemDependencies ?? []
  }
}

async function fetchManifest(id: string): Promise<{
  detail: McpMarketDetail
  deployment: Deployment | null
}> {
  const ref = safeId(id)
  const response = await fetch(`${BASE}/api/v1/plugins/${encodeURIComponent(ref)}/manifest`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) {
    throw new Error(`The community marketplace responded ${response.status} for “${ref}”.`)
  }
  const manifest = (await response.json()) as RawManifest
  return {
    detail: detailFrom(ref, manifest),
    deployment: chooseDeployment(manifest)
  }
}

class McpMarketService {
  async search(query: string): Promise<McpMarketSearchResult[]> {
    const clean = query
      .trim()
      .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
    const cached = searchCache.get(clean)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.items

    const args = ['mcp', 'search', '--page-size', '60', '--output', 'json']
    if (clean) args.push('--q', clean)
    const result = await runNpx(CLI, args, {
      env: { MARKET_BASE_URL: BASE },
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024
    })
    if (result.error && !result.stdout) {
      throw new Error(String(result.stderr || result.error.message).trim().slice(0, 400))
    }
    const json = parseCliJson(result.stdout)
    const raw = Array.isArray(json.items) ? json.items : []
    const items = raw.map((item) => searchItem(asRecord(item))).filter((item) => Boolean(item.id))
    searchCache.set(clean, { at: Date.now(), items })
    return items
  }

  async read(id: string): Promise<McpMarketDetail | null> {
    const { detail } = await fetchManifest(id)
    return detail
  }

  async install(id: string): Promise<McpMarketInstallResult> {
    const { detail, deployment } = await fetchManifest(id)
    if (!deployment) {
      throw new Error(
        `“${detail.name}” does not publish a deployment SelfImpulse can install. Open the marketplace page for manual setup.`
      )
    }
    const config: McpServerConfig = {
      id: `market_${detail.id.replace(/[^A-Za-z0-9._-]/g, '_')}`,
      name: detail.name,
      transport: deployment.transport,
      command: deployment.command ?? '',
      args: deployment.args ?? [],
      url: deployment.url,
      enabled: true,
      source: 'lobehub',
      sourceUrl: detail.siteUrl
    }
    if (deployment.transport !== 'stdio' && !config.url) {
      throw new Error('This marketplace entry is missing its remote endpoint.')
    }

    const settings = store.getPublicSettings()
    const servers = [...settings.mcpServers]
    const index = servers.findIndex((server) => server.id === config.id)
    const updated = index >= 0
    if (updated) servers[index] = config
    else servers.push(config)
    await store.saveSettings({ mcpServers: servers })
    await mcpManager.connect(config)
    return {
      config,
      statuses: mcpManager.getStatuses(),
      installed: !updated,
      updated
    }
  }
}

export const mcpMarketService = new McpMarketService()
