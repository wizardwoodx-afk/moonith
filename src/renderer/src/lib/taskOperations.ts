import type {
  AttachmentRef,
  McpServerConfig,
  McpServerStatus,
  SubAgentRun,
  Task
} from '@shared/types'

export type CrewFilter = 'all' | 'running' | 'finished'

/** Current-task runs, with active work first and newest runs first within each group. */
export function crewRunsForTask(runs: SubAgentRun[], taskId: string): SubAgentRun[] {
  return runs
    .filter((run) => run.taskId === taskId)
    .sort(
      (a, b) =>
        Number(b.status === 'running') - Number(a.status === 'running') ||
        b.startedAt.localeCompare(a.startedAt)
    )
}

export function filterCrewRuns(runs: SubAgentRun[], filter: CrewFilter): SubAgentRun[] {
  if (filter === 'all') return runs
  if (filter === 'running') return runs.filter((run) => run.status === 'running')
  return runs.filter((run) => run.status !== 'running')
}

export function crewStepProgress(run: SubAgentRun): { completed: number; total: number; ratio: number } {
  const completed = run.steps.filter((step) => step.status === 'ok' || step.status === 'error').length
  const total = run.steps.length
  return { completed, total, ratio: total ? completed / total : 0 }
}

export function currentCrewStep(run: SubAgentRun) {
  return run.steps.find((step) => step.status === 'running') ?? run.steps[run.steps.length - 1]
}

/** Unique files genuinely attached to visible task messages, keyed by their validated path. */
export function taskAttachmentSources(task: Task): AttachmentRef[] {
  const seen = new Set<string>()
  const files: AttachmentRef[] = []
  for (const message of task.messages) {
    if (message.hidden) continue
    for (const file of message.attachments ?? []) {
      if (seen.has(file.path)) continue
      seen.add(file.path)
      files.push(file)
    }
  }
  return files
}

export interface McpExposure {
  discovered: number
  exposed: number
  tools: McpServerStatus['tools']
}

/** Match the main-process MCP allowlist semantics; never count disabled/error tools as available. */
export function mcpExposure(config: McpServerConfig, status?: McpServerStatus): McpExposure {
  const discovered = status?.tools.length ?? 0
  if (!config.enabled || status?.status !== 'ready') {
    return { discovered, exposed: 0, tools: [] }
  }
  const allowed = config.toolAllowlist?.length ? new Set(config.toolAllowlist) : null
  const tools = status.tools.filter((tool) => !allowed || allowed.has(tool.name))
  return { discovered, exposed: tools.length, tools }
}

export function formatRunElapsed(run: SubAgentRun, now: number): string {
  const start = Date.parse(run.startedAt)
  const end = run.endedAt ? Date.parse(run.endedAt) : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
