import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ApprovalRequest,
  ApprovalDecision,
  ChannelInput,
  ComposioInput,
  CreateScheduleInput,
  CreateTaskInput,
  KnightApi,
  McpServerConfig,
  MemoryInput,
  ProviderInput,
  SendMessageInput,
  SettingsPatch,
  SkillDraft,
  SkillRegistry,
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
  addFolder: (id: string) => ipcRenderer.invoke(IPC.taskAddFolder, id),
  removeFolder: (id: string, folder: string) =>
    ipcRenderer.invoke(IPC.taskRemoveFolder, id, folder),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),

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
  searchSkills: (query: string, registry?: SkillRegistry) =>
    ipcRenderer.invoke(IPC.skillsSearch, query, registry),
  installSkill: (ref: string, registry?: SkillRegistry) =>
    ipcRenderer.invoke(IPC.skillsInstall, ref, registry),
  readSkill: (id: string) => ipcRenderer.invoke(IPC.skillsRead, id),
  createSkill: (draft: SkillDraft) => ipcRenderer.invoke(IPC.skillsCreate, draft),
  removeSkill: (id: string) => ipcRenderer.invoke(IPC.skillsRemove, id),

  listMemories: () => ipcRenderer.invoke(IPC.memoryList),
  addMemory: (input: MemoryInput) => ipcRenderer.invoke(IPC.memoryAdd, input),
  removeMemory: (id: string) => ipcRenderer.invoke(IPC.memoryRemove, id),
  importMemories: (text: string) => ipcRenderer.invoke(IPC.memoryImport, text),

  getUsageSummary: () => ipcRenderer.invoke(IPC.usageSummary),

  composioState: (refresh?: boolean) => ipcRenderer.invoke(IPC.composioState, refresh),
  saveComposio: (input: ComposioInput) => ipcRenderer.invoke(IPC.composioSave, input),

  channelState: () => ipcRenderer.invoke(IPC.channelState),
  upsertChannel: (input: ChannelInput) => ipcRenderer.invoke(IPC.channelUpsert, input),
  removeChannel: (id: string) => ipcRenderer.invoke(IPC.channelRemove, id),
  restartChannels: () => ipcRenderer.invoke(IPC.channelRestart),

  listSubAgents: () => ipcRenderer.invoke(IPC.subAgentsList),

  showBrowser: (taskId: string) => ipcRenderer.invoke(IPC.browserShow, taskId),

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
  }
}

contextBridge.exposeInMainWorld('knight', api)
