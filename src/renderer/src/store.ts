import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  ApprovalRequest,
  Artifact,
  AttachmentRef,
  CreateTaskInput,
  MessageVote,
  PermissionMode,
  PublicSettings,
  SettingsPatch,
  SubAgentRun,
  Task,
  TaskEvent,
  TaskMode,
  TaskSummary
} from '@shared/types'
import { errorMessage } from './lib/utils'
import { getLocalProfile, hasLocalProfile, saveLocalProfile } from './lib/localProfile'
import type { SettingsPaneId } from './lib/settingsNav'
import type { Surface } from './shell/surfaces'

export type SettingsTab = SettingsPaneId
export type View =
  | { kind: 'surface'; surface: Surface }
  | { kind: 'task'; taskId: string }
  | { kind: 'settings'; tab: SettingsTab }
  | { kind: 'schedules' }
  | { kind: 'promey' }

export interface StartTaskRequest {
  text: string
  mode: TaskMode
  permissionMode: PermissionMode
  folders: string[]
  attachments: AttachmentRef[]
  providerId?: string
  model?: string
}

interface AppState {
  ready: boolean
  fatalError: string | null
  settings: PublicSettings | null
  tasks: TaskSummary[]
  subagents: SubAgentRun[]
  currentTask: Task | null
  view: View
  approval: ApprovalRequest | null
  panelOpen: boolean
  preview: Artifact | null

  bootstrap: () => Promise<void>
  goHome: () => void
  openSurface: (surface: Surface) => void
  openTask: (id: string) => Promise<void>
  openSchedules: () => void
  openPromey: () => void
  openSettings: (tab?: SettingsTab) => void
  refreshTasks: () => Promise<void>
  refreshSettings: () => Promise<PublicSettings | null>
  refreshSubAgents: () => Promise<void>
  startTask: (request: StartTaskRequest) => Promise<void>
  sendToCurrent: (text: string, attachments: AttachmentRef[]) => Promise<void>
  stopCurrent: () => Promise<void>
  resumeCurrent: () => Promise<void>
  reactToMessage: (messageId: string, emoji: string) => Promise<void>
  rateMessage: (messageId: string, vote: MessageVote | null, note?: string) => Promise<void>
  editMessage: (messageId: string, content: string) => Promise<void>
  updateCurrent: (patch: {
    mode?: TaskMode
    permissionMode?: PermissionMode
    agentRole?: Task['agentRole']
    providerId?: string
    model?: string
    title?: string
  }) => Promise<void>
  addFolderToCurrent: () => Promise<void>
  removeFolderFromCurrent: (folder: string) => Promise<void>
  renameTask: (id: string, title: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  saveSettings: (patch: SettingsPatch) => Promise<PublicSettings | null>
  respondApproval: (approved: boolean, always?: boolean) => Promise<void>
  setPanelOpen: (open: boolean) => void
  setPreview: (artifact: Artifact | null) => void
  handleEvent: (event: TaskEvent) => void
  setApproval: (approval: ApprovalRequest | null) => void
}

let bootPromise: Promise<void> | null = null

function summaryFromTask(task: Task): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    objective: task.objective,
    status: task.status,
    mode: task.mode,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    artifactsCount: task.artifacts.length
  }
}

function mergeSummary(tasks: TaskSummary[], task: Task): TaskSummary[] {
  const summary = summaryFromTask(task)
  const next = tasks.filter((item) => item.id !== task.id)
  next.push(summary)
  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  fatalError: null,
  settings: null,
  tasks: [],
  subagents: [],
  currentTask: null,
  view: { kind: 'surface', surface: 'chat' },
  approval: null,
  panelOpen: false,
  preview: null,

  bootstrap: async () => {
    if (bootPromise) return bootPromise
    bootPromise = (async () => {
      try {
        const [settings, tasks, subagents, appInfo] = await Promise.all([
          window.knight.getSettings(),
          window.knight.listTasks(),
          window.knight.listSubAgents().catch(() => [] as SubAgentRun[]),
          window.knight.getAppInfo().catch(() => null)
        ])
        if (appInfo?.userName) {
          const current = getLocalProfile()
          if (!hasLocalProfile() || current.name === 'You') {
            const raw = appInfo.userName.trim()
            const formatted =
              raw.length > 1
                ? raw.charAt(0).toUpperCase() +
                  (raw === raw.toUpperCase() ? raw.slice(1).toLowerCase() : raw.slice(1))
                : raw.toUpperCase()
            saveLocalProfile({ name: formatted })
          }
        }
        set({ settings, tasks, subagents, ready: true })
      } catch (error) {
        set({ fatalError: errorMessage(error), ready: true })
      }
    })()
    return bootPromise
  },

  goHome: () => get().openSurface('chat'),

  openSurface: (surface) =>
    set({ view: { kind: 'surface', surface }, currentTask: null, preview: null }),

  openTask: async (id) => {
    set((state) => ({
      view: { kind: 'task', taskId: id },
      preview: null,
      currentTask: state.currentTask?.id === id ? state.currentTask : null
    }))
    try {
      const task = await window.knight.getTask(id)
      if (!task) {
        toast.error('That task no longer exists.')
        set({ view: { kind: 'surface', surface: 'chat' }, currentTask: null })
        return
      }
      set((state) => ({
        currentTask: task,
        panelOpen: state.currentTask?.id === id ? state.panelOpen : task.artifacts.length > 0
      }))
      void get().refreshSubAgents()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  openSchedules: () => set({ view: { kind: 'schedules' }, currentTask: null }),

  openPromey: () => set({ view: { kind: 'promey' }, currentTask: null }),

  openSettings: (tab = 'general') => set({ view: { kind: 'settings', tab }, currentTask: null }),

  refreshTasks: async () => {
    try {
      const tasks = await window.knight.listTasks()
      set({ tasks })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  refreshSettings: async () => {
    try {
      const settings = await window.knight.getSettings()
      set({ settings })
      return settings
    } catch (error) {
      toast.error(errorMessage(error))
      return null
    }
  },

  refreshSubAgents: async () => {
    try {
      set({ subagents: await window.knight.listSubAgents() })
    } catch {
      /* The list is convenience only; events keep it current. */
    }
  },

  startTask: async (request) => {
    const input: CreateTaskInput = {
      objective: request.text,
      mode: request.mode,
      permissionMode: request.permissionMode,
      folders: request.folders,
      providerId: request.providerId,
      model: request.model
    }
    let task: Task | null = null
    try {
      task = await window.knight.createTask(input)
      set((state) => ({
        currentTask: task,
        view: { kind: 'task', taskId: task!.id },
        tasks: mergeSummary(state.tasks, task!),
        panelOpen: false
      }))
      const updated = await window.knight.sendMessage({
        taskId: task.id,
        text: request.text,
        attachments: request.attachments
      })
      set({ currentTask: updated })
    } catch (error) {
      toast.error(errorMessage(error))
      if (task) {
        try {
          const fresh = await window.knight.getTask(task.id)
          if (fresh) set({ currentTask: fresh })
        } catch {
          /* ignore */
        }
      }
      throw error
    }
  },

  sendToCurrent: async (text, attachments) => {
    const task = get().currentTask
    if (!task) return
    try {
      const active = task.status === 'running' || task.status === 'waiting'
      const updated = active
        ? await window.knight.steerTask({ taskId: task.id, text, attachments })
        : await window.knight.sendMessage({ taskId: task.id, text, attachments })
      set((state) => ({
        currentTask: updated,
        tasks: mergeSummary(state.tasks, updated)
      }))
    } catch (error) {
      toast.error(errorMessage(error))
      throw error
    }
  },

  stopCurrent: async () => {
    const task = get().currentTask
    if (!task) return
    try {
      await window.knight.stopTask(task.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  resumeCurrent: async () => {
    const task = get().currentTask
    if (!task) return
    try {
      await window.knight.resumeTask(task.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  reactToMessage: async (messageId, emoji) => {
    const task = get().currentTask
    if (!task) return
    try {
      const updated = await window.knight.reactToMessage({ taskId: task.id, messageId, emoji })
      set((state) => ({
        currentTask: state.currentTask?.id === updated.id ? updated : state.currentTask,
        tasks: mergeSummary(state.tasks, updated)
      }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  rateMessage: async (messageId, vote, note) => {
    const task = get().currentTask
    if (!task) return
    try {
      const updated = await window.knight.rateMessage({ taskId: task.id, messageId, vote, note })
      set((state) => ({
        currentTask: state.currentTask?.id === updated.id ? updated : state.currentTask,
        tasks: mergeSummary(state.tasks, updated)
      }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  editMessage: async (messageId, content) => {
    const task = get().currentTask
    if (!task) return
    try {
      const updated = await window.knight.editMessage({ taskId: task.id, messageId, content })
      set((state) => ({
        currentTask: state.currentTask?.id === updated.id ? updated : state.currentTask,
        tasks: mergeSummary(state.tasks, updated)
      }))
    } catch (error) {
      toast.error(errorMessage(error))
      throw error
    }
  },

  updateCurrent: async (patch) => {
    const task = get().currentTask
    if (!task) return
    try {
      const updated = await window.knight.updateTask({ taskId: task.id, ...patch })
      set((state) => ({
        currentTask: updated,
        tasks: mergeSummary(state.tasks, updated)
      }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  addFolderToCurrent: async () => {
    const task = get().currentTask
    if (!task) return
    try {
      const result = await window.knight.addFolder(task.id)
      if (result) set({ currentTask: result })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  removeFolderFromCurrent: async (folder) => {
    const task = get().currentTask
    if (!task) return
    try {
      const updated = await window.knight.removeFolder(task.id, folder)
      set({ currentTask: updated })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  renameTask: async (id, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      const updated = await window.knight.updateTask({ taskId: id, title: trimmed })
      set((state) => ({
        tasks: mergeSummary(state.tasks, updated),
        currentTask: state.currentTask?.id === id ? updated : state.currentTask
      }))
      toast.success('Chat renamed.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  deleteTask: async (id) => {
    try {
      await window.knight.deleteTask(id)
      set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id),
        currentTask: state.currentTask?.id === id ? null : state.currentTask,
        view:
          state.currentTask?.id === id
            ? { kind: 'surface', surface: 'chat' }
            : state.view,
        panelOpen: state.currentTask?.id === id ? false : state.panelOpen
      }))
      toast.success('Task deleted.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  saveSettings: async (patch) => {
    try {
      const settings = await window.knight.saveSettings(patch)
      set({ settings })
      return settings
    } catch (error) {
      toast.error(errorMessage(error))
      return null
    }
  },

  respondApproval: async (approved, always) => {
    const approval = get().approval
    if (!approval) return
    set({ approval: null })
    try {
      await window.knight.respondApproval({ id: approval.id, approved, always })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
  setPreview: (artifact) => set({ preview: artifact }),
  setApproval: (approval) => set({ approval }),

  handleEvent: (event) => {
    if (event.type === 'toast') {
      if (event.level === 'error') toast.error(event.message)
      else if (event.level === 'success') toast.success(event.message)
      else toast(event.message)
      return
    }

    if (event.type === 'thinking') {
      set((state) => {
        const task = state.currentTask
        if (!task || task.id !== event.taskId) return state
        const messages = task.messages.map((message) =>
          message.id === event.messageId
            ? { ...message, thinking: (message.thinking ?? '') + event.delta }
            : message
        )
        return { ...state, currentTask: { ...task, messages } }
      })
      return
    }

    if (event.type === 'delta') {
      set((state) => {
        const task = state.currentTask
        if (!task || task.id !== event.taskId) return state
        const messages = task.messages.map((message) =>
          message.id === event.messageId
            ? { ...message, content: message.content + event.delta }
            : message
        )
        return { ...state, currentTask: { ...task, messages } }
      })
      return
    }

    if (event.type === 'artifact') {
      set((state) => {
        const task = state.currentTask
        if (!task || task.id !== event.taskId) return state
        const artifacts = task.artifacts.filter((item) => item.relPath !== event.artifact.relPath)
        artifacts.push(event.artifact)
        return {
          ...state,
          currentTask: { ...task, artifacts },
          panelOpen: true
        }
      })
      return
    }

    if (event.type === 'subagent') {
      set((state) => {
        const isNewRun = !state.subagents.some((run) => run.id === event.run.id)
        const rest = state.subagents.filter((run) => run.id !== event.run.id)
        return {
          subagents: [event.run, ...rest].sort((a, b) =>
            b.startedAt.localeCompare(a.startedAt)
          ),
          // Reveal newly delegated work once. Subsequent step events must not
          // fight a user who intentionally closed the workspace panel.
          panelOpen:
            isNewRun && event.run.status === 'running' && state.currentTask?.id === event.run.taskId
              ? true
              : state.panelOpen
        }
      })
      return
    }

    if (event.type === 'browser') {
      set((state) => {
        const task = state.currentTask
        if (!task || task.id !== event.taskId) return state
        return { ...state, currentTask: { ...task, browser: event.browser } }
      })
      return
    }

    if (event.type === 'status') {
      set((state) => {
        const task = state.currentTask
        if (!task || task.id !== event.taskId) return state
        return { ...state, currentTask: { ...task, status: event.status } }
      })
      return
    }

    if (event.type === 'task') {
      const task = event.task
      set((state) => ({
        ...state,
        tasks: mergeSummary(state.tasks, task),
        currentTask: state.currentTask?.id === task.id ? task : state.currentTask
      }))
    }
  }
}))
