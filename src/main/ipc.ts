import { app, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { IPC } from '@shared/ipc'
import { REA_SERVER_CONFIG } from '@shared/constants'
import { normalizeAgentRole } from '@shared/governance'
import type {
  AttachmentRef,
  ChannelInput,
  ConnectorsInput,
  CreateScheduleInput,
  CreateTaskInput,
  McpServerConfig,
  McpServerStatus,
  MemoryInput,
  MessageReactionInput,
  ProviderInput,
  SendMessageInput,
  SettingsPatch,
  SkillDraft,
  SkillSource,
  TableGoalInput,
  TableHostInput,
  TableJoinInput,
  TableProposalInput,
  Task,
  UpdateTaskInput
} from '@shared/types'
import { agentRuntime } from './agent/runtime'
import { fetchProviderModels, verifyProvider } from './agent/providers'
import { refreshSelfImpulseEngine, selfImpulseEngineStatus } from './selfimpulse/bridge/facade'
import {
  newSelfImpulseThread,
  resolveSelfImpulseApproval,
  selfimpulseSession,
  sendSelfImpulseMessage,
  setActiveSelfImpulseThread,
  stopSelfImpulse
} from './selfimpulse/selfimpulse/engine/selfimpulse'
import { approvals } from './approvals'
import { sendTaskEvent } from './emitter'
import { store } from './store'
import { ensureTaskWorkspace, taskWorkspace } from './paths'
import { removeCoworkerTask, taskIdForBrowserScope } from './selfimpulse/coworker/workspaces'
import { resolveSafePath } from './security'
import { browserService } from './services/browser'
import { mcpManager } from './services/mcp'
import { mimeForPath } from './services/documents'
import { scheduler } from './services/scheduler'
import { tableService } from './services/table'
import { skillService } from './services/skills'
import { memoryService } from './services/memory'
import { usageService } from './services/usage'
import { connectorsManager } from './services/connectors'
import { channelService } from './services/channels'
import { subAgentService } from './services/subagents'
import { toggleMessageReaction } from './services/reactions'
import { applyTitleBarTheme, getMainWindow } from './window'
import { getBackend } from './backend'
import { registerBackendIpc, setBackendEventTarget } from './backend/ipc'
import { registerAuditIpc } from './audit'
import { registerEnterpriseControlIpc } from './enterpriseControl/ipc'
import { registerRsiralsIpc } from './selfimpulse/mission/rsiralsIpc'
import { registerVerifiedOutcomesIpc } from './selfimpulse/verifiedOutcomes/ipc'
import { verifiedOutcomes } from './selfimpulse/verifiedOutcomes/runtime'
import { requireLocalEnterprise } from './enterpriseControl/runtime'
import { runtimeAudit } from './audit/runtime'
import type { BackendSettingsPublic } from '@shared/types'
import type { LibraryPageInput, LibraryPagePatch } from '@shared/library'
import { getLibraryService } from './selfimpulse/library'
import { getMarketspace } from './marketspace'
import type { MarketspaceCreateInput } from '@shared/marketspace'

function publishTask(task: Task): void {
  sendTaskEvent({ type: 'task', task })
}

function requireMainWindowSender(event: Electron.IpcMainInvokeEvent): void {
  const main = getMainWindow()
  if (!main || main.isDestroyed() || event.sender !== main.webContents) {
    throw new Error('This browser operation is available only to the SelfImpulse window.')
  }
}

async function restartMcp(): Promise<void> {
  await mcpManager.closeAll()
  await mcpManager.startAll()
}

async function fileRef(path: string): Promise<AttachmentRef | null> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) return null
    return {
      id: `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: basename(path),
      path,
      size: stat.size,
      mimeType: mimeForPath(path)
    }
  } catch {
    return null
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    isDev: !app.isPackaged
  }))

  /* ── the SelfImpulse engine ────────────────────────────────────────────────
   * The engine is the brain; these are its only doors. `state` returns the
   * same committed session the receipt chain describes, and every mutation
   * broadcasts on `event:selfimpulse` so no surface invents a second copy. */
  ipcMain.handle(IPC.selfImpulseState, () => ({
    status: selfImpulseEngineStatus(),
    session: selfimpulseSession()
  }))

  ipcMain.handle(IPC.selfImpulseSend, async (_event, text: string) => {
    await sendSelfImpulseMessage(String(text ?? ''))
    return { status: selfImpulseEngineStatus(), session: selfimpulseSession() }
  })

  ipcMain.handle(IPC.selfImpulseStop, () => stopSelfImpulse())

  ipcMain.handle(IPC.selfImpulseApprove, (_event, input: { id: string; ok: boolean }) => {
    resolveSelfImpulseApproval(String(input?.id ?? ''), input?.ok === true, { by: 'human' })
    return { status: selfImpulseEngineStatus(), session: selfimpulseSession() }
  })

  ipcMain.handle(IPC.selfImpulseThreadNew, (_event, title?: string) => {
    const id = newSelfImpulseThread(typeof title === 'string' ? title : undefined)
    return { id, session: selfimpulseSession() }
  })

  ipcMain.handle(IPC.selfImpulseThreadSelect, (_event, id: string) => {
    const ok = setActiveSelfImpulseThread(String(id ?? ''))
    return { ok, session: selfimpulseSession() }
  })

  ipcMain.handle(IPC.settingsGet, () => ({
    ...store.getPublicSettings(),
    backend: getBackend().publicSettings() as unknown as BackendSettingsPublic
  }))

  ipcMain.handle(IPC.settingsSave, async (_event, patch: SettingsPatch) => {
    const previous = store.getPublicSettings()
    const settings = await store.saveSettings(patch)
    applyTitleBarTheme()
    if (JSON.stringify(previous.governance) !== JSON.stringify(settings.governance)) {
      void runtimeAudit.record({
        actor: 'system',
        actorId: 'local-policy-administrator',
        action: 'policy.settings_updated',
        outcome: 'ok',
        metadata: {
          previous: previous.governance,
          current: settings.governance
        }
      })
    }
    if (JSON.stringify(settings.mcpServers) !== JSON.stringify(previous.mcpServers)) {
      void restartMcp()
    }
    /* Provider and permission changes are inputs to the engine's binding.
     * Rebuild it now, so the user does not have to restart the app to make
     * the agent they just configured actually reachable. */
    if (
      previous.defaultProviderId !== settings.defaultProviderId ||
      previous.defaultModel !== settings.defaultModel ||
      previous.allowShell !== settings.allowShell ||
      JSON.stringify(previous.providers) !== JSON.stringify(settings.providers)
    ) {
      const engine = refreshSelfImpulseEngine()
      console.log(`[selfimpulse] engine re-bound: wired=${engine.wired} tools=${engine.tools.length}`)
    }
    return settings
  })

  ipcMain.handle(IPC.providerTest, (_event, input: ProviderInput) => verifyProvider(input))
  ipcMain.handle(IPC.providerFetchModels, (_event, input: ProviderInput) =>
    fetchProviderModels(input)
  )

  ipcMain.handle(IPC.tasksList, () => store.listTasks())
  ipcMain.handle(IPC.taskGet, (_event, id: string) => store.getTask(id) ?? null)

  ipcMain.handle(IPC.taskCreate, async (_event, input: CreateTaskInput) => {
    const outcome = input.outcome ? await verifiedOutcomes().binding(input.outcome) : undefined
    const task = await store.createTask({ ...input, outcome })
    publishTask(task)
    return task
  })

  ipcMain.handle(IPC.taskDelete, async (_event, id: string) => {
    await agentRuntime.stop(id)
    await browserService.disposeTask(id)
    await removeCoworkerTask(id)
    approvals.cancelTask(id)
    await store.deleteTask(id)
  })

  ipcMain.handle(IPC.taskSend, (_event, input: SendMessageInput) => agentRuntime.sendMessage(input))
  ipcMain.handle(IPC.taskSteer, (_event, input: SendMessageInput) => agentRuntime.steer(input))
  ipcMain.handle(IPC.taskStop, (_event, id: string) => agentRuntime.stop(id))
  ipcMain.handle(IPC.taskResume, (_event, id: string) => agentRuntime.resume(id))

  ipcMain.handle(IPC.taskUpdate, async (_event, input: UpdateTaskInput) => {
    const task = store.getTask(input.taskId)
    if (!task) throw new Error('Task not found.')
    if (input.mode !== undefined) task.mode = input.mode
    if (input.permissionMode !== undefined) task.permissionMode = input.permissionMode
    const previousRole = task.agentRole
    if (input.agentRole !== undefined) {
      task.agentRole = normalizeAgentRole(input.agentRole, previousRole ?? 'executor')
    }
    if (input.providerId !== undefined) task.providerId = input.providerId || undefined
    if (input.model !== undefined) task.model = input.model || undefined
    if (input.title !== undefined && input.title.trim()) task.title = input.title.trim()
    const previousOutcome = task.outcome
    if (input.outcome !== undefined) {
      if (agentRuntime.isRunning(task.id)) {
        throw new Error('Stop the task before changing its outcome contract; a live run cannot change scope mid-flight.')
      }
      if (input.outcome === null) delete task.outcome
      else task.outcome = await verifiedOutcomes().binding(input.outcome)
    }
    await store.saveTask(task)
    if (previousRole !== task.agentRole) {
      void runtimeAudit.record({
        actor: 'system',
        actorId: 'local-policy-administrator',
        taskId: task.id,
        role: task.agentRole,
        action: 'policy.role_changed',
        outcome: 'ok',
        target: task.agentRole,
        metadata: { previousRole: previousRole ?? 'executor' }
      })
    }
    if (JSON.stringify(previousOutcome) !== JSON.stringify(task.outcome)) {
      void runtimeAudit.record({
        actor: 'system',
        actorId: 'local-outcome-administrator',
        taskId: task.id,
        action: 'outcome.task_binding',
        outcome: 'ok',
        target: task.outcome ? `${task.outcome.contractId}@${task.outcome.contractRevision}` : 'unbound',
        metadata: task.outcome
          ? { dataClass: task.outcome.dataClass, environment: task.outcome.environment }
          : { previousContractId: previousOutcome?.contractId }
      })
    }
    publishTask(task)
    return task
  })

  ipcMain.handle(IPC.taskReact, async (_event, input: MessageReactionInput) => {
    const task = store.getTask(String(input?.taskId ?? ''))
    if (!task) throw new Error('Task not found.')
    toggleMessageReaction(task, String(input?.messageId ?? ''), String(input?.emoji ?? ''))
    await store.saveTask(task)
    publishTask(task)
    return task
  })

  ipcMain.handle(IPC.pickFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder for this task',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.pickFiles, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Attach files',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    const refs = await Promise.all(result.filePaths.map((path) => fileRef(path)))
    return refs.filter((ref): ref is AttachmentRef => Boolean(ref))
  })

  ipcMain.handle(IPC.filesFromDrop, async (_event, paths: string[]) => {
    if (!Array.isArray(paths)) return []
    const unique = [...new Set(paths.filter((path) => typeof path === 'string' && path))].slice(0, 40)
    const refs = await Promise.all(unique.map((path) => fileRef(path)))
    return refs.filter((ref): ref is AttachmentRef => Boolean(ref))
  })

  ipcMain.handle(IPC.taskAddFolder, async (_event, id: string) => {
    const task = store.getTask(id)
    if (!task) throw new Error('Task not found.')
    const result = await dialog.showOpenDialog({
      title: 'Grant folder access',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const folder = result.filePaths[0]
    if (!task.folders.includes(folder)) task.folders.push(folder)
    await store.saveTask(task)
    publishTask(task)
    return task
  })

  ipcMain.handle(IPC.taskRemoveFolder, async (_event, id: string, folder: string) => {
    const task = store.getTask(id)
    if (!task) throw new Error('Task not found.')
    task.folders = task.folders.filter((item) => item !== folder)
    await store.saveTask(task)
    publishTask(task)
    return task
  })

  ipcMain.handle(IPC.approvalRespond, async (_event, decision: { id: string; approved: boolean; always?: boolean }) => {
    await requireLocalEnterprise('approval.decide', 'approval', decision.id)
    approvals.respond(decision.id, decision.approved, decision.always)
  })

  ipcMain.handle(IPC.artifactOpen, async (_event, taskId: string, relPath: string) => {
    const target = await safeArtifactPath(taskId, relPath)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.artifactReveal, async (_event, taskId: string, relPath: string) => {
    shell.showItemInFolder(await safeArtifactPath(taskId, relPath))
  })

  ipcMain.handle(IPC.scheduleList, () => store.listSchedules())

  ipcMain.handle(IPC.scheduleCreate, async (_event, input: CreateScheduleInput) => {
    const record = await store.createSchedule(input)
    scheduler.sync(record.id)
    return record
  })

  ipcMain.handle(
    IPC.scheduleUpdate,
    async (_event, id: string, patch: Partial<CreateScheduleInput> & { enabled?: boolean }) => {
      const record = await store.updateSchedule(id, patch)
      scheduler.sync(id)
      return record
    }
  )

  ipcMain.handle(IPC.scheduleDelete, async (_event, id: string) => {
    scheduler.remove(id)
    await store.deleteSchedule(id)
  })

  ipcMain.handle(IPC.scheduleRun, async (_event, id: string) => {
    await scheduler.runNow(id)
  })

  ipcMain.handle(IPC.mcpList, (): McpServerStatus[] => mcpManager.getStatuses())
  ipcMain.handle(IPC.mcpRestart, async (_event, id?: string): Promise<McpServerStatus[]> => {
    if (id) {
      const config = store.getPublicSettings().mcpServers.find((server) => server.id === id)
      if (config) await mcpManager.connect(config)
    } else {
      await restartMcp()
    }
    return mcpManager.getStatuses()
  })

  ipcMain.handle(IPC.mcpUpsert, async (_event, config: McpServerConfig) => {
    const settings = store.getPublicSettings()
    const servers = [...settings.mcpServers]
    const index = servers.findIndex((server) => server.id === config.id)
    if (index >= 0) servers[index] = config
    else servers.push(config)
    await store.saveSettings({ mcpServers: servers })
    await mcpManager.connect(config)
    return mcpManager.getStatuses()
  })

  ipcMain.handle(IPC.mcpRemove, async (_event, id: string) => {
    const settings = store.getPublicSettings()
    await store.saveSettings({
      mcpServers: settings.mcpServers.filter((server) => server.id !== id)
    })
    await mcpManager.disconnect(id)
  })

  ipcMain.handle(IPC.mcpReaPreset, async () => {
    const settings = store.getPublicSettings()
    if (!settings.mcpServers.some((server) => server.preset === 'rea' || server.id === REA_SERVER_CONFIG.id)) {
      await store.saveSettings({
        mcpServers: [...settings.mcpServers, { ...REA_SERVER_CONFIG, args: [...REA_SERVER_CONFIG.args] }]
      })
    }
    const config = store
      .getPublicSettings()
      .mcpServers.find((server) => server.preset === 'rea' || server.id === REA_SERVER_CONFIG.id)
    if (config) await mcpManager.connect(config)
    return mcpManager.getStatuses()
  })

  ipcMain.handle(IPC.browserShow, async (event, taskId: string, scope?: string) => {
    requireMainWindowSender(event)
    const requestedScope = typeof scope === 'string' && scope ? scope : taskId
    if (typeof taskId !== 'string' || taskIdForBrowserScope(requestedScope) !== taskId) {
      throw new Error('Invalid task browser scope.')
    }
    if (!store.getTask(taskId)) throw new Error('The task owning this browser session no longer exists.')
    await browserService.show(requestedScope)
  })

  ipcMain.handle(IPC.browserStatus, (event) => {
    requireMainWindowSender(event)
    return browserService.status()
  })

  ipcMain.handle(IPC.librarySnapshot, () => getLibraryService().snapshot())
  ipcMain.handle(IPC.libraryCollectionCreate, async (_event, name: string) => {
    await requireLocalEnterprise('tool.use', 'tool', 'library')
    const collection = await getLibraryService().createCollection(name)
    void runtimeAudit.record({
      actor: 'system',
      actorId: 'human:local',
      action: 'library.collection_created',
      outcome: 'ok',
      target: collection.id
    })
    return collection
  })
  ipcMain.handle(IPC.libraryPageCreate, async (_event, input: LibraryPageInput) => {
    await requireLocalEnterprise('tool.use', 'tool', 'library')
    const page = await getLibraryService().createPage(input)
    void runtimeAudit.record({
      actor: 'system',
      actorId: 'human:local',
      action: 'library.page_created',
      outcome: 'ok',
      target: page.id,
      metadata: { revision: page.revision, collectionId: page.collectionId }
    })
    return page
  })
  ipcMain.handle(IPC.libraryPageUpdate, async (_event, id: string, patch: LibraryPagePatch) => {
    await requireLocalEnterprise('tool.use', 'tool', 'library')
    const page = await getLibraryService().updatePage(id, patch)
    void runtimeAudit.record({
      actor: 'system',
      actorId: 'human:local',
      action: 'library.page_updated',
      outcome: 'ok',
      target: page.id,
      metadata: { revision: page.revision }
    })
    return page
  })
  ipcMain.handle(IPC.libraryPageDelete, async (_event, id: string) => {
    await requireLocalEnterprise('tool.use', 'tool', 'library')
    const deleted = await getLibraryService().deletePage(id)
    if (deleted) {
      void runtimeAudit.record({
        actor: 'system',
        actorId: 'human:local',
        action: 'library.page_deleted',
        outcome: 'ok',
        target: id
      })
    }
    return deleted
  })

  ipcMain.handle(IPC.skillsList, () => skillService.list())
  ipcMain.handle(IPC.skillsSearch, (_event, query: string, registry?: SkillSource) =>
    skillService.search(query, registry)
  )
  ipcMain.handle(IPC.skillsInstall, (_event, ref: string, registry?: SkillSource) =>
    skillService.install(ref, registry)
  )
  ipcMain.handle(IPC.skillsRead, (_event, id: string) => skillService.read(id))
  ipcMain.handle(IPC.skillsCreate, (_event, draft: SkillDraft) => skillService.create(draft))
  ipcMain.handle(IPC.skillsRemove, (_event, id: string) => skillService.remove(id))

  ipcMain.handle(IPC.marketspaceList, (_event, query?: string) =>
    getMarketspace().list(typeof query === 'string' ? query : '')
  )
  ipcMain.handle(IPC.marketspaceRead, (_event, id: string) => getMarketspace().read(String(id ?? '')))
  ipcMain.handle(IPC.marketspaceInstall, (_event, id: string) => getMarketspace().install(String(id ?? '')))
  ipcMain.handle(IPC.marketspaceCreate, (_event, input: MarketspaceCreateInput) => {
    if (!input || typeof input !== 'object') throw new Error('A design system draft is required.')
    return getMarketspace().create(input)
  })
  ipcMain.handle(IPC.marketspaceRemove, async (_event, id: string) => {
    await getMarketspace().remove(String(id ?? ''))
    return getMarketspace().list()
  })
  ipcMain.handle(IPC.marketspaceApply, async (_event, taskId: string, id: string, overwrite?: boolean) => {
    const task = store.getTask(String(taskId ?? ''))
    if (!task) throw new Error('Task not found.')
    const workspace = ensureTaskWorkspace(task.id)
    const result = await getMarketspace().apply(String(id ?? ''), workspace, overwrite === true)
    for (const file of result.files) {
      await agentRuntime.registerArtifact(task, join(workspace, file))
    }
    return result
  })

  ipcMain.handle(IPC.memoryList, async () => {
    await requireLocalEnterprise('memory.read', 'memory', 'captain')
    return memoryService.list()
  })
  ipcMain.handle(IPC.memoryAdd, async (_event, input: MemoryInput) => {
    await requireLocalEnterprise('memory.write', 'memory', 'captain')
    return memoryService.add(input)
  })
  ipcMain.handle(IPC.memoryRemove, async (_event, id: string) => {
    await requireLocalEnterprise('memory.write', 'memory', 'captain')
    return memoryService.remove(id)
  })
  ipcMain.handle(IPC.memoryImport, async (_event, text: string) => {
    await requireLocalEnterprise('memory.write', 'memory', 'captain')
    return memoryService.importText(text)
  })

  ipcMain.handle(IPC.usageSummary, () => usageService.summary())

  ipcMain.handle(IPC.connectorsState, (_event, refresh?: boolean) =>
    connectorsManager.getState(Boolean(refresh))
  )
  ipcMain.handle(IPC.connectorsSave, async (_event, input: ConnectorsInput) => {
    await store.saveConnectors(input)
    connectorsManager.invalidate()
    return connectorsManager.getState(true)
  })

  ipcMain.handle(IPC.channelState, () => channelService.getState())
  ipcMain.handle(IPC.channelUpsert, (_event, input: ChannelInput) =>
    channelService.upsert(input)
  )
  ipcMain.handle(IPC.channelRemove, (_event, id: string) => channelService.remove(id))
  ipcMain.handle(IPC.channelRestart, () => channelService.restart())

  ipcMain.handle(IPC.subAgentsList, () => subAgentService.list())

  ipcMain.handle(IPC.tableGetState, () => tableService.getState())
  ipcMain.handle(IPC.tableHost, (_event, input: TableHostInput) => tableService.hostTable(input))
  ipcMain.handle(IPC.tableJoin, (_event, input: TableJoinInput) => tableService.joinTable(input))
  ipcMain.handle(IPC.tableSetGoal, (_event, input: TableGoalInput) => tableService.setGoal(input))
  ipcMain.handle(IPC.tablePropose, (_event, input: TableProposalInput) =>
    tableService.propose(input)
  )
  ipcMain.handle(IPC.tableTurnKey, (_event, proposalId: string) => tableService.turnKey(proposalId))
  ipcMain.handle(IPC.tableWithdraw, (_event, proposalId: string) => tableService.withdraw(proposalId))
  ipcMain.handle(IPC.tablePublish, (_event, proposalId: string) => tableService.publish(proposalId))
  ipcMain.handle(IPC.tableLeave, () => tableService.leave())

  registerBackendIpc()
  registerAuditIpc()
  registerEnterpriseControlIpc()
  registerRsiralsIpc()
  registerVerifiedOutcomesIpc()
}

async function safeArtifactPath(taskId: string, relPath: string): Promise<string> {
  const task = store.getTask(taskId)
  if (!task) throw new Error('Task not found.')
  // Real-path checking as well as lexical: a symlink inside the workspace must
  // not hand `shell.openPath` a target that lives outside it.
  return resolveSafePath([taskWorkspace(taskId)], relPath, { mode: 'read' })
}
