import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  BackendCredits,
  BackendGatewayState,
  BackendWorkFile,
  BackendWorkMail,
  BackendWorkState,
  BackendMemoryNote,
  BackendModeInfo,
  BackendProviderInfo,
  BackendSettingsPublic,
  BackendThemeStyle,
  BackendTierInfo,
  BackendUsageSummary
} from '@shared/types'
import { getBackend, WORK_MODES, type BackendSettings } from './index'
import { availableProviders, DEFAULT_TIER_CONFIG, MODEL_TIERS, tierModel } from './provider'
import { styles } from './themes'

/**
 * The Seamoon backend, exposed to the renderer.
 *
 * Everything the renderer can ask the backend for goes through here: the
 * provider registry and model tiers, the memory ledger, the usage ledger, the
 * Moon Gateway, the skill marketplaces, Work Files, computer use, Grounded Actions
 * and the appearance styles.
 */

let eventsTarget: BrowserWindow | null = null

export function setBackendEventTarget(window: BrowserWindow): void {
  eventsTarget = window
}

/** Forwards a backend event to the renderer. */
export function emitBackendEvent(event: unknown): void {
  if (!eventsTarget || eventsTarget.isDestroyed()) return
  eventsTarget.webContents.send(IPC.eventBackend, event)
}

function publicSettings(): BackendSettingsPublic {
  return getBackend().publicSettings() as unknown as BackendSettingsPublic
}

function memoryNotes(): BackendMemoryNote[] {
  return getBackend().memory.list().map((note) => ({
    id: note.id,
    text: note.text,
    scope: note.scope,
    tags: note.tags ?? [],
    source: note.source ?? 'agent',
    createdAt: note.createdAt
  }))
}

function gatewayState(): BackendGatewayState {
  const backend = getBackend()
  const gateway = backend.gateway
  if (!gateway) {
    return {
      running: false,
      url: null,
      port: null,
      agents: [],
      bindings: [],
      automations: [],
      channels: []
    }
  }
  const address = gateway.address()
  return {
    running: true,
    url: address.url,
    port: address.port,
    agents: gateway.agents() as unknown[],
    bindings: gateway.bindings() as unknown[],
    automations: gateway.automations() as unknown[],
    channels: []
  }
}

export function registerBackendIpc(): void {
  const backend = getBackend()
  backend.emitter = (event, payload) => {
    if (event === 'permission:request') {
      emitBackendEvent({
        type: 'permission',
        id: String((payload as { id?: string })?.id ?? ''),
        tool: String((payload as { name?: string })?.name ?? ''),
        description: String((payload as { description?: string })?.description ?? '')
      })
      return
    }
    if (event === 'provider:attempt') {
      const data = payload as { providerId?: string; model?: string }
      emitBackendEvent({
        type: 'provider',
        providerId: data.providerId ?? '',
        model: data.model ?? ''
      })
      return
    }
    if (event === 'gateway:denied') {
      emitBackendEvent({
        type: 'gateway',
        message: String((payload as { reason?: string })?.reason ?? 'The gateway refused a request.')
      })
    }
  }

  ipcMain.handle(IPC.backendSettingsGet, () => publicSettings())

  ipcMain.handle(IPC.backendSettingsSave, (_event, patch: Partial<BackendSettingsPublic>) => {
    const next = backend.persistSettings(patch as Partial<BackendSettings>)
    return next as unknown as BackendSettingsPublic
  })

  ipcMain.handle(IPC.backendCredits, () => backend.creditsSummary() as unknown as BackendCredits)

  ipcMain.handle(IPC.backendThemes, () =>
    styles().map(
      (style): BackendThemeStyle => ({
        id: style.id,
        label: style.label,
        builtin: style.builtin,
        note: style.note,
        accent: style.accent,
        swatches: style.swatches.map((swatch) => ({
          name: swatch.name,
          hex: swatch.hex
        })),
        modes: style.modes.map((mode) => String(mode))
      })
    )
  )

  ipcMain.handle(IPC.backendModes, () => Object.values(WORK_MODES) as BackendModeInfo[])

  ipcMain.handle(IPC.backendProviders, () =>
    availableProviders().map(
      (provider): BackendProviderInfo => ({
        id: provider.id,
        name: provider.name,
        defaultModel: provider.defaultModel,
        available: provider.available,
        keyEnv: provider.keyEnv
      })
    )
  )

  ipcMain.handle(IPC.backendTiers, () => {
    const fallback = backend.settings.model
    return MODEL_TIERS.map((tier): BackendTierInfo => {
      const config = DEFAULT_TIER_CONFIG[tier.id]
      return {
        id: tier.id,
        name: tier.name,
        desc: tier.desc,
        env: tier.env,
        model: tierModel(tier, fallback),
        thinking: config.thinking,
        effort: config.effort,
        multiplier: config.multiplier,
        context: config.context
      }
    })
  })

  ipcMain.handle(IPC.backendMemoryList, () => memoryNotes())

  ipcMain.handle(
    IPC.backendMemoryAdd,
    (_event, input: { text: string; scope?: string; tags?: string[] }) => {
      backend.memory.add({
        text: input.text,
        scope: input.scope ?? 'global',
        tags: input.tags ?? []
      })
      return memoryNotes()
    }
  )

  ipcMain.handle(IPC.backendMemoryRemove, (_event, id: string) => {
    backend.memory.remove(id)
    return memoryNotes()
  })

  ipcMain.handle(IPC.backendMemoryImport, (_event, text: string) => {
    backend.memory.importText(text)
    return memoryNotes()
  })

  ipcMain.handle(IPC.backendUsageSummary, () => backend.usage.summary() as BackendUsageSummary)

  ipcMain.handle(IPC.backendGatewayStart, async () => {
    await backend.startGateway()
    return gatewayState()
  })

  ipcMain.handle(IPC.backendGatewayStop, async () => {
    await backend.gateway?.stop()
    backend.gateway = null
    return gatewayState()
  })

  ipcMain.handle(IPC.backendGatewayStatus, () => gatewayState())

  ipcMain.handle(IPC.backendGatewayToken, () => backend.gatewayToken.ensure())

  ipcMain.handle(IPC.backendSubscriptionAccountStatus, () => ({
    connected: backend.subscription.connected()
  }))

  ipcMain.handle(IPC.backendSubscriptionAccountModels, async () => {
    const models = await backend.subscription.models()
    return models.map((model) => model.id)
  })

  ipcMain.handle(IPC.backendWorkStatus, () => {
    const account = backend.work.account
    return {
      connected: backend.work.connected(),
      account: account ? { email: account.email, name: account.name } : null
    } as BackendWorkState
  })

  ipcMain.handle(IPC.backendWorkBeginSignIn, async (_event, clientId?: string) => {
    const prompt = await backend.work.beginSignIn(clientId ?? backend.work.clientId())
    return {
      prompt:
        prompt.message ||
        `Open ${prompt.verificationUri ?? 'the sign-in page'} and enter the code ${prompt.userCode ?? ''}.`
    }
  })

  ipcMain.handle(IPC.backendWorkCompleteSignIn, async () => {
    const result = await backend.work.completeSignIn()
    if (result.pending) {
      return { ok: false, error: 'The sign-in is not finished yet.' }
    }
    const account = backend.work.account
    return { ok: true, email: account?.email }
  })

  ipcMain.handle(IPC.backendWorkDisconnect, async () => {
    await backend.work.disconnect()
    return { ok: true }
  })

  ipcMain.handle(IPC.backendWorkFiles, async () => {
    const files = await backend.work.listFiles('root', 50)
    return files.map(
      (file): BackendWorkFile => ({
        id: file.id ?? '',
        name: file.name ?? '',
        size: file.size,
        modified: file.modified
      })
    )
  })

  ipcMain.handle(IPC.backendWorkMail, async () => {
    const mail = await backend.work.listMail('inbox', 20)
    return mail.map(
      (message): BackendWorkMail => ({
        id: message.id ?? '',
        subject: message.subject ?? '',
        from: message.from,
        received: message.received
      })
    )
  })

  ipcMain.handle(IPC.backendComputerStatus, () => ({
    enabled: backend.computer.enabled
  }))

  ipcMain.handle(IPC.backendGroundedActionsStatus, () => ({
    enabled: backend.uitars.enabled,
    model: backend.uitars.config.model,
    baseUrl: backend.uitars.config.baseUrl
  }))

  ipcMain.handle(IPC.backendMarketplaceSearch, async (_event, query: string) => {
    const result = await backend.marketplace.search({ q: query })
    return result.items ?? []
  })

  ipcMain.handle(IPC.backendMarketplaceInstall, async (_event, id: string) => {
    const result = await backend.marketplace.install({ id })
    return { ok: Boolean(result.ok ?? true) }
  })

  ipcMain.handle(IPC.backendRegistrySearch, async (_event, query: string) => {
    const result = await backend.clawhub.search(query)
    return result.items ?? []
  })

  ipcMain.handle(IPC.backendExternalAgentStatus, async () => {
    const status = await backend.externalAgent.status()
    return { installed: status.gatewayReachable, version: status.version }
  })

  ipcMain.handle(IPC.backendPermissionAnswer, (_event, id: string, allowed: boolean) =>
    backend.permissions.answer(id, allowed)
  )
}
