import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Computer } from './computer'
import { Connectors } from './connectors'
import { SkillRegistry, ExternalAgent } from './external-agent'
import { Marketplace } from './marketplace'
import { McpManager } from './mcp'
import { Memory } from './memory'
import { SubscriptionAccount, WorkAccount, workToolSpecs, makeWorkRunner } from './work'
import { GroundedActions } from './grounded'
import { Provider, availableProviders, resolveConfig, DEFAULT_TIER_CONFIG, type ProviderSettings, type TierConfig } from './provider'
import { AgentRunner, BUILTIN_ROLES } from './runner'
import { GatewayToken, PermissionBroker, SecretStore } from './security'
import { BackendStore } from './store'
import { Usage } from './usage'
import type { ToolPermissions } from './tools'
import { backendRoot, backendWorkspace } from './paths'

export { BUILTIN_ROLES }

export interface BackendAccount {
  name: string
  email: string
  role: string
  planName: string
  planCredits: number
  addOnCredits: number
  creditBudget: number
  [key: string]: unknown
}

export interface UiTarsSettings {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  language: string
  temperature: number
  maxTokens: number
  maxSteps: number
}

export interface BackendSettings extends ProviderSettings {
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  temperature: number
  maxOutputTokens: number
  maxIterations: number
  sandbox: boolean
  memoryEnabled: boolean
  permissions: ToolPermissions
  skills: unknown[]
  workspace: string | null
  tier: string
  tierConfig: Record<string, Partial<TierConfig>>
  appIcon: string
  permissionMode: string
  computerUse: boolean
  avatar: string
  groundedActions: UiTarsSettings
  mode: string
  account: BackendAccount
  extraHeaders?: Record<string, string>
}

export interface WorkMode {
  id: string
  label: string
  greeting: string
  accent: string
  accentSoft: string
  accentText: string
  doodle: string
  extras: string[]
}

export const WORK_MODES: Record<string, WorkMode> = {
  coding: {
    id: 'coding',
    label: 'Coding',
    greeting: 'Beyond Coding',
    accent: '#5cb870',
    accentSoft: '#1a2e21',
    accentText: '#8fe6b0',
    doodle: 'moon',
    extras: ['knowledge', 'sites', 'automations', 'extensions']
  },
  general: {
    id: 'general',
    label: 'General',
    greeting: 'Beyond Building',
    accent: '#e0c65c',
    accentSoft: '#3a331a',
    accentText: '#f0da78',
    doodle: 'spark',
    extras: ['knowledge', 'sites', 'automations', 'extensions']
  }
}

const DEFAULT_ACCOUNT: BackendAccount = {
  name: 'Wizard',
  email: 'knight@local',
  role: 'Full-stack developer · Frontend…',
  planName: 'Free',
  planCredits: 0,
  addOnCredits: 0,
  creditBudget: 0
}

const DEFAULT_SYSTEM_PROMPT = [
  'You are The Captain, the one agent the user talks to inside Knight Cowork.',
  'Be concrete and concise. Prefer reading real files over guessing.',
  'Use the available tools to verify facts, then finish with a clear report.'
].join(' ')

const DEFAULT_PERMISSIONS: ToolPermissions = {
  read_file: 'allow',
  list_dir: 'allow',
  search: 'allow',
  write_file: 'allow',
  run_command: 'ask',
  finish: 'allow'
}

export interface BackendEvents {
  (event: string, payload: unknown): void
}

const COPILOT_URL = 'https://api.githubcopilot.com'

/**
 * The merged backend.
 *
 * Seamoon's services now live inside Knight Cowork: the multi-provider client
 * with failover, the Moonwright agent core, the Moon Gateway, the skill
 * marketplaces, MCP, Connectors, Work Files, computer use, Grounded Actions, memory,
 * usage and the appearance themes. Knight's task store, table service and
 * renderer sit on top of this.
 */
export class Backend {
  readonly root: string
  readonly store: BackendStore
  settings: BackendSettings
  readonly provider: Provider
  readonly memory: Memory
  readonly usage: Usage
  readonly mcp: McpManager
  readonly connectors: Connectors
  readonly subscription: SubscriptionAccount
  readonly work: WorkAccount
  readonly computer: Computer
  readonly uitars: GroundedActions
  readonly marketplace: Marketplace
  readonly clawhub: SkillRegistry
  readonly externalAgent: ExternalAgent
  readonly secrets: SecretStore
  readonly gatewayToken: GatewayToken
  readonly permissions: PermissionBroker
  workspace: string
  gateway: MoonGatewayLike | null = null
  runner!: AgentRunner
  /** Set by the IPC layer; routes backend events to the renderer. */
  emitter: BackendEvents = () => {}
  /** Short-lived cache for the slow registry lookups. */
  readonly cache = new Map<string, { at: number; value: unknown }>()

  constructor() {
    this.root = backendRoot()
    this.store = new BackendStore(this.root)
    this.settings = this.loadSettings()
    this.provider = new Provider(this.settings)
    this.provider.onAttempt = (cfg) =>
      this.emitter('provider:attempt', {
        providerId: cfg.providerId,
        model: cfg.model,
        baseUrl: cfg.baseUrl
      })
    this.memory = new Memory(this.store)
    this.usage = new Usage(this.store)
    this.mcp = new McpManager(this.store)
    this.connectors = new Connectors(this.store)
    // Secrets live encrypted with the OS keychain, never in the plain settings file.
    this.secrets = new SecretStore(join(this.root, 'secrets.json'))
    this.subscription = new SubscriptionAccount(this.store, this.secrets)
    this.work = new WorkAccount(this.store)
    this.computer = new Computer({
      enabled: this.settings.computerUse,
      emit: (evt, payload) => this.emitter(evt, payload)
    })
    this.uitars = new GroundedActions({
      settings: this.settings,
      emit: (evt, payload) => this.emitter(evt, payload)
    })
    this.workspace = this.settings.workspace || backendWorkspace()
    mkdirSync(this.workspace, { recursive: true })
    this.marketplace = new Marketplace(this.store, this.workspace)
    this.clawhub = new SkillRegistry(this.store, this.workspace)
    this.externalAgent = new ExternalAgent(this.store, this.workspace)

    this.gatewayToken = new GatewayToken(this.secrets)
    this.permissions = new PermissionBroker({
      emit: (evt, payload) => this.emitter(evt, payload)
    })
    this.restoreSecrets()
    this.buildRunner()
  }

  private buildRunner(): void {
    this.runner = new AgentRunner({
      provider: this.provider,
      store: this.store,
      emit: (evt, payload) => this.emitter(evt, payload),
      settings: this.settings,
      workspace: this.workspace,
      integrations: {
        marketplace: this.marketplace,
        connectors: this.connectors,
        computer: this.computer,
        mcp: this.mcp,
        uitars: this.uitars,
        permissions: this.permissions,
        work: {
          connected: () => this.work.connected(),
          tools: () => workToolSpecs(),
          run: makeWorkRunner(this.work)
        }
      }
    })
  }

  loadSettings(): BackendSettings {
    const saved = this.store.settings.all() as Record<string, unknown>
    const resolved = resolveConfig(saved as ProviderSettings)
    const base: BackendSettings = {
      providerId: (saved.providerId as string) ?? resolved.providerId,
      baseUrl: (saved.baseUrl as string) ?? '',
      apiKey: (saved.apiKey as string) ?? '',
      model: (saved.model as string) ?? resolved.model ?? '',
      systemPrompt: (saved.systemPrompt as string) ?? DEFAULT_SYSTEM_PROMPT,
      temperature: (saved.temperature as number) ?? 0.2,
      maxOutputTokens: (saved.maxOutputTokens as number) ?? 4096,
      maxIterations: (saved.maxIterations as number) ?? 12,
      sandbox: (saved.sandbox as boolean) ?? true,
      memoryEnabled: (saved.memoryEnabled as boolean) ?? true,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        ...((saved.permissions as ToolPermissions) || {})
      },
      skills: (saved.skills as unknown[]) ?? [],
      workspace: (saved.workspace as string) ?? null,
      tier: (saved.tier as string) ?? 'auto',
      tierConfig: { ...DEFAULT_TIER_CONFIG, ...((saved.tierConfig as Record<string, Partial<TierConfig>>) || {}) },
      appIcon: (saved.appIcon as string) ?? 'moon',
      permissionMode: (saved.permissionMode as string) ?? 'full-access',
      computerUse: (saved.computerUse as boolean) ?? false,
      avatar: (saved.avatar as string) ?? 'initial',
      groundedActions: {
        enabled: (saved.groundedActions as UiTarsSettings | undefined)?.enabled ?? false,
        baseUrl: (saved.groundedActions as UiTarsSettings | undefined)?.baseUrl ?? '',
        apiKey: (saved.groundedActions as UiTarsSettings | undefined)?.apiKey ?? '',
        model: (saved.groundedActions as UiTarsSettings | undefined)?.model ?? '',
        language: (saved.groundedActions as UiTarsSettings | undefined)?.language ?? 'en',
        temperature: (saved.groundedActions as UiTarsSettings | undefined)?.temperature ?? 0,
        maxTokens: (saved.groundedActions as UiTarsSettings | undefined)?.maxTokens ?? 512,
        maxSteps: (saved.groundedActions as UiTarsSettings | undefined)?.maxSteps ?? 12
      },
      mode: (saved.mode as string) ?? 'coding',
      account: {
        ...DEFAULT_ACCOUNT,
        ...((saved.account as BackendAccount) || {})
      }
    }
    return this.applySubscriptionAccount(base)
  }

  persistSettings(patch: Partial<BackendSettings>): BackendSettings {
    const next: BackendSettings = { ...this.settings, ...patch }
    next.permissions = { ...this.settings.permissions, ...(patch.permissions || {}) }
    for (const key of ['apiKey', 'connectorsApiKey', 'subscriptionToken'] as const) {
      const value = (patch as Record<string, unknown>)[key]
      if (value !== undefined) {
        this.writeSecret(key, String(value))
        delete (next as Record<string, unknown>)[key]
      }
    }
    this.settings = this.applySubscriptionAccount(next)
    this.store.settings.set('settings', this.settings as unknown as Record<string, unknown>)
    this.provider.settings = this.settings
    this.runner.settings = this.settings
    this.computer?.setEnabled(this.settings.computerUse)
    if (patch.workspace) {
      this.workspace = patch.workspace
      mkdirSync(this.workspace, { recursive: true })
      this.runner.workspace = this.workspace
    }
    return this.settings
  }

  /**
   * The SubscriptionAccount provider is configured from the user's own GitHub token, so the
   * key and the integration headers are refreshed whenever settings change.
   * Switching away from SubscriptionAccount also clears the URL it installed, otherwise the
   * next provider would be called against the SubscriptionAccount endpoint.
   */
  applySubscriptionAccount(settings: BackendSettings): BackendSettings {
    if (settings.providerId !== 'subscription') {
      if (settings.baseUrl === COPILOT_URL) {
        const { baseUrl: _baseUrl, apiKey: _apiKey, extraHeaders: _headers, ...rest } = settings
        return rest as BackendSettings
      }
      return settings
    }
    const token = this.subscription?.token?.()
    if (!token) return settings
    return {
      ...settings,
      baseUrl: COPILOT_URL,
      apiKey: token,
      extraHeaders: { 'Copilot-Integration-Id': 'knight', 'Editor-Version': 'vscode/1.95.0' }
    }
  }

  /**
   * Starts the native Moon Gateway: a local HTTP surface that receives
   * messages from channels, routes them to an agent, runs the turn through
   * Moonwright and sends the reply back out.
   */
  async startGateway(): Promise<{ url: string; port: number }> {
    if (this.gateway) return this.gateway.address()
    const { MoonGateway } = await import('./gateway/index')
    const gateway = new MoonGateway({
      storeFile: join(this.root, 'gateway', 'state.json'),
      token: this.gatewayToken.ensure(),
      onDenied: (reason: string) => this.emitter('gateway:denied', { reason }),
      runTurn: async ({ agentId, sessionKey, text, history }) => {
        const result = await this.runner.run({
          session: { id: sessionKey, title: text.slice(0, 60) },
          agentId,
          userMessage: text,
          opts: { isolate: false, history: history as never }
        })
        return result.text || ''
      }
    })
    gateway.emitter = (event: string, payload: unknown) => this.emitter(event, payload)
    this.gateway = gateway as unknown as MoonGatewayLike
    return gateway.start()
  }

  /** Move the secret settings out of the plain file and into the keychain. */
  restoreSecrets(): void {
    const saved = this.store.settings.all() as Record<string, unknown>
    for (const key of ['apiKey', 'connectorsApiKey', 'subscriptionToken']) {
      const value = saved[key]
      if (typeof value === 'string' && value) {
        this.secrets.put(key, value)
        delete saved[key]
        this.store.settings.set('settings', saved)
      }
    }
    const key = this.secrets.get('apiKey')
    if (key) this.settings.apiKey = key
  }

  /** Write the secret settings to the keychain rather than the settings file. */
  writeSecret(key: string, value: string): void {
    this.secrets.put(key, value)
    const saved = { ...(this.store.settings.all() as Record<string, unknown>) }
    delete saved[key]
    this.store.settings.set('settings', saved)
    if (key === 'apiKey') this.settings.apiKey = value
    if (key === 'connectorsApiKey') this.settings.connectorsApiKey = value
    if (key === 'subscriptionToken') this.settings.subscriptionToken = value
  }

  /** The settings as the renderer may see them: no secrets, only what is safe. */
  publicSettings(): Record<string, unknown> {
    const { apiKey: _apiKey, baseUrl, ...rest } = this.settings
    const resolved = resolveConfig(this.settings)
    return {
      ...rest,
      baseUrl: baseUrl || resolved.baseUrl,
      autoBaseUrl: !baseUrl,
      providerId: resolved.providerId,
      apiKey: resolved.apiKey ? `${resolved.apiKey.slice(0, 6)}••••${resolved.apiKey.slice(-4)}` : '',
      hasApiKey: Boolean(resolved.apiKey),
      resolvedModel: resolved.model,
      providers: availableProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        defaultModel: provider.defaultModel,
        available: provider.available,
        keyEnv: provider.keyEnv
      }))
    }
  }

  /** The token and credit balance the credits popover reads. */
  creditsSummary(): Record<string, unknown> {
    const used = this.store.usage.all().reduce((total, bucket) => total + (bucket.total || 0), 0)
    const creditsUsed = Math.round(used / 1000)
    const account = this.settings.account || {}
    const planTotal = Math.max(0, account.planCredits || 0)
    const addonTotal = Math.max(0, account.addOnCredits || 0)
    // the plan allowance is consumed first, then add-on credits
    const planUsed = Math.min(creditsUsed, planTotal)
    const addonUsed = Math.min(Math.max(0, creditsUsed - planUsed), addonTotal)
    return {
      plan: { used: planUsed, total: planTotal, remaining: Math.max(0, planTotal - planUsed) },
      addon: { used: addonUsed, total: addonTotal, remaining: Math.max(0, addonTotal - addonUsed) },
      tokens: used,
      planName: account.planName || 'Free'
    }
  }
}

/** The slice of the Moon Gateway the backend facade needs. */
export interface MoonGatewayLike {
  address(): { url: string; port: number }
  start(): Promise<{ url: string; port: number }>
  stop(): Promise<void>
  agents(): unknown[]
  bindings(): unknown[]
  sessions(): unknown[]
  automations(): unknown[]
  channelStatus(): Promise<unknown>
  upsertAgent(agent: unknown): unknown
  removeAgent(id: string): unknown
  upsertBinding(binding: unknown): unknown
  removeBinding(id: string): unknown
  upsertAutomation(job: unknown): unknown
  removeAutomation(id: string): unknown
  handleInbound(message: unknown): unknown
  store: { removeSession(key: string): unknown }
  emitter: (event: string, payload: unknown) => void
}

let instance: Backend | null = null

export function getBackend(): Backend {
  if (!instance) instance = new Backend()
  return instance
}
