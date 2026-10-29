import { agentName } from '../../lib/localProfile'
import type {
  Artifact,
  PublicSettings,
  Task,
  TaskStatus,
  TaskSummary
} from '@shared/types'

export interface ArtifactRow extends Artifact {
  taskId: string
  taskTitle: string
}

export type ActivityTone = 'active' | 'waiting' | 'done' | 'error' | 'neutral'

export interface ActivityRow {
  id: string
  text: string
  at: string
  tone: ActivityTone
  taskId: string
}

export interface TaskGroup {
  status: TaskStatus
  tasks: TaskSummary[]
}

export interface EngineSummary {
  ready: boolean
  provider: string | null
  model: string | null
  permission: string
  servers: number
}

const GROUP_ORDER: TaskStatus[] = ['running', 'waiting', 'error', 'paused', 'draft', 'done']

const TONE: Record<TaskStatus, ActivityTone> = {
  running: 'active',
  waiting: 'waiting',
  error: 'error',
  paused: 'neutral',
  draft: 'neutral',
  done: 'done'
}

const VERB: Record<TaskStatus, string> = {
  draft: 'Drafted',
  running: `${agentName()} is working on`,
  waiting: 'Waiting on your key for',
  paused: 'Paused',
  done: 'Finished',
  error: 'Needs attention:'
}

export function groupTasks(tasks: TaskSummary[]): TaskGroup[] {
  return GROUP_ORDER.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status)
  })).filter((group) => group.tasks.length > 0)
}

export function collectArtifacts(tasks: Task[]): ArtifactRow[] {
  return tasks
    .flatMap((task) =>
      task.artifacts.map((artifact) => ({
        ...artifact,
        taskId: task.id,
        taskTitle: task.title
      }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function buildActivity(tasks: TaskSummary[], artifacts: ArtifactRow[]): ActivityRow[] {
  const taskRows: ActivityRow[] = tasks.map((task) => ({
    id: `task-${task.id}-${task.updatedAt}`,
    text: `${VERB[task.status]} “${task.title}”.`,
    at: task.updatedAt,
    tone: TONE[task.status],
    taskId: task.id
  }))
  const artifactRows: ActivityRow[] = artifacts.map((artifact) => ({
    id: `artifact-${artifact.id}`,
    text: `Saved ${artifact.name} in “${artifact.taskTitle}”.`,
    at: artifact.createdAt,
    tone: 'neutral',
    taskId: artifact.taskId
  }))
  return [...taskRows, ...artifactRows]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)
}

export function engineSummary(settings: PublicSettings | null): EngineSummary {
  if (!settings) {
    return { ready: false, provider: null, model: null, permission: 'Ask before tools', servers: 0 }
  }
  const enabled = settings.providers.filter((provider) => provider.enabled)
  const chosen =
    enabled.find((provider) => provider.id === settings.defaultProviderId) ?? enabled[0] ?? null
  const permission =
    settings.defaultPermissionMode === 'plan'
      ? 'Plans only, changes nothing'
      : settings.defaultPermissionMode === 'manual'
        ? 'Ask before tools'
        : settings.defaultPermissionMode === 'auto'
          ? 'Auto inside task folders'
          : 'Accepts steps, asks for commands'
  return {
    ready: Boolean(chosen && chosen.models.length > 0),
    provider: chosen?.name ?? null,
    model: settings.defaultModel ?? chosen?.models[0] ?? null,
    permission,
    servers: settings.mcpServers.filter((server) => server.enabled).length
  }
}
