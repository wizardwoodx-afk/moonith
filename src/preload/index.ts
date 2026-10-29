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
import { AION_IPC, NOMOS_IPC, SPHRAGIS_IPC } from '@shared/enterprise'
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
  EditMessageInput,
  EngineStatusPublic,
  HarmoniaDecisionInput,
  HarmoniaDecisionStatus,
  ImpCodesAccess,
  ImpCodesImportResult,
  KnowledgeDecideResult,
  KnowledgeDecisionInput,
  KnowledgeProposalView,
  KnightApi,
  McpServerConfig,
  MemoryInput,
  MessageFeedbackInput,
  MessageReactionInput,
  PastedImageInput,
  ProviderInput,
  SecurityPosture,
  SendMessageInput,
  SettingsPatch,
  SkillDraft,
  SkillSource,
  TableGoalInput,
  TableHostInput,
  TableJoinInput,
  TableProposalInput,
  TaskCompactInput,
  TaskCompactResult,
  TaskEvent,
  UpdateTaskInput
} from '@shared/types'

const api: KnightApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsSave, patch),
  testProvider: (input: ProviderInput) => ipcRenderer.invoke(IPC.providerTest, input),
  fetchModels: (input: ProviderInput) => ipcRenderer.invoke(IPC.providerFetchModels, input),
  getImpCodesAccess: (): Promise<ImpCodesAccess> => ipcRenderer.invoke(IPC.impCodesAccess),
  importImpCodesAccess: (): Promise<ImpCodesImportResult> => ipcRenderer.invoke(IPC.impCodesImport),
  getSecurityPosture: (): Promise<SecurityPosture> => ipcRenderer.invoke(IPC.securityPosture),
  getEngineStatus: (): Promise<EngineStatusPublic> => ipcRenderer.invoke(IPC.engineStatus),

  listTasks: () => ipcRenderer.invoke(IPC.tasksList),
  createTask: (input: CreateTaskInput) => ipcRenderer.invoke(IPC.taskCreate, input),
  getTask: (id: string) => ipcRenderer.invoke(IPC.taskGet, id),
  deleteTask: (id: string) => ipcRenderer.invoke(IPC.taskDelete, id),
  sendMessage: (input: SendMessageInput) => ipcRenderer.invoke(IPC.taskSend, input),
  steerTask: (input: SendMessageInput) => ipcRenderer.invoke(IPC.taskSteer, input),
  editMessage: (input: EditMessageInput) => ipcRenderer.invoke(IPC.taskEditMessage, input),
  stopTask: (id: string) => ipcRenderer.invoke(IPC.taskStop, id),
  resumeTask: (id: string) => ipcRenderer.invoke(IPC.taskResume, id),
  updateTask: (input: UpdateTaskInput) => ipcRenderer.invoke(IPC.taskUpdate, input),
  compactTask: (input: TaskCompactInput) => ipcRenderer.invoke(IPC.taskCompact, input),
  reactToMessage: (input: MessageReactionInput) => ipcRenderer.invoke(IPC.taskReact, input),
  rateMessage: (input: MessageFeedbackInput) => ipcRenderer.invoke(IPC.taskFeedback, input),
  addFolder: (id: string) => ipcRenderer.invoke(IPC.taskAddFolder, id),
  removeFolder: (id: string, folder: string) =>
    ipcRenderer.invoke(IPC.taskRemoveFolder, id, folder),
  listChanges: (id: string) => ipcRenderer.invoke(IPC.taskChangesList, id),
  revertChanges: (id: string, toStep?: string) => ipcRenderer.invoke(IPC.taskRevert, id, toStep),
  redoChanges: (id: string, toStep?: string) => ipcRenderer.invoke(IPC.taskRedo, id, toStep),
  listSteps: (id: string) => ipcRenderer.invoke(IPC.taskStepsList, id),
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
  attachPastedImage: (input: PastedImageInput) => ipcRenderer.invoke(IPC.filesFromClipboard, input),
  captureScreen: (taskId?: string) => ipcRenderer.invoke(IPC.screenCapture, taskId),

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
  searchMcpMarket: (query: string) => ipcRenderer.invoke(IPC.mcpMarketSearch, query),
  readMcpMarket: (id: string) => ipcRenderer.invoke(IPC.mcpMarketRead, id),
  installMcpMarket: (id: string) => ipcRenderer.invoke(IPC.mcpMarketInstall, id),

  listAgentTools: () => ipcRenderer.invoke(IPC.agentToolsList),
  listSkills: () => ipcRenderer.invoke(IPC.skillsList),
  searchSkills: (query: string, registry?: SkillSource) =>
    ipcRenderer.invoke(IPC.skillsSearch, query, registry),
  installSkill: (ref: string, registry?: SkillSource) =>
    ipcRenderer.invoke(IPC.skillsInstall, ref, registry),
  readSkill: (id: string) => ipcRenderer.invoke(IPC.skillsRead, id),
  createSkill: (draft: SkillDraft) => ipcRenderer.invoke(IPC.skillsCreate, draft),
  removeSkill: (id: string) => ipcRenderer.invoke(IPC.skillsRemove, id),

  knowledgeList: (): Promise<KnowledgeProposalView[]> => ipcRenderer.invoke(IPC.knowledgeList),
  knowledgeDecide: (input: KnowledgeDecisionInput): Promise<KnowledgeDecideResult> =>
    ipcRenderer.invoke(IPC.knowledgeDecide, input),

  marketspaceList: (query?: string) => ipcRenderer.invoke(IPC.marketspaceList, query),
  marketspaceRead: (id: string) => ipcRenderer.invoke(IPC.marketspaceRead, id),
  marketspaceInstall: (id: string) => ipcRenderer.invoke(IPC.marketspaceInstall, id),
  marketspaceCreate: (input: MarketspaceCreateInput) =>
    ipcRenderer.invoke(IPC.marketspaceCreate, input),
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
  connectConnectors: (toolkit: string) => ipcRenderer.invoke(IPC.connectorsConnect, toolkit),
  disconnectConnectors: (toolkit: string) =>
    ipcRenderer.invoke(IPC.connectorsDisconnect, toolkit),

  channelState: () => ipcRenderer.invoke(IPC.channelState),
  upsertChannel: (input: ChannelInput) => ipcRenderer.invoke(IPC.channelUpsert, input),
  removeChannel: (id: string) => ipcRenderer.invoke(IPC.channelRemove, id),
  restartChannels: () => ipcRenderer.invoke(IPC.channelRestart),

  listSubAgents: () => ipcRenderer.invoke(IPC.subAgentsList),
  listSpecialists: () => ipcRenderer.invoke(IPC.subAgentsSpecialists),
  resolveAwakeable: (id: string, result: unknown) =>
    ipcRenderer.invoke(IPC.atroposResolveAwakeable, id, result),
  rejectAwakeable: (id: string, error: string) =>
    ipcRenderer.invoke(IPC.atroposRejectAwakeable, id, error),

  showBrowser: (taskId: string, scope?: string) => ipcRenderer.invoke(IPC.browserShow, taskId, scope),

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
  tableMarkDone: (proposalId: string) => ipcRenderer.invoke(IPC.tableMarkDone, proposalId),
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
  rsiralsOctaStatus: () => ipcRenderer.invoke(RSIRALS_IPC.octaStatus),
  rsiralsFastLoop: (action: unknown, context?: unknown) => ipcRenderer.invoke(RSIRALS_IPC.executeFastLoop, action, context),
  rsiralsDiagnose: (trace: unknown, failure: unknown) => ipcRenderer.invoke(RSIRALS_IPC.diagnoseFailure, trace, failure),
  rsiralsInduceSkill: (req: unknown) => ipcRenderer.invoke(RSIRALS_IPC.induceSkill, req),
  rsiralsPublishClaim: (params: unknown) => ipcRenderer.invoke(RSIRALS_IPC.publishClaim, params),
  rsiralsAcquireCharter: (params: unknown) => ipcRenderer.invoke(RSIRALS_IPC.acquireCharter, params),
  rsiralsMetaEvolve: (candidate: unknown, evidence: unknown) => ipcRenderer.invoke(RSIRALS_IPC.metaEvolve, candidate, evidence),
  enterpriseControl: {
    snapshot: () => ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.snapshot),
    mutate: (mutation: EnterpriseControlMutation) =>
      ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.mutate, mutation),
    authorize: (request: EnterpriseAuthorization) =>
      ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.authorize, request),
    revision: (revision: number) => ipcRenderer.invoke(ENTERPRISE_CONTROL_IPC.revision, revision)
  },

  /* ── Nomos: the governance gate ─────────────────────────────────────────── */
  governanceSummary: () => ipcRenderer.invoke(NOMOS_IPC.summary),
  governanceRecent: (limit?: number) => ipcRenderer.invoke(NOMOS_IPC.recent, limit),
  governanceEngageKill: (reason: string) => ipcRenderer.invoke(NOMOS_IPC.kill, { reason }),
  governanceReleaseKill: () => ipcRenderer.invoke(NOMOS_IPC.release),

  /* ── Sphragis: the signed receipt chain ─────────────────────────────────── */
  receiptSummary: () => ipcRenderer.invoke(SPHRAGIS_IPC.summary),
  receiptRecent: (limit?: number) => ipcRenderer.invoke(SPHRAGIS_IPC.recent, limit),
  receiptVerify: () => ipcRenderer.invoke(SPHRAGIS_IPC.verify),

  /* ── Aion: the durable missions ─────────────────────────────────────────── */
  missionList: () => ipcRenderer.invoke(AION_IPC.list),
  missionGet: (missionId: string) => ipcRenderer.invoke(AION_IPC.get, missionId),
  missionApprove: (input: {
    missionId: string
    approve: boolean
    by: string
    note?: string
  }) => ipcRenderer.invoke(AION_IPC.approve, input),
  missionCancel: (missionId: string) => ipcRenderer.invoke(AION_IPC.cancel, missionId),
  missionResume: (missionId: string) => ipcRenderer.invoke(AION_IPC.resume, missionId),
  missionReconcile: (missionId: string, resolution?: 'done' | 'failed') =>
    ipcRenderer.invoke(AION_IPC.reconcile, { missionId, resolution }),
  missionStartRepoScan: (root: string) => ipcRenderer.invoke(AION_IPC.startRepoScan, { root }),

  /* ── Team Playbooks & Proof of Work ─────────────────────────────────────── */
  teamPlaybookList: () => ipcRenderer.invoke(IPC.teamPlaybookList),
  teamPlaybookGet: (id: string) => ipcRenderer.invoke(IPC.teamPlaybookGet, id),
  teamPlaybookSave: (playbook: any) => ipcRenderer.invoke(IPC.teamPlaybookSave, playbook),
  teamPlaybookDelete: (id: string) => ipcRenderer.invoke(IPC.teamPlaybookDelete, id),
  teamPlaybookSnapshot: (input: any) => ipcRenderer.invoke(IPC.teamPlaybookSnapshot, input),
  teamPlaybookInstantiate: (input: any) => ipcRenderer.invoke(IPC.teamPlaybookInstantiate, input),

  proofOfWorkList: (teamSessionId?: string) => ipcRenderer.invoke(IPC.proofOfWorkList, teamSessionId),
  proofOfWorkExportCertificate: (input: any) => ipcRenderer.invoke(IPC.proofOfWorkExportCertificate, input),
  proofOfWorkVerifyCertificate: (certificate: any) => ipcRenderer.invoke(IPC.proofOfWorkVerifyCertificate, certificate),

  /* ── Diabaterion: Agent Passport System ─────────────────────────────────── */
  passportList: () => ipcRenderer.invoke(IPC.passportList),
  passportGet: (agentId: string) => ipcRenderer.invoke(IPC.passportGet, agentId),
  passportIssue: (input: any) => ipcRenderer.invoke(IPC.passportIssue, input),
  passportRevoke: (input: any) => ipcRenderer.invoke(IPC.passportRevoke, input),
  passportVerify: (passportId: string) => ipcRenderer.invoke(IPC.passportVerify, passportId),

  /* ── Mneme & Kubernis: Local Knowledge Graph & Proactivity ──────────────── */
  mnemeQuery: (query: string) => ipcRenderer.invoke(IPC.mnemeQuery, query),
  mnemeSummary: (workspacePath?: string) => ipcRenderer.invoke(IPC.mnemeSummary, workspacePath),
  mnemeSync: (workspacePath?: string) => ipcRenderer.invoke(IPC.mnemeSync, workspacePath),
  kubernisInsights: (workspacePath?: string) => ipcRenderer.invoke(IPC.kubernisInsights, workspacePath),

  /* ── Harmonia: Executive Decision Card Feed (Open-Duet Model) ───────────── */
  harmoniaList: (status?: HarmoniaDecisionStatus) => ipcRenderer.invoke(IPC.harmoniaList, status),
  harmoniaCreate: (input: HarmoniaDecisionInput) => ipcRenderer.invoke(IPC.harmoniaCreate, input),
  harmoniaDecide: (input: { cardId: string; decision: 'accept' | 'reject'; comment?: string }) =>
    ipcRenderer.invoke(IPC.harmoniaDecide, input),

  /* ── ROOK: Unified Dual-Engine & Digital Worker ──────────────────────────── */
  rookStatus: () => ipcRenderer.invoke(IPC.rookStatus),
  rookSetPermission: (mode: 'plan' | 'build' | 'yolo') => ipcRenderer.invoke(IPC.rookSetPermission, mode),
  rookListChangeRequests: () => ipcRenderer.invoke(IPC.rookListChangeRequests),
  rookReviewChangeRequest: (id: string, decision: 'approved' | 'rejected') =>
    ipcRenderer.invoke(IPC.rookReviewChangeRequest, id, decision),
  rookApplyChangeRequest: (id: string) => ipcRenderer.invoke(IPC.rookApplyChangeRequest, id),
  rookListDeliverables: () => ipcRenderer.invoke(IPC.rookListDeliverables),
  rookListPendingGates: () => ipcRenderer.invoke(IPC.rookListPendingGates),
  rookResolveGate: (id: string, response: { selectedOption?: string; userAnswer?: string }) =>
    ipcRenderer.invoke(IPC.rookResolveGate, id, response),
  rookSynthesizeResearch: (topic: string, sources: Array<{ title: string; url: string; snippet: string }>) =>
    ipcRenderer.invoke(IPC.rookSynthesizeResearch, topic, sources),

  /* ── Promey: Proactive Executive Duet Substrate ──────────────────────────── */
  promeyStatus: () => ipcRenderer.invoke(IPC.promeyStatus),
  promeyGenerateBrief: (userName?: string, workspaceName?: string) =>
    ipcRenderer.invoke(IPC.promeyGenerateBrief, userName, workspaceName),
  promeyListTriage: () => ipcRenderer.invoke(IPC.promeyListTriage),
  promeyIngestTriage: (item: any) => ipcRenderer.invoke(IPC.promeyIngestTriage, item),
  promeyTriageItem: (item: any) => ipcRenderer.invoke(IPC.promeyTriageItem, item),
  promeyResolveTriage: (id: string, note?: string) =>
    ipcRenderer.invoke(IPC.promeyResolveTriage, id, note),
  promeyListApprovals: () => ipcRenderer.invoke(IPC.promeyListApprovals),
  promeySubmitApproval: (id: string, decision: any, note?: string) =>
    ipcRenderer.invoke(IPC.promeySubmitApproval, id, decision, note),
  promeyListRoutines: () => ipcRenderer.invoke(IPC.promeyListRoutines),
  promeyToggleRoutine: (id: string, active: boolean) =>
    ipcRenderer.invoke(IPC.promeyToggleRoutine, id, active),
  promeySanitize: (text: string) => ipcRenderer.invoke(IPC.promeySanitize, text),

  /* ── Cowork: Subsystem & Lobe Skills ─────────────────────────────────────── */
  coworkStatus: () => ipcRenderer.invoke(IPC.coworkStatus),
  coworkSearchSkills: (query: string) => ipcRenderer.invoke(IPC.coworkSearchSkills, query),
  coworkEnterpriseSummary: () => ipcRenderer.invoke(IPC.coworkEnterpriseSummary),
  coworkIssuePassport: (principal: string) => ipcRenderer.invoke(IPC.coworkIssuePassport, principal),
  coworkGetBlastRadius: () => ipcRenderer.invoke(IPC.coworkGetBlastRadius),
  coworkListProofs: () => ipcRenderer.invoke(IPC.coworkListProofs),
  coworkListRules: () => ipcRenderer.invoke(IPC.coworkListRules),

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
    externalAgentStatus: () => ipcRenderer.invoke(IPC.backendExternalAgentStatus),
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

contextBridge.exposeInMainWorld('selfimpulse', api)
contextBridge.exposeInMainWorld('knight', api)
