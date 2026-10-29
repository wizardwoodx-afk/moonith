import type { StepRecord, TaskStatus } from '@shared/types'

export type AgentActivityState =
  | 'waiting' | 'reading' | 'delegating' | 'thinking' | 'responding'
  | 'working' | 'complete' | 'error' | 'paused'

export interface AgentActivityValue {
  state: AgentActivityState
  label: string
  detail?: string
}

export interface AgentActivityInput {
  live: boolean
  thinking?: string
  responding?: boolean
  taskStatus?: TaskStatus
  steps: readonly StepRecord[]
  activeAgents?: number
}

const readingTools = new Map([
  ['read_file', 'Reading file'],
  ['read', 'Reading file'],
  ['read_document', 'Reading document'],
  ['recall_memory', 'Reading memory'],
  ['list_files', 'Browsing files'],
  ['search_files', 'Searching files'],
  ['glob', 'Searching files'],
  ['grep', 'Searching files']
])
const delegationTools = new Set(['subagent', 'delegate_to_crew', 'delegate_to_agent'])

/** Actual task/step state wins over accumulated reasoning or response text. */
export function deriveAgentActivity({
  live, thinking, responding, taskStatus, steps, activeAgents = 0
}: AgentActivityInput): AgentActivityValue {
  if (taskStatus === 'done') return { state: 'complete', label: 'Processed' }
  if (taskStatus === 'error') return { state: 'error', label: 'Error' }
  if (taskStatus === 'paused') return { state: 'paused', label: 'Paused' }
  if (taskStatus === 'waiting') return { state: 'waiting', label: 'Waiting for approval' }
  if (taskStatus === 'draft') return { state: 'waiting', label: 'Waiting' }

  // A finished turn must never inherit running tools or agents from a later turn.
  if (!live) {
    return steps.some((step) => step.status === 'error')
      ? { state: 'error', label: 'Error' }
      : { state: 'complete', label: 'Processed' }
  }
  if (steps.some((step) => step.status === 'waiting')) {
    return { state: 'waiting', label: 'Waiting for approval' }
  }

  const running = [...steps].reverse().find((step) => step.status === 'running')
  if (activeAgents > 0 || (running && delegationTools.has(running.tool))) {
    return {
      state: 'delegating', label: 'Delegating',
      ...(activeAgents > 0 ? { detail: `${activeAgents} active agent${activeAgents === 1 ? '' : 's'}` } : {})
    }
  }
  if (running) {
    const label = readingTools.get(running.tool)
    return label ? { state: 'reading', label } : { state: 'working', label: 'Working' }
  }
  if (responding) return { state: 'responding', label: 'Responding' }
  if (thinking?.trim()) return { state: 'thinking', label: 'Thinking' }
  return { state: 'working', label: 'Working' }
}
