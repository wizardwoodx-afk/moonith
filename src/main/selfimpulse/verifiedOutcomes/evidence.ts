import { createHash } from 'node:crypto'
import type { Task } from '../../../shared/types'
import type { OutcomeRunObservation } from '../../../shared/verifiedOutcomes'
import { canonicalAuditJson } from '../../audit/chain'
import { scrubAuditValue } from '../governance/dlp'

/** Only operational metadata is exposed to checks and regression candidates. */
export function observeTaskOutcome(task: Task): OutcomeRunObservation {
  return {
    taskStatus: task.status,
    steps: task.steps.slice(-500).map((step) => ({
      tool: step.tool,
      status: step.status
    })),
    artifacts: task.artifacts.length,
    planTotal: task.plan.length,
    planDone: task.plan.filter((item) => item.status === 'done').length
  }
}

/**
 * Binds a receipt to the complete scrubbed task without copying prompts, tool
 * arguments, output, paths, or page content into the outcome evidence store.
 */
export function digestTaskOutcome(task: Task): string {
  // Store.saveTask owns this volatile persistence timestamp; excluding it keeps
  // the receipt bound to the run rather than to a later save operation.
  const { updatedAt: _updatedAt, ...stableTask } = task
  return createHash('sha256')
    .update(canonicalAuditJson(scrubAuditValue(stableTask)), 'utf8')
    .digest('hex')
}
