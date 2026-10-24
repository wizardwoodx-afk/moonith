import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  ChannelInput,
  ChannelRecord,
  ConnectorsInput,
  CreateScheduleInput,
  CreateTaskInput,
  McpServerConfig,
  ProviderInput,
  ProviderKind,
  ProviderPublic,
  PublicSettings,
  ScheduleRecord,
  SettingsPatch,
  Task,
  TaskSummary
} from '@shared/types'
import {
  DEFAULT_GOVERNANCE_SETTINGS,
  normalizeAgentRole,
  normalizeGovernanceSettings,
  type GovernanceSettings
} from '@shared/governance'
import { getPaths, ensureTaskWorkspace, taskWorkspace } from './paths'
import { atomicWriteJson, newId, nowIso, readJson } from './util'

interface StoredProvider {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  models: string[]
  enabled: boolean
  secret?: string
}

interface StoredConnectors {
  enabled: boolean
  toolkits: string[]
  secret?: string
}

interface StoredChannel {
  id: string
  kind: 'webhook' | 'telegram'
  name: string
  enabled: boolean
  secret?: string
  port?: number
  lastMessageAt?: string
  messagesIn: number
  messagesOut: number
  error?: string
}

interface StoredSettings {
  providers: StoredProvider[]
  mcpServers: McpServerConfig[]
  connectors: StoredConnectors
  channels: StoredChannel[]
  defaultProviderId?: string
  defaultModel?: string
  defaultPermissionMode: 'manual' | 'auto' | 'skip'
  customInstructions: string
  allowShell: boolean
  onboardingComplete: boolean
  governance: GovernanceSettings
}

const DEFAULT_SETTINGS: StoredSettings = {
  providers: [],
  mcpServers: [],
  connectors: { enabled: true, toolkits: [] },
  channels: [],
  defaultPermissionMode: 'manual',
  customInstructions: '',
  allowShell: false,
  onboardingComplete: false,
  governance: DEFAULT_GOVERNANCE_SETTINGS
}

function sealSecret(secret: string): string {
  const buffer = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(secret)
    : Buffer.from(secret, 'utf8')
  return `${safeStorage.isEncryptionAvailable() ? 'enc' : 'plain'}:${buffer.toString('base64')}`
}

function openSecret(sealed: string | undefined): string | undefined {
  if (!sealed) return undefined
  const [kind, payload] = sealed.split(':', 2)
  if (!payload) return undefined
  try {
    const buffer = Buffer.from(payload, 'base64')
    if (kind === 'enc' && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buffer)
    }
    if (kind === 'plain') return buffer.toString('utf8')
  } catch {
    return undefined
  }
  return undefined
}

function sanitizeMcpServer(config: McpServerConfig): McpServerConfig {
  return {
    id: config.id || newId('mcp'),
    name: config.name.trim() || 'MCP server',
    command: config.command.trim(),
    args: (config.args ?? []).map(String),
    env: config.env ?? {},
    enabled: config.enabled !== false,
    preset: config.preset,
    toolAllowlist: config.toolAllowlist?.filter(Boolean)
  }
}

function titleFromObjective(objective: string): string {
  const first = objective.trim().split(/\r?\n/)[0] ?? 'New task'
  const clean = first.replace(/^#+\s*/, '').trim()
  return clean.length > 70 ? `${clean.slice(0, 67)}…` : clean || 'New task'
}

class Store {
  private settings: StoredSettings | null = null
  private tasks = new Map<string, Task>()
  private schedules: ScheduleRecord[] = []
  private taskWrites = new Map<string, Promise<void>>()
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) return
    await fs.mkdir(getPaths().tasks, { recursive: true })
    await fs.mkdir(getPaths().workspaces, { recursive: true })

    const rawSettings = await readJson<Partial<StoredSettings>>(getPaths().settingsFile, {})
    this.settings = { ...DEFAULT_SETTINGS, ...rawSettings }
    this.settings.governance = normalizeGovernanceSettings(rawSettings.governance)
    this.settings.providers = Array.isArray(rawSettings.providers) ? rawSettings.providers : []
    this.settings.mcpServers = Array.isArray(rawSettings.mcpServers)
      ? rawSettings.mcpServers.map(sanitizeMcpServer)
      : []
    this.settings.connectors = {
      enabled: rawSettings.connectors?.enabled !== false,
      toolkits: Array.isArray(rawSettings.connectors?.toolkits)
        ? rawSettings.connectors.toolkits.map(String).filter(Boolean)
        : [],
      secret:
        typeof rawSettings.connectors?.secret === 'string'
          ? rawSettings.connectors.secret
          : undefined
    }
    this.settings.channels = Array.isArray(rawSettings.channels)
      ? rawSettings.channels
          .filter((channel) => channel?.id && (channel.kind === 'webhook' || channel.kind === 'telegram'))
          .map((channel) => ({
            id: String(channel.id),
            kind: channel.kind,
            name: channel.name?.trim() || (channel.kind === 'webhook' ? 'Local webhook' : 'Chat channel'),
            enabled: channel.enabled !== false,
            secret: typeof channel.secret === 'string' ? channel.secret : undefined,
            port: typeof channel.port === 'number' ? channel.port : undefined,
            lastMessageAt: channel.lastMessageAt,
            messagesIn: Number(channel.messagesIn) || 0,
            messagesOut: Number(channel.messagesOut) || 0,
            error: typeof channel.error === 'string' ? channel.error : undefined
          }))
      : []

    const files = await fs.readdir(getPaths().tasks).catch(() => [] as string[])
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const task = await readJson<Task | null>(join(getPaths().tasks, file), null)
      if (task?.id) this.tasks.set(task.id, task)
    }

    this.schedules = await readJson<ScheduleRecord[]>(getPaths().schedulesFile, [])
    this.initialized = true
  }

  private getSettings(): StoredSettings {
    if (!this.settings) throw new Error('Store not initialized')
    return this.settings
  }

  private toPublicProvider(provider: StoredProvider): ProviderPublic {
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      models: provider.models,
      enabled: provider.enabled,
      hasKey: Boolean(provider.secret)
    }
  }

  private toPublicChannel(channel: StoredChannel): ChannelRecord {
    return {
      id: channel.id,
      kind: channel.kind,
      name: channel.name,
      enabled: channel.enabled,
      hasToken: Boolean(channel.secret),
      webhookToken: channel.kind === 'webhook' ? openSecret(channel.secret) : undefined,
      webhookPath:
        channel.kind === 'webhook' && channel.port
          ? `http://127.0.0.1:${channel.port}/inbound/${channel.id}`
          : channel.kind === 'webhook'
            ? `/inbound/${channel.id}`
            : undefined,
      port: channel.kind === 'webhook' ? channel.port : undefined,
      lastMessageAt: channel.lastMessageAt,
      messagesIn: channel.messagesIn,
      messagesOut: channel.messagesOut,
      error: channel.error
    }
  }

  getPublicSettings(): PublicSettings {
    const settings = this.getSettings()
    return {
      providers: settings.providers.map((p) => this.toPublicProvider(p)),
      mcpServers: settings.mcpServers,
      connectors: {
        hasKey: Boolean(settings.connectors.secret),
        enabled: settings.connectors.enabled,
        toolkits: settings.connectors.toolkits
      },
      channels: settings.channels.map((channel) => this.toPublicChannel(channel)),
      defaultProviderId: settings.defaultProviderId,
      defaultModel: settings.defaultModel,
      defaultPermissionMode: settings.defaultPermissionMode,
      customInstructions: settings.customInstructions,
      allowShell: settings.allowShell,
      onboardingComplete: settings.onboardingComplete,
      governance: normalizeGovernanceSettings(settings.governance)
    }
  }

  getConnectorsConfig(): { apiKey?: string; enabled: boolean; toolkits: string[] } {
    const settings = this.getSettings()
    return {
      apiKey: openSecret(settings.connectors.secret),
      enabled: settings.connectors.enabled,
      toolkits: [...settings.connectors.toolkits]
    }
  }

  async saveConnectors(input: ConnectorsInput): Promise<PublicSettings> {
    const settings = this.getSettings()
    const connectors = settings.connectors
    if (input.removeKey) connectors.secret = undefined
    if (input.apiKey?.trim()) connectors.secret = sealSecret(input.apiKey.trim())
    if (input.enabled !== undefined) connectors.enabled = input.enabled
    if (input.toolkits) connectors.toolkits = [...new Set(input.toolkits.map(String).filter(Boolean))]
    await atomicWriteJson(getPaths().settingsFile, settings)
    return this.getPublicSettings()
  }

  listChannels(): ChannelRecord[] {
    return this.getSettings().channels.map((channel) => this.toPublicChannel(channel))
  }

  getChannel(id: string): StoredChannel | undefined {
    return this.getSettings().channels.find((channel) => channel.id === id)
  }

  getChannelToken(id: string): string | undefined {
    return openSecret(this.getChannel(id)?.secret)
  }

  async upsertChannel(input: ChannelInput): Promise<ChannelRecord> {
    const settings = this.getSettings()
    const existing = input.id
      ? settings.channels.find((channel) => channel.id === input.id)
      : undefined
    const id = existing?.id ?? newId('channel')
    const kind = existing?.kind ?? input.kind
    let secret = existing?.secret
    if (input.removeToken) secret = undefined
    if (kind === 'webhook' && !secret) secret = sealSecret(`knight_${randomBytes(24).toString('hex')}`)
    if (kind === 'telegram' && input.token?.trim()) secret = sealSecret(input.token.trim())

    const channel: StoredChannel = {
      id,
      kind,
      name: input.name.trim() || (kind === 'webhook' ? 'Local webhook' : 'Chat channel'),
      enabled: input.enabled,
      secret,
      port: existing?.port,
      lastMessageAt: existing?.lastMessageAt,
      messagesIn: existing?.messagesIn ?? 0,
      messagesOut: existing?.messagesOut ?? 0,
      error: existing?.error
    }
    if (existing) {
      const index = settings.channels.findIndex((item) => item.id === id)
      settings.channels[index] = channel
    } else {
      settings.channels.push(channel)
    }
    await atomicWriteJson(getPaths().settingsFile, settings)
    return this.toPublicChannel(channel)
  }

  async updateChannel(
    id: string,
    patch: Partial<
      Pick<
        StoredChannel,
        'port' | 'lastMessageAt' | 'messagesIn' | 'messagesOut' | 'error' | 'enabled'
      >
    >
  ): Promise<void> {
    const settings = this.getSettings()
    const channel = settings.channels.find((item) => item.id === id)
    if (!channel) return
    Object.assign(channel, patch)
    if (patch.error === undefined && 'error' in patch) delete channel.error
    await atomicWriteJson(getPaths().settingsFile, settings)
  }

  async removeChannel(id: string): Promise<void> {
    const settings = this.getSettings()
    settings.channels = settings.channels.filter((channel) => channel.id !== id)
    await atomicWriteJson(getPaths().settingsFile, settings)
  }

  getProvider(id: string): StoredProvider | undefined {
    return this.getSettings().providers.find((p) => p.id === id)
  }

  getProviderSecret(id: string): string | undefined {
    return openSecret(this.getProvider(id)?.secret)
  }

  async saveSettings(patch: SettingsPatch): Promise<PublicSettings> {
    const settings = this.getSettings()

    if (patch.providers) {
      const next: StoredProvider[] = []
      for (const input of patch.providers) {
        const existing = input.id ? settings.providers.find((p) => p.id === input.id) : undefined
        next.push(this.mergeProvider(existing, input))
      }
      settings.providers = next
    }

    if (patch.mcpServers) {
      settings.mcpServers = patch.mcpServers.map(sanitizeMcpServer)
    }

    if (patch.connectors) {
      if (patch.connectors.removeKey) settings.connectors.secret = undefined
      if (patch.connectors.apiKey?.trim()) settings.connectors.secret = sealSecret(patch.connectors.apiKey.trim())
      if (patch.connectors.enabled !== undefined) settings.connectors.enabled = patch.connectors.enabled
      if (patch.connectors.toolkits) {
        settings.connectors.toolkits = [...new Set(patch.connectors.toolkits.map(String).filter(Boolean))]
      }
    }

    if (patch.defaultProviderId !== undefined) settings.defaultProviderId = patch.defaultProviderId
    if (patch.defaultModel !== undefined) settings.defaultModel = patch.defaultModel
    if (patch.defaultPermissionMode !== undefined) settings.defaultPermissionMode = patch.defaultPermissionMode
    if (patch.customInstructions !== undefined) settings.customInstructions = patch.customInstructions
    if (patch.allowShell !== undefined) settings.allowShell = patch.allowShell
    if (patch.onboardingComplete !== undefined) settings.onboardingComplete = patch.onboardingComplete
    if (patch.governance !== undefined) {
      settings.governance = normalizeGovernanceSettings(patch.governance, settings.governance)
    }

    if (
      settings.defaultProviderId &&
      !settings.providers.some((p) => p.id === settings.defaultProviderId)
    ) {
      settings.defaultProviderId = undefined
      settings.defaultModel = undefined
    }

    await atomicWriteJson(getPaths().settingsFile, settings)
    return this.getPublicSettings()
  }

  private mergeProvider(existing: StoredProvider | undefined, input: ProviderInput): StoredProvider {
    const id = existing?.id ?? input.id ?? newId('provider')
    let secret = existing?.secret
    if (input.removeKey) secret = undefined
    if (input.apiKey && input.apiKey.trim()) secret = sealSecret(input.apiKey.trim())
    return {
      id,
      name: input.name.trim() || existing?.name || 'Provider',
      kind: input.kind,
      baseUrl: input.baseUrl?.trim() || undefined,
      models: [...new Set(input.models.map((m) => m.trim()).filter(Boolean))],
      enabled: input.enabled !== false,
      secret
    }
  }

  listTasks(): TaskSummary[] {
    return [...this.tasks.values()]
      .map((task) => ({
        id: task.id,
        title: task.title,
        objective: task.objective,
        status: task.status,
        mode: task.mode,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        artifactsCount: task.artifacts.length
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  getTaskFilePath(id: string): string {
    return join(getPaths().tasks, `${id}.json`)
  }

  async saveTask(task: Task): Promise<void> {
    task.updatedAt = nowIso()
    this.tasks.set(task.id, task)
    // Parallel Crew completions may persist the same task at once. Serialize
    // those writes so an older snapshot cannot rename over a newer one.
    const previous = this.taskWrites.get(task.id) ?? Promise.resolve()
    const write = previous
      .catch(() => undefined)
      .then(() => atomicWriteJson(this.getTaskFilePath(task.id), task))
    this.taskWrites.set(task.id, write)
    try {
      await write
    } finally {
      if (this.taskWrites.get(task.id) === write) this.taskWrites.delete(task.id)
    }
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = nowIso()
    const task: Task = {
      id: newId('task'),
      title: input.title?.trim() || titleFromObjective(input.objective),
      objective: input.objective.trim(),
      mode: input.mode,
      status: 'draft',
      permissionMode: input.permissionMode,
      agentRole: normalizeAgentRole(
        input.agentRole,
        this.getSettings().governance.defaultRole
      ),
      providerId: input.providerId,
      model: input.model,
      folders: uniqueFolders(input.folders ?? []),
      messages: [],
      steps: [],
      plan: [],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    }
    ensureTaskWorkspace(task.id)
    await this.saveTask(task)
    return task
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks.delete(id)
    await fs.rm(this.getTaskFilePath(id), { force: true })
    const workspace = taskWorkspace(id)
    if (workspace.startsWith(getPaths().workspaces)) {
      await fs.rm(workspace, { recursive: true, force: true })
    }
  }

  listSchedules(): ScheduleRecord[] {
    return [...this.schedules].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  getSchedule(id: string): ScheduleRecord | undefined {
    return this.schedules.find((s) => s.id === id)
  }

  async createSchedule(input: CreateScheduleInput): Promise<ScheduleRecord> {
    const record: ScheduleRecord = {
      id: newId('schedule'),
      title: input.title.trim() || titleFromObjective(input.prompt),
      prompt: input.prompt.trim(),
      cron: input.cron.trim(),
      enabled: input.enabled !== false,
      providerId: input.providerId,
      model: input.model,
      permissionMode: input.permissionMode,
      folders: uniqueFolders(input.folders ?? []),
      createdAt: nowIso()
    }
    this.schedules.push(record)
    await this.saveSchedules()
    return record
  }

  async updateSchedule(
    id: string,
    patch: Partial<CreateScheduleInput> & { enabled?: boolean; lastRunAt?: string; lastTaskId?: string }
  ): Promise<ScheduleRecord> {
    const record = this.schedules.find((s) => s.id === id)
    if (!record) throw new Error('Schedule not found')
    Object.assign(record, patch)
    await this.saveSchedules()
    return record
  }

  async deleteSchedule(id: string): Promise<void> {
    this.schedules = this.schedules.filter((s) => s.id !== id)
    await this.saveSchedules()
  }

  private async saveSchedules(): Promise<void> {
    await atomicWriteJson(getPaths().schedulesFile, this.schedules)
  }
}

function uniqueFolders(folders: string[]): string[] {
  return [...new Set(folders.map((f) => f.trim()).filter(Boolean))]
}

export const store = new Store()
