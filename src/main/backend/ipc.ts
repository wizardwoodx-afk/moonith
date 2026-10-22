import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  BackendCredits,
  BackendGatewayState,
  BackendM365File,
  BackendM365Mail,
  BackendM365State,
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
 * Moon Gateway, the skill marketplaces, Microsoft 365, computer use, UI-TARS
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
        baseUrl: provider.baseUrl,
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

  ipcMain.handle(IPC.backendCopilotStatus, () => ({
    connected: backend.copilot.connected()
  }))

  ipcMain.handle(IPC.backendCopilotModels, async () => {
    const models = await backend.copilot.models()
    return models.map((model) => model.id)
  })

  ipcMain.handle(IPC.backendM365Status, () => {
    const account = backend.m365.account
    return {
      connected: backend.m365.connected(),
      account: account ? { email: account.email, name: account.name } : null
    } as BackendM365State
  })

  ipcMain.handle(IPC.backendM365BeginSignIn, async (_event, clientId?: string) => {
    const prompt = await backend.m365.beginSignIn(clientId ?? backend.m365.clientId())
    return {
      prompt:
        prompt.message ||
        `Open ${prompt.verificationUri ?? 'the Microsoft sign-in page'} and enter the code ${prompt.userCode ?? ''}.`
    }
  })

  ipcMain.handle(IPC.backendM365CompleteSignIn, async () => {
    const result = await backend.m365.completeSignIn()
    if (result.pending) {
      return { ok: false, error: 'The sign-in is not finished yet.' }
    }
    const account = backend.m365.account
    return { ok: true, email: account?.email }
  })

  ipcMain.handle(IPC.backendM365Disconnect, async () => {
    await backend.m365.disconnect()
    return { ok: true }
  })

  ipcMain.handle(IPC.backendM365Files, async () => {
    const files = await backend.m365.listFiles('root', 50)
    return files.map(
      (file): BackendM365File => ({
        id: file.id ?? '',
        name: file.name ?? '',
        size: file.size,
        modified: file.modified
      })
    )
  })

  ipcMain.handle(IPC.backendM365Mail, async () => {
    const mail = await backend.m365.listMail('inbox', 20)
    return mail.map(
      (message): BackendM365Mail => ({
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

  ipcMain.handle(IPC.backendUiTarsStatus, () => ({
    enabled: backend.uitars.enabled,
    model: backend.uitars.config.model,
    baseUrl: backend.uitars.config.baseUrl
  }))

  ipcMain.handle(IPC.backendLobeSearch, async (_event, query: string) => {
    const result = await backend.lobe.search({ q: query })
    return result.items ?? []
  })

  ipcMain.handle(IPC.backendLobeInstall, async (_event, id: string) => {
    const result = await backend.lobe.install({ id })
    return { ok: Boolean(result.ok ?? true) }
  })

  ipcMain.handle(IPC.backendClawHubSearch, async (_event, query: string) => {
    const result = await backend.clawhub.search(query)
    return result.items ?? []
  })

  ipcMain.handle(IPC.backendOpenClawStatus, async () => {
    const status = await backend.openclaw.status()
    return { installed: status.gatewayReachable, version: status.version }
  })

  ipcMain.handle(IPC.backendPermissionAnswer, (_event, id: string, allowed: boolean) =>
    backend.permissions.answer(id, allowed)
  )
}
