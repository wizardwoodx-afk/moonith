import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import { AUDIT_IPC, type AuditEventQuery } from '@shared/audit'
import { GOVERNANCE_IPC, type SensitiveDataCategory } from '@shared/governance'
import {
  ENTERPRISE_CONTROL_IPC,
  type EnterpriseAuthorization,
  type EnterpriseControlMutation
} from '@shared/enterpriseControl'
import { RSIRALS_IPC } from '@shared/rsirals'
import type { LibraryPageInput, LibraryPagePatch } from '@shared/library'
import type { MarketspaceCreateInput } from '@shared/marketspace'
import type {
  ApprovalRequest,
  ApprovalDecision,
  AuditExportResult,
  AuditSummary,
  AuditVerifyResult,
  BackendEvent,
  BackendSettingsPublic,
  ChannelInput,
  ConnectorsInput,
  CreateScheduleInput,
  CreateTaskInput,
  KnightApi,
  McpServerConfig,
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
  TaskEvent,
  UpdateTaskInput
} from '@shared/types'

const api: KnightApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsSave, patch),
  testProvider: (input: ProviderInput) => ipcRenderer.invoke(IPC.providerTest, input),
  fetchModels: (input: ProviderInput) => ipcRenderer.invoke(IPC.providerFetchModels, input),

  listTasks: () => ipcRenderer.invoke(IPC.tasksList),
  createTask: (input: CreateTaskInput) => ipcRenderer.invoke(IPC.taskCreate, input),
  getTask: (id: string) => ipcRenderer.invoke(IPC.taskGet, id),
  deleteTask: (id: string) => ipcRenderer.invoke(IPC.taskDelete, id),
  sendMessage: (input: SendMessageInput) => ipcRenderer.invoke(IPC.taskSend, input),
  steerTask: (input: SendMessageInput) => ipcRenderer.invoke(IPC.taskSteer, input),
  stopTask: (id: string) => ipcRenderer.invoke(IPC.taskStop, id),
  resumeTask: (id: string) => ipcRenderer.invoke(IPC.taskResume, id),
  updateTask: (input: UpdateTaskInput) => ipcRenderer.invoke(IPC.taskUpdate, input),
  reactToMessage: (input: MessageReactionInput) => ipcRenderer.invoke(IPC.taskReact, input),
  addFolder: (id: string) => ipcRenderer.invoke(IPC.taskAddFolder, id),
  removeFolder: (id: string, folder: string) =>
    ipcRenderer.invoke(IPC.taskRemoveFolder, id, folder),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  attachDroppedFiles: (files: File[]) => {
    // Chromium no longer exposes a reliable File.path. Resolve real dropped
    // File objects inside the sandboxed preload, then let the main process
    // apply the same regular-file validation used by the native picker.
    const paths = files
      .map((file) => {
        try {
          return webUtils.getPathForFile(file)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    return ipcRenderer.invoke(IPC.filesFromDrop, paths)
  },

  respondApproval: (decision: ApprovalDecision) =>
    ipcRenderer.invoke(IPC.approvalRespond, decision),
  openArtifact: (taskId: string, relPath: string) =>
    ipcRenderer.invoke(IPC.artifactOpen, taskId, relPath),
  revealArtifact: (taskId: string, relPath: string) =>
    ipcRenderer.invoke(IPC.artifactReveal, taskId, relPath),

  listSchedules: () => ipcRenderer.invoke(IPC.scheduleList),
  createSchedule: (input: CreateScheduleInput) =>
    ipcRenderer.invoke(IPC.scheduleCreate, input),
  updateSchedule: (id: string, patch: Partial<CreateScheduleInput> & { enabled?: boolean }) =>
    ipcRenderer.invoke(IPC.scheduleUpdate, id, patch),
  deleteSchedule: (id: string) => ipcRenderer.invoke(IPC.scheduleDelete, id),
  runScheduleNow: (id: string) => ipcRenderer.invoke(IPC.scheduleRun, id),

  listMcp: () => ipcRenderer.invoke(IPC.mcpList),
  upsertMcp: (config: McpServerConfig) => ipcRenderer.invoke(IPC.mcpUpsert, config),
  removeMcp: (id: string) => ipcRenderer.invoke(IPC.mcpRemove, id),
  restartMcp: (id?: string) => ipcRenderer.invoke(IPC.mcpRestart, id),
  addReaPreset: () => ipcRenderer.invoke(IPC.mcpReaPreset),

  listSkills: () => ipcRenderer.invoke(IPC.skillsList),
  searchSkills: (query: string, registry?: SkillSource) =>
    ipcRenderer.invoke(IPC.skillsSearch, query, registry),
  installSkill: (ref: string, registry?: SkillSource) =>
    ipcRenderer.invoke(IPC.skillsInstall, ref, registry),
  readSkill: (id: string) => ipcRenderer.invoke(IPC.skillsRead, id),
  createSkill: (draft: SkillDraft) => ipcRenderer.invoke(IPC.skillsCreate, draft),
  removeSkill: (id: string) => ipcRenderer.invoke(IPC.skillsRemove, id),

  marketspaceList: (query?: string) => ipcRenderer.invoke(IPC.marketspaceList, query),
  marketspaceRead: (id: string) => ipcRenderer.invoke(IPC.marketspaceRead, id),
  marketspaceInstall: (id: string) => ipcRenderer.invoke(IPC.marketspaceInstall, id),
  marketspaceCreate: (input: MarketspaceCreateInput) => ipcRenderer.invoke(IPC.marketspaceCreate, input),
  marketspaceRemove: (id: string) => ipcRenderer.invoke(IPC.marketspaceRemove, id),
  marketspaceApply: (taskId: string, id: string, overwrite?: boolean) =>
    ipcRenderer.invoke(IPC.marketspaceApply, taskId, id, overwrite),

  listMemories: () => ipcRenderer.invoke(IPC.memoryList),
  addMemory: (input: MemoryInput) => ipcRenderer.invoke(IPC.memoryAdd, input),
  removeMemory: (id: string) => ipcRenderer.invoke(IPC.memoryRemove, id),
  importMemories: (text: string) => ipcRenderer.invoke(IPC.memoryImport, text),

  getUsageSummary: () => ipcRenderer.invoke(IPC.usageSummary),

  connectorsState: (refresh?: boolean) => ipcRenderer.invoke(IPC.connectorsState, refresh),
  saveConnectors: (input: ConnectorsInput) => ipcRenderer.invoke(IPC.connectorsSave, input),

  channelState: () => ipcRenderer.invoke(IPC.channelState),
  upsertChannel: (input: ChannelInput) => ipcRenderer.invoke(IPC.channelUpsert, input),
  removeChannel: (id: string) => ipcRenderer.invoke(IPC.channelRemove, id),
  restartChannels: () => ipcRenderer.invoke(IPC.channelRestart),

  listSubAgents: () => ipcRenderer.invoke(IPC.subAgentsList),

  showBrowser: (taskId: string, scope?: string) => ipcRenderer.invoke(IPC.browserShow, taskId, scope),
  getBrowserStatus: () => ipcRenderer.invoke(IPC.browserStatus),

  librarySnapshot: () => ipcRenderer.invoke(IPC.librarySnapshot),
  libraryCreateCollection: (name: string) => ipcRenderer.invoke(IPC.libraryCollectionCreate, name),
  libraryCreatePage: (input: LibraryPageInput) => ipcRenderer.invoke(IPC.libraryPageCreate, input),
  libraryUpdatePage: (id: string, patch: LibraryPagePatch) =>
    ipcRenderer.invoke(IPC.libraryPageUpdate, id, patch),
  libraryDeletePage: (id: string) => ipcRenderer.invoke(IPC.libraryPageDelete, id),
  onLibraryChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.eventLibrary, listener)
    return () => ipcRenderer.removeListener(IPC.eventLibrary, listener)
  },

  tableGetState: () => ipcRenderer.invoke(IPC.tableGetState),
  tableHost: (input: TableHostInput) => ipcRenderer.invoke(IPC.tableHost, input),
  tableJoin: (input: TableJoinInput) => ipcRenderer.invoke(IPC.tableJoin, input),
  tableSetGoal: (input: TableGoalInput) => ipcRenderer.invoke(IPC.tableSetGoal, input),
  tablePropose: (input: TableProposalInput) => ipcRenderer.invoke(IPC.tablePropose, input),
  tableTurnKey: (proposalId: string) => ipcRenderer.invoke(IPC.tableTurnKey, proposalId),
  tableWithdraw: (proposalId: string) => ipcRenderer.invoke(IPC.tableWithdraw, proposalId),
  tablePublish: (proposalId: string) => ipcRenderer.invoke(IPC.tablePublish, proposalId),
  tableLeave: () => ipcRenderer.invoke(IPC.tableLeave),

  onTaskEvent: (cb: (event: TaskEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TaskEvent): void => cb(payload)
    ipcRenderer.on(IPC.eventTask, listener)
    return () => ipcRenderer.removeListener(IPC.eventTask, listener)
  },
  onApprovalRequest: (cb: (request: ApprovalRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ApprovalRequest): void =>
      cb(payload)
    ipcRenderer.on(IPC.eventApproval, listener)
    return () => ipcRenderer.removeListener(IPC.eventApproval, listener)
  },

  auditSummary: () => ipcRenderer.invoke(AUDIT_IPC.summary),
  auditEvents: (query?: AuditEventQuery) => ipcRenderer.invoke(AUDIT_IPC.events, query),
  auditExport: () => ipcRenderer.invoke(AUDIT_IPC.export),
  auditVerify: () => ipcRenderer.invoke(AUDIT_IPC.verify),
  inspectDlp: (text: string, categories?: SensitiveDataCategory[]) =>
    ipcRenderer.invoke(GOVERNANCE_IPC.inspect, text, categories),
  rsiralsSnapshot: () => ipcRenderer.invoke(RSIRALS_IPC.snapshot),
  enterpriseControl: {
    snapshot: () => ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.snapshot),
    mutate: (mutation: EnterpriseControlMutation) =>
      ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.mutate, mutation),
    authorize: (request: EnterpriseAuthorization) =>
      ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.authorize, request),
    revision: (revision: number) => ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.revision, revision)
  },

  backend: {
    settings: () => ipcRenderer.invoke(IPC.backendSettingsGet),
    saveSettings: (patch: Partial<BackendSettingsPublic>) =>
      ipcRenderer.invoke(IPC.backendSettingsSave, patch),
    credits: () => ipcRenderer.invoke(IPC.backendCredits),
    themes: () => ipcRenderer.invoke(IPC.backendThemes),
    modes: () => ipcRenderer.invoke(IPC.backendModes),
    providers: () => ipcRenderer.invoke(IPC.backendProviders),
    tiers: () => ipcRenderer.invoke(IPC.backendTiers),
    listMemories: () => ipcRenderer.invoke(IPC.backendMemoryList),
    addMemory: (input: { text: string; scope?: string; tags?: string[] }) =>
      ipcRenderer.invoke(IPC.backendMemoryAdd, input),
    removeMemory: (id: string) => ipcRenderer.invoke(IPC.backendMemoryRemove, id),
    importMemories: (text: string) => ipcRenderer.invoke(IPC.backendMemoryImport, text),
    usage: () => ipcRenderer.invoke(IPC.backendUsageSummary),
    startGateway: () => ipcRenderer.invoke(IPC.backendGatewayStart),
    stopGateway: () => ipcRenderer.invoke(IPC.backendGatewayStop),
    gatewayStatus: () => ipcRenderer.invoke(IPC.backendGatewayStatus),
    gatewayToken: () => ipcRenderer.invoke(IPC.backendGatewayToken),
    subscriptionStatus: () => ipcRenderer.invoke(IPC.backendSubscriptionAccountStatus),
    subscriptionModels: () => ipcRenderer.invoke(IPC.backendSubscriptionAccountModels),
    workStatus: () => ipcRenderer.invoke(IPC.backendWorkStatus),
    workBeginSignIn: (clientId?: string) =>
      ipcRenderer.invoke(IPC.backendWorkBeginSignIn, clientId),
    workCompleteSignIn: () => ipcRenderer.invoke(IPC.backendWorkCompleteSignIn),
    workDisconnect: () => ipcRenderer.invoke(IPC.backendWorkDisconnect),
    workFiles: () => ipcRenderer.invoke(IPC.backendWorkFiles),
    workMail: () => ipcRenderer.invoke(IPC.backendWorkMail),
    computerStatus: () => ipcRenderer.invoke(IPC.backendComputerStatus),
    groundedActionsStatus: () => ipcRenderer.invoke(IPC.backendGroundedActionsStatus),
    marketplaceSearch: (query: string) => ipcRenderer.invoke(IPC.backendMarketplaceSearch, query),
    marketplaceInstall: (id: string) => ipcRenderer.invoke(IPC.backendMarketplaceInstall, id),
    registrySearch: (query: string) => ipcRenderer.invoke(IPC.backendRegistrySearch, query),
    openClawStatus: () => ipcRenderer.invoke(IPC.backendExternalAgentStatus),
    answerPermission: (id: string, allowed: boolean) =>
      ipcRenderer.invoke(IPC.backendPermissionAnswer, id, allowed),
    onEvent: (cb: (event: BackendEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: BackendEvent): void =>
        cb(payload)
      ipcRenderer.on(IPC.eventBackend, listener)
      return () => ipcRenderer.removeListener(IPC.eventBackend, listener)
    }
  }
}

contextBridge.exposeInMainWorld('knight', api)
