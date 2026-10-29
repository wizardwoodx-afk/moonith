/**
 * Toffoli Recovery Planner.
 *
 * Formulates structured, reversible recovery plans based on classified faults.
 */
import type { ClassifiedFault } from './classifier'

export type RecoveryActionKind =
  | 'walkback_file'
  | 'compensate_domain'
  | 'retry_delayed'
  | 'reprompt_model'
  | 'notify_human'

export interface RecoveryAction {
  kind: RecoveryActionKind
  target?: string
  parameters?: Record<string, unknown>
}

export interface RecoveryPlan {
  fault: ClassifiedFault
  strategy: 'immediate_rollback' | 'delayed_retry' | 'reprompt' | 'escalate'
  actions: RecoveryAction[]
}

export class ToffoliPlanner {
  plan(
    fault: ClassifiedFault,
    context?: {
      taskId?: string
      stepId?: string
      toolName?: string
      affectedPath?: string
      domain?: string
    }
  ): RecoveryPlan {
    const actions: RecoveryAction[] = []

    if (fault.requiresRollback) {
      if (context?.affectedPath) {
        actions.push({
          kind: 'walkback_file',
          target: context.affectedPath,
          parameters: { taskId: context.taskId, stepId: context.stepId }
        })
      }
      if (context?.domain) {
        actions.push({
          kind: 'compensate_domain',
          target: context.domain,
          parameters: { taskId: context.taskId, toolName: context.toolName }
        })
      }
      return {
        fault,
        strategy: 'immediate_rollback',
        actions
      }
    }

    if (fault.retryable) {
      actions.push({
        kind: 'retry_delayed',
        parameters: { delayMs: 1500, maxAttempts: 3 }
      })
      return {
        fault,
        strategy: 'delayed_retry',
        actions
      }
    }

    if (fault.category === 'parameter_validation') {
      actions.push({
        kind: 'reprompt_model',
        parameters: { errorNotice: fault.message }
      })
      return {
        fault,
        strategy: 'reprompt',
        actions
      }
    }

    actions.push({
      kind: 'notify_human',
      parameters: { message: fault.message }
    })
    return {
      fault,
      strategy: 'escalate',
      actions
    }
  }
}

export const toffoliPlanner = new ToffoliPlanner()
