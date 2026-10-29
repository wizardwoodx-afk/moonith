import { app, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, join } from 'node:path'
import { assertTrustedMainFrame } from './ipcTrust'
import { IPC } from '@shared/ipc'
import { REA_SERVER_CONFIG } from '@shared/constants'
import { LOCAL_OWNER_PRINCIPAL_ID } from '@shared/enterpriseControl'
import type {
  AttachmentRef,
  ChannelInput,
  ConnectorsInput,
  CreateScheduleInput,
  CreateTaskInput,
  EditMessageInput,
  KnowledgeDecideResult,
  KnowledgeDecisionInput,
  KnowledgeProposalView,
  McpServerConfig,
  McpServerStatus,
  MemoryInput,
  MessageFeedbackInput,
  MessageReactionInput,
  MessageVote,
  PastedImageInput,
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
import { coworkTools } from './agent/tools/coworkTools'
import { rookTools } from './agent/tools/rookTools'
import { rsiralsTools } from './agent/tools/rsiralsTools'
import { promeyTools } from './agent/tools/promeyTools'
import { rookEngineBridge } from './engine/rookBridge'
import { promeyEngineBridge } from './engine/promeyBridge'
import { coworkEngineBridge } from './engine/coworkBridge'
import { fetchProviderModels, verifyProvider } from './agent/providers'
import { refreshSelfImpulseEngine } from './selfimpulse/bridge/facade'
import { getImpCodesAccess, importImpCodesAccess } from './impcodes/access'
import { getSecurityPosture } from './impdesk/posture'
import { engineStatus } from './engine'
import { approvals } from './approvals'
import { sendTaskEvent } from './emitter'
import { store } from './store'
import { taskWorkspace, ensureTaskWorkspace } from './paths'
import { removeCoworkerTask, taskIdForBrowserScope } from './selfimpulse/coworker/workspaces'
import { normalizeAgentRole } from '@shared/governance'
import { resolveAgentName } from '@shared/identity'
import { resolveSafePath } from './security'
import { browserService } from './services/browser'
import { captureScreen, savePastedImage } from './capture'
import { toggleMessageReaction } from './services/reactions'
import { setMessageFeedback } from './services/feedback'
import { getLibraryService } from './selfimpulse/library'
import { getMarketspace } from './marketspace'
import type { LibraryPageInput, LibraryPagePatch } from '@shared/library'
import type { MarketspaceCreateInput } from '@shared/marketspace'
import { mcpManager } from './services/mcp'
import { mcpMarketService } from './services/mcpMarket'
import { mimeForPath } from './services/documents'
import { teamPlaybookService } from './selfimpulse/team/playbooks'
import { proofOfWorkService } from './selfimpulse/team/proofOfWork'
import { passportManager } from './sphragis/passport'
import { mnemeGraph } from './selfimpulse/mneme/graph'
import { kubernisEngine } from './selfimpulse/mneme/proactive'
import { harmoniaService } from './selfimpulse/harmonia/service'
import type { HarmoniaDecisionStatus } from '@shared/types'
import { scheduler } from './services/scheduler'
import {
  clear as clearSnapshots,
  list as listSnapshots,
  redo as redoSnapshots,
  revert as revertSnapshots,
  steps as listSteps
} from './services/snapshots'
import { tableService } from './services/table'
import { skillService } from './services/skills'
import {
  decideKnowledgeProposal,
  loadKnowledgeProposals,
  type KnowledgeProposal
} from './selfimpulse/mission/knowledgeSkills'
import { memoryService } from './services/memory'
import { usageService } from './services/usage'
import { connectorsManager } from './services/connectors'
import { channelService } from './services/channels'
import { subAgentService, CREW_SPECIALISTS } from './services/subagents'
import { awakeableManager } from './agent/durable/awakeables'
import { applyTitleBarTheme } from './window'
import { getBackend } from './backend'
import { registerBackendIpc, setBackendEventTarget } from './backend/ipc'
import { registerAuditIpc } from './audit'
import { runtimeAudit } from './audit/runtime'
import { registerEnterpriseIpc, noteGrantedFolder } from './enterprise/ipc'
import { registerEnterpriseControlIpc } from './enterpriseControl/ipc'
import { registerRsiralsIpc } from './selfimpulse/mission/rsiralsIpc'
import { requireLocalEnterprise } from './enterpriseControl/runtime'
import type { BackendSettingsPublic } from '@shared/types'

function publishTask(task: Task): void {
  sendTaskEvent({ type: 'task', task })
}

async function restartMcp(): Promise<void> {
  await mcpManager.closeAll()
  await mcpManager.startAll()
}

async function fileRef(path: string): Promise<AttachmentRef | null> {
  try {
    const stat = await fs.stat(path)
    const isDir = stat.isDirectory()
    if (!stat.isFile() && !isDir) return null
    return {
      id: `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: basename(path),
      path,
      size: isDir ? 0 : stat.size,
      mimeType: isDir ? 'inode/directory' : mimeForPath(path)
    }
  } catch {
    return null
  }
}

function safeOsUserName(): string | undefined {
  try {
    const name = userInfo().username.trim()
    return name || undefined
  } catch {
    return undefined
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    isDev: !app.isPackaged,
    userName: safeOsUserName()
  }))

  /* ── settings ───────────────────────────────────────────────────────────── */
  ipcMain.handle(IPC.settingsGet, () => ({
    ...store.getPublicSettings(),
    backend: getBackend().publicSettings() as unknown as BackendSettingsPublic
  }))

  ipcMain.handle(IPC.settingsSave, async (event, patch: SettingsPatch) => {
    assertTrustedMainFrame(event)
    const previous = store.getPublicSettings()
    const settings = await store.saveSettings(patch)
    applyTitleBarTheme()
    if (JSON.stringify(settings.mcpServers) !== JSON.stringify(previous.mcpServers)) {
      void restartMcp().catch((error) => {
        console.error('[mcp] could not restart configured servers:', error)
      })
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

  /* ── ImpCodes access + ImpDesk posture ─────────────────────────────────── */
  ipcMain.handle(IPC.impCodesAccess, () => getImpCodesAccess())

  ipcMain.handle(IPC.impCodesImport, async (event) => {
    assertTrustedMainFrame(event)
    const previous = store.getPublicSettings()
    const result = await importImpCodesAccess()
    const settings = store.getPublicSettings()
    if (JSON.stringify(settings.mcpServers) !== JSON.stringify(previous.mcpServers)) {
      void restartMcp().catch((error) => {
        console.error('[mcp] could not restart imported servers:', error)
      })
    }
    if (result.providerCount > 0) {
      const engine = refreshSelfImpulseEngine()
      console.log(
        `[impcodes] imported providers=${result.providerCount} servers=${result.serverCount} engine wired=${engine.wired} tools=${engine.tools.length}`
      )
    }
    return result
  })

  ipcMain.handle(IPC.securityPosture, () => getSecurityPosture())
  ipcMain.handle(IPC.engineStatus, () => engineStatus())

  ipcMain.handle(IPC.tasksList, () => store.listTasks())
  ipcMain.handle(IPC.taskGet, (_event, id: string) => store.getTask(id) ?? null)

  ipcMain.handle(IPC.taskCreate, async (event, input: CreateTaskInput) => {
    assertTrustedMainFrame(event)
    const task = await store.createTask(input)
    publishTask(task)
    return task
  })

  ipcMain.handle(IPC.taskDelete, async (event, id: string) => {
    assertTrustedMainFrame(event)
    await agentRuntime.stop(id)
    await browserService.disposeTask(id)
    await removeCoworkerTask(id)
    approvals.cancelTask(id)
    await clearSnapshots(id)
    await store.deleteTask(id)
  })

  ipcMain.handle(IPC.taskChangesList, (_event, id: string) => listSnapshots(id))

  ipcMain.handle(IPC.taskStepsList, (_event, id: string) => listSteps(id))

  ipcMain.handle(IPC.taskRevert, (_event, id: string, toStep?: string) =>
    revertSnapshots(id, { toStep })
  )

  ipcMain.handle(IPC.taskRedo, (_event, id: string, toStep?: string) =>
    redoSnapshots(id, { toStep })
  )

  ipcMain.handle(IPC.taskSend, (_event, input: SendMessageInput) => agentRuntime.sendMessage(input))
  ipcMain.handle(IPC.taskSteer, (_event, input: SendMessageInput) => agentRuntime.steer(input))
  ipcMain.handle(IPC.taskEditMessage, (_event, input: EditMessageInput) => agentRuntime.editMessage(input))
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
    publishTask(task)
    return task
  })

  ipcMain.handle(IPC.taskReact, async (_event, input: MessageReactionInput) => {
    const task = store.getTask(String(input?.taskId ?? ''))
    if (!task) throw new Error('Task not found.')
    const messageId = String(input?.messageId ?? '')
    const emoji = String(input?.emoji ?? '')

    // Reactions are quiet metadata only. They never become a message and
    // never trigger an agent turn.
    toggleMessageReaction(task, messageId, emoji)
    await store.saveTask(task)
    publishTask(task)

    return task
  })

  ipcMain.handle(IPC.taskFeedback, async (_event, input: MessageFeedbackInput) => {
    const task = store.getTask(String(input?.taskId ?? ''))
    if (!task) throw new Error('Task not found.')
    const raw = input?.vote
    const vote: MessageVote | null = raw === 'up' || raw === 'down' ? raw : null

    // Like/dislike is quiet metadata only. It never becomes a message and
    // never triggers an agent turn.
    setMessageFeedback(task, String(input?.messageId ?? ''), vote, String(input?.note ?? ''))
    await store.saveTask(task)
    publishTask(task)

    return task
  })

  ipcMain.handle(IPC.pickFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder for this task',
      properties: ['openDirectory', 'createDirectory']
    })
    const folder = result.canceled ? null : result.filePaths[0] ?? null
    /* A folder the user pointed at in a native dialog is the only way an
     * arbitrary root becomes trusted enough for a repository scan. */
    if (folder) noteGrantedFolder(folder)
    return folder
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

  ipcMain.handle(IPC.filesFromDrop, async (_event, paths: unknown) => {
    if (!Array.isArray(paths)) return []
    const unique = [
      ...new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0))
    ].slice(0, 40)
    const refs = await Promise.all(unique.map((path) => fileRef(path)))
    return refs.filter((ref): ref is AttachmentRef => Boolean(ref))
  })

  /* A pasted screenshot arrives as bytes because the sandboxed renderer cannot
   * write a file. Main writes it into the task's own attachments folder and then
   * builds the ref with the same `fileRef` used by the picker and the drop path,
   * so a paste is indistinguishable from a dropped file downstream. */
  ipcMain.handle(IPC.filesFromClipboard, async (event, input: PastedImageInput) => {
    assertTrustedMainFrame(event)
    const ref = await fileRef(await savePastedImage(input))
    if (!ref) throw new Error('The pasted image could not be saved as an attachment.')
    return ref
  })

  ipcMain.handle(IPC.screenCapture, async (event, taskId: unknown) => {
    assertTrustedMainFrame(event)
    const ref = await fileRef(await captureScreen(taskId))
    if (!ref) throw new Error('The screen capture could not be saved as an attachment.')
    return ref
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
    noteGrantedFolder(folder)
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
    await requireLocalEnterprise('approval.decide', 'approval', String(decision?.id ?? ''))
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

  ipcMain.handle(IPC.mcpMarketSearch, (_event, query: string) =>
    mcpMarketService.search(String(query ?? ''))
  )
  ipcMain.handle(IPC.mcpMarketRead, (_event, id: string) => mcpMarketService.read(String(id ?? '')))
  ipcMain.handle(IPC.mcpMarketInstall, (_event, id: string) =>
    mcpMarketService.install(String(id ?? ''))
  )

  ipcMain.handle(IPC.browserShow, (_event, taskId: string, scope?: string) => {
    const requestedScope = typeof scope === 'string' && scope ? scope : taskId
    if (taskIdForBrowserScope(requestedScope) !== taskId) {
      throw new Error('Invalid task browser scope.')
    }
    browserService.show(requestedScope)
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

  ipcMain.handle(IPC.agentToolsList, () =>
    [...coworkTools, ...rookTools, ...rsiralsTools, ...promeyTools].map((tool) => ({ name: tool.name, title: (tool as any).title || tool.name, description: tool.description }))
  )
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

  /* ── Knowledge forge: the human decision, and nothing else ─────────────────
   * A distilled document becomes a skill only through the decision made here.
   * The renderer names a proposal by id and nothing more: it cannot address a
   * store key or a path, and the id is validated in this process before the
   * service sees it. There is deliberately no auto-apply and no "always
   * approve" — the mirror inside the service runs on this one call, once per
   * proposal, and writes through the governed ledger as a human RECOURSE write. */
  ipcMain.handle(IPC.knowledgeList, (): KnowledgeProposalView[] =>
    knowledgeProposalViews(loadKnowledgeProposals())
  )

  ipcMain.handle(
    IPC.knowledgeDecide,
    async (event, input: KnowledgeDecisionInput): Promise<KnowledgeDecideResult> => {
      assertTrustedMainFrame(event)
      const current = (): KnowledgeProposalView[] => knowledgeProposalViews(loadKnowledgeProposals())
      const id = typeof input?.id === 'string' ? input.id.trim() : ''
      if (!KNOWLEDGE_PROPOSAL_ID.test(id)) {
        return { ok: false, error: 'That is not a knowledge proposal. Nothing was decided.', proposals: current() }
      }
      const decision = input?.decision
      if (decision !== 'approve' && decision !== 'discard') {
        return { ok: false, error: 'Choose approve or discard. Nothing was decided.', proposals: current() }
      }
      await requireLocalEnterprise('approval.decide', 'approval', id)
      const result = decideKnowledgeProposal({
        id,
        decision: decision === 'approve' ? 'APPROVED' : 'REJECTED',
        /** The actor is this process's own local identity, never a renderer string. */
        by: LOCAL_OWNER_PRINCIPAL_ID
      })
      if (!result.ok) return { ok: false, error: result.error, proposals: current() }
      void runtimeAudit.record({
        actor: 'system',
        actorId: LOCAL_OWNER_PRINCIPAL_ID,
        action: decision === 'approve' ? 'knowledge.approved' : 'knowledge.discarded',
        outcome: 'ok',
        target: id,
        metadata: { mirrored: result.mirrored }
      })
      return { ok: true, error: null, proposals: current() }
    }
  )

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

  ipcMain.handle(IPC.memoryList, () => memoryService.list())
  ipcMain.handle(IPC.memoryAdd, (_event, input: MemoryInput) => memoryService.add(input))
  ipcMain.handle(IPC.memoryRemove, (_event, id: string) => memoryService.remove(id))
  ipcMain.handle(IPC.memoryImport, (_event, text: string) => memoryService.importText(text))

  ipcMain.handle(IPC.usageSummary, () => usageService.summary())

  ipcMain.handle(IPC.connectorsState, (_event, refresh?: boolean) =>
    connectorsManager.getState(Boolean(refresh))
  )
  ipcMain.handle(IPC.connectorsSave, async (_event, input: ConnectorsInput) => {
    await store.saveConnectors(input)
    connectorsManager.invalidate()
    return connectorsManager.getState(true)
  })
  ipcMain.handle(IPC.connectorsConnect, (_event, toolkit: string) =>
    connectorsManager.connect(toolkit)
  )
  ipcMain.handle(IPC.connectorsDisconnect, (_event, toolkit: string) =>
    connectorsManager.disconnect(toolkit)
  )

  ipcMain.handle(IPC.channelState, () => channelService.getState())
  ipcMain.handle(IPC.channelUpsert, (_event, input: ChannelInput) =>
    channelService.upsert(input)
  )
  ipcMain.handle(IPC.channelRemove, (_event, id: string) => channelService.remove(id))
  ipcMain.handle(IPC.channelRestart, () => channelService.restart())

  ipcMain.handle(IPC.subAgentsList, () => subAgentService.list())
  ipcMain.handle(IPC.subAgentsSpecialists, () => CREW_SPECIALISTS)
  ipcMain.handle(IPC.atroposResolveAwakeable, (_event, id: string, result: unknown) =>
    awakeableManager.resolve(id, result)
  )
  ipcMain.handle(IPC.atroposRejectAwakeable, (_event, id: string, error: string) =>
    awakeableManager.reject(id, error)
  )

  ipcMain.handle(IPC.tableGetState, () => tableService.getState())
  tableService.workStarter = async (proposal) => {
    const task = await store.createTask({
      title: proposal.title,
      objective: `${proposal.summary}\n\nCo-signed at the table by both ${resolveAgentName(store.getPublicSettings().agentName)}s. This task is your desk's side of the joint action.`,
      mode: 'cowork',
      permissionMode: 'manual'
    })
    await agentRuntime.sendMessage({ taskId: task.id, text: task.objective })
    return task.id
  }
  ipcMain.handle(IPC.tableHost, (_event, input: TableHostInput) => tableService.hostTable(input))
  ipcMain.handle(IPC.tableJoin, (_event, input: TableJoinInput) => tableService.joinTable(input))
  ipcMain.handle(IPC.tableSetGoal, (_event, input: TableGoalInput) => tableService.setGoal(input))
  ipcMain.handle(IPC.tablePropose, (_event, input: TableProposalInput) =>
    tableService.propose(input)
  )
  ipcMain.handle(IPC.tableTurnKey, (_event, proposalId: string) => tableService.turnKey(proposalId))
  ipcMain.handle(IPC.tableWithdraw, (_event, proposalId: string) => tableService.withdraw(proposalId))
  ipcMain.handle(IPC.tablePublish, (_event, proposalId: string) => tableService.publish(proposalId))
  ipcMain.handle(IPC.tableMarkDone, (_event, proposalId: string) => tableService.markDone(proposalId))
  ipcMain.handle(IPC.tableLeave, () => tableService.leave())

  ipcMain.handle(IPC.teamPlaybookList, () => teamPlaybookService.list())
  ipcMain.handle(IPC.teamPlaybookGet, (_event, id: string) => teamPlaybookService.get(id))
  ipcMain.handle(IPC.teamPlaybookSave, (_event, pb) => teamPlaybookService.save(pb))
  ipcMain.handle(IPC.teamPlaybookDelete, (_event, id: string) => teamPlaybookService.delete(id))
  ipcMain.handle(IPC.teamPlaybookSnapshot, (_event, input) => teamPlaybookService.snapshotSession(input))
  ipcMain.handle(IPC.teamPlaybookInstantiate, (_event, input) => teamPlaybookService.instantiate(input))

  ipcMain.handle(IPC.proofOfWorkList, (_event, teamSessionId?: string) => proofOfWorkService.listProofs(teamSessionId))
  ipcMain.handle(IPC.proofOfWorkExportCertificate, (_event, input) => proofOfWorkService.exportCertificate(input))
  ipcMain.handle(IPC.proofOfWorkVerifyCertificate, (_event, cert) => proofOfWorkService.verifyCertificate(cert))

  ipcMain.handle(IPC.passportList, () => passportManager.listPassports())
  ipcMain.handle(IPC.passportGet, (_event, agentId: string) => passportManager.getPassport(agentId))
  ipcMain.handle(IPC.passportIssue, (_event, input) => passportManager.issuePassport(input))
  ipcMain.handle(IPC.passportRevoke, (_event, input: { passportId: string; reason: string }) =>
    passportManager.revokePassport(input.passportId, input.reason)
  )
  ipcMain.handle(IPC.passportVerify, (_event, passportId: string) => passportManager.verifyPassport(passportId))

  ipcMain.handle(IPC.mnemeQuery, (_event, q: string) => mnemeGraph.query(q))
  ipcMain.handle(IPC.mnemeSummary, (_event, _ws?: string) => mnemeGraph.getSummary())
  ipcMain.handle(IPC.mnemeSync, (_event, ws?: string) => mnemeGraph.indexDirectory(ws ?? process.cwd()))
  ipcMain.handle(IPC.kubernisInsights, (_event, ws?: string) => kubernisEngine.analyzeWorkspace(ws ?? process.cwd()))

  ipcMain.handle(IPC.harmoniaList, (_event, status?: HarmoniaDecisionStatus) => harmoniaService.listCards(status))
  ipcMain.handle(IPC.harmoniaCreate, (_event, input) => harmoniaService.createCard(input))
  ipcMain.handle(IPC.harmoniaDecide, (_event, input) => harmoniaService.decideCard(input))

  // ROOK & Digital Worker IPC handlers
  ipcMain.handle(IPC.rookStatus, () => rookEngineBridge.getStatus())
  ipcMain.handle(IPC.rookSetPermission, (_event, mode: 'plan' | 'build' | 'yolo') => {
    rookEngineBridge.setPermissionMode(mode)
    return { activeRegime: rookEngineBridge.getPermissionMode() }
  })
  ipcMain.handle(IPC.rookListChangeRequests, () =>
    rookEngineBridge.getKernel().worker.changeRequests.listChangeRequests()
  )
  ipcMain.handle(IPC.rookReviewChangeRequest, (_event, id: string, decision: 'approved' | 'rejected') =>
    rookEngineBridge.getKernel().worker.changeRequests.reviewChangeRequest(id, decision)
  )
  ipcMain.handle(IPC.rookApplyChangeRequest, (_event, id: string) =>
    rookEngineBridge.getKernel().worker.changeRequests.applyChangeRequest(id)
  )
  ipcMain.handle(IPC.rookListDeliverables, () =>
    rookEngineBridge.getKernel().worker.getDeliverables()
  )
  ipcMain.handle(IPC.rookListPendingGates, () =>
    rookEngineBridge.getKernel().worker.gate.getPendingGates()
  )
  ipcMain.handle(IPC.rookResolveGate, (_event, id: string, response: { selectedOption?: string; userAnswer?: string }) =>
    rookEngineBridge.getKernel().worker.gate.resolveGate(id, response)
  )
  ipcMain.handle(IPC.rookSynthesizeResearch, (_event, topic: string, sources: Array<{ title: string; url: string; snippet: string }>) => {
    const report = rookEngineBridge.synthesizeResearch(topic, sources)
    const markdown = rookEngineBridge.getKernel().worker.research.formatMarkdownReport(report)
    return { report, markdown }
  })

  // Promey Proactive Duet IPC handlers
  ipcMain.handle(IPC.promeyStatus, () => promeyEngineBridge.getStatus())
  ipcMain.handle(IPC.promeyGenerateBrief, (_event, userName?: string, workspaceName?: string) =>
    promeyEngineBridge.generateMorningBrief(userName, workspaceName)
  )
  ipcMain.handle(IPC.promeyListTriage, () =>
    promeyEngineBridge.getKernel().triage.listItems()
  )
  ipcMain.handle(IPC.promeyIngestTriage, (_event, item) =>
    promeyEngineBridge.triageStream(item)
  )
  ipcMain.handle(IPC.promeyTriageItem, (_event, item) =>
    promeyEngineBridge.triageStream(item)
  )
  ipcMain.handle(IPC.promeyResolveTriage, (_event, id: string, note?: string) =>
    promeyEngineBridge.getKernel().triage.resolveItem(id, note)
  )
  ipcMain.handle(IPC.promeyListApprovals, () =>
    promeyEngineBridge.getKernel().approvals.listAll()
  )
  ipcMain.handle(IPC.promeySubmitApproval, (_event, id: string, decision: any, note?: string) =>
    promeyEngineBridge.submitApprovalDecision(id, decision, note)
  )
  ipcMain.handle(IPC.promeyListRoutines, () =>
    promeyEngineBridge.getKernel().routines.listRoutines()
  )
  ipcMain.handle(IPC.promeyToggleRoutine, (_event, id: string, active: boolean) =>
    promeyEngineBridge.getKernel().routines.toggleRoutine(id, active)
  )
  ipcMain.handle(IPC.promeySanitize, (_event, text: string) =>
    promeyEngineBridge.sanitizeOutbound(text)
  )

  // Cowork IPC handlers
  ipcMain.handle(IPC.coworkStatus, () => coworkEngineBridge.getStatus())
  ipcMain.handle(IPC.coworkSearchSkills, (_event, query: string) =>
    coworkEngineBridge.getRegistry().searchSkills(query)
  )
  ipcMain.handle(IPC.coworkEnterpriseSummary, () =>
    coworkEngineBridge.getEnterprise().getSummary()
  )
  ipcMain.handle(IPC.coworkIssuePassport, (_event, principal: string) =>
    coworkEngineBridge.getEnterprise().passport.issuePassport(principal)
  )
  ipcMain.handle(IPC.coworkGetBlastRadius, () =>
    coworkEngineBridge.getEnterprise().blastRadius.getBudgetStatus()
  )
  ipcMain.handle(IPC.coworkListProofs, () =>
    coworkEngineBridge.getEnterprise().verifier.listProofs()
  )
  ipcMain.handle(IPC.coworkListRules, () =>
    coworkEngineBridge.getEnterprise().evolution.listAllRules()
  )

  registerBackendIpc()
  registerAuditIpc()
  registerEnterpriseIpc()
  registerEnterpriseControlIpc()
  registerRsiralsIpc()
}

async function safeArtifactPath(taskId: string, relPath: string): Promise<string> {
  const task = store.getTask(taskId)
  if (!task) throw new Error('Task not found.')
  // Real-path checking as well as lexical: a symlink inside the workspace must
  // not hand `shell.openPath` a target that lives outside it.
  return resolveSafePath([taskWorkspace(taskId)], relPath, { mode: 'read' })
}

/** Knowledge proposal ids are minted in the main process as `kn-` plus a
 *  CSPRNG token. Accepting only that shape is what stops a decision call from
 *  addressing anything other than one proposal row: no store key, no path, no
 *  wildcard. */
const KNOWLEDGE_PROPOSAL_ID = /^kn-[A-Za-z0-9_-]{4,64}$/

/** The stored row carries the document's distilled procedure and the distiller
 *  note (which names the harness the pass ran through). Neither belongs in a
 *  decision list, so the view drops both and keeps only what the decision needs. */
function knowledgeProposalViews(list: KnowledgeProposal[]): KnowledgeProposalView[] {
  return list.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    dataHandling: proposal.dataHandling,
    endpointClass: proposal.providerInfo?.endpointClass ?? null,
    sourceName: proposal.provenance.sourceName,
    sourceSha256: proposal.provenance.sourceSha256,
    byteLength: proposal.provenance.byteLength,
    distilledAt: proposal.provenance.distilledAt,
    distiller: proposal.distiller.kind,
    status: proposal.status,
    decidedBy: proposal.decidedBy,
    decidedAt: proposal.decidedAt
  }))
}
