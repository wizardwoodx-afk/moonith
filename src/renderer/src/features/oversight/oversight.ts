import type { PermissionMode, StepRecord, Task, TokenUsage } from '@shared/types'

/**
 * The Oversight ledger: what the agent was allowed to do, what it actually did,
 * and what stopped it.
 *
 * Derived, never stored twice. Everything here comes from the task's own record
 * so the panel cannot drift from what really happened, and so an old task
 * renders correctly without a migration.
 */

export type OversightKind = 'decision' | 'guard' | 'failure' | 'change'

export interface OversightEntry {
  id: string
  kind: OversightKind
  title: string
  detail: string
  at: string
  tool: string
}

export const STOP_LABEL: Record<string, string> = {
  final: 'Answered',
  max_iterations: 'Stopped at the iteration ceiling',
  budget_exhausted: 'Stopped: no budget left',
  circuit_open: 'Stopped: repeated failures tripped the breaker',
  interrupted: 'Stopped by you',
  error: 'Ended with an error',
  prelude_break: 'Stopped before the first call'
}

export function stopLabel(reason?: string): string | null {
  if (!reason) return null
  return STOP_LABEL[reason] ?? `Stopped (${reason})`
}

const DECISION = /governance gate|denied|not granted|refused|blocked/i
const CHANGE = /^(write_file|edit_file|apply_changes|delete_path|move_path|make_directory|create_document|create_spreadsheet|create_deck|create_pdf)$/

function classify(step: StepRecord): OversightKind | null {
  if (step.tool.startsWith('tripwire:')) return 'guard'
  if (step.status === 'error') return DECISION.test(`${step.error ?? ''} ${step.detail ?? ''}`) ? 'decision' : 'failure'
  if (CHANGE.test(step.tool)) return 'change'
  return null
}

const TITLES: Record<OversightKind, (step: StepRecord) => string> = {
  decision: (step) => `Refused: ${step.title}`,
  guard: (step) => (step.tool === 'tripwire:output' ? 'Answer edited before display' : 'Retrieved content marked'),
  failure: (step) => `Failed: ${step.title}`,
  change: (step) => step.title
}

export interface OversightReport {
  entries: OversightEntry[]
  counts: Record<OversightKind, number>
  stop: string | null
  permissionMode: PermissionMode
  model: string
  usage?: TokenUsage
  empty: boolean
}

export function buildOversight(task: Task): OversightReport {
  const counts: Record<OversightKind, number> = { decision: 0, guard: 0, failure: 0, change: 0 }
  const entries: OversightEntry[] = []

  for (const step of task.steps ?? []) {
    const kind = classify(step)
    if (!kind) continue
    counts[kind]++
    entries.push({
      id: step.id,
      kind,
      title: TITLES[kind](step),
      detail: (step.error ?? step.detail ?? '').trim() || 'No detail recorded.',
      at: step.endedAt ?? step.startedAt,
      tool: step.tool
    })
  }

  /* Newest first: the panel answers "what just happened" before it answers
   * "what happened at the start of a five-hour task". */
  entries.reverse()

  return {
    entries,
    counts,
    stop: stopLabel(task.stop?.reason),
    permissionMode: task.permissionMode,
    model: task.model ?? 'no model recorded',
    usage: task.usage,
    empty: entries.length === 0 && !task.stop
  }
}
