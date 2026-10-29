/**
 * Unified Recovery Dispatcher.
 *
 * Executes recovery plans formulated by Toffoli:
 * 1. Walkback: File undo/redo via snapshot restoration.
 * 2. Domain Adapters: Compensating transactions for external services, databases, or APIs.
 */
import { revert as revertSnapshot } from '../../services/snapshots'
import type { RecoveryAction, RecoveryPlan } from './planner'

export type DomainCompensationHandler = (
  actionId: string,
  context: Record<string, unknown>
) => Promise<{ success: boolean; note?: string }>

export class RecoveryDispatcher {
  private domainAdapters = new Map<string, DomainCompensationHandler>()

  /**
   * Registers a domain adapter for non-filesystem compensations (API, DB, cache).
   */
  registerDomainAdapter(domain: string, handler: DomainCompensationHandler): void {
    this.domainAdapters.set(domain, handler)
  }

  /**
   * Executes a Walkback: Reverses modified files back to the previous snapshot.
   */
  async walkbackFile(taskId: string, targetPath: string, stepId?: string): Promise<{ success: boolean; detail: string }> {
    try {
      const outcome = await revertSnapshot(taskId, { toStep: stepId })
      const changed = [...outcome.restored, ...outcome.removed]
      return {
        success: changed.length > 0 || outcome.left.length === 0,
        detail: changed.length
          ? `Walkback successfully restored ${changed.join(', ')}`
          : outcome.left.length
            ? `Walkback could not revert: ${outcome.left.map((l) => `${l.path} (${l.reason})`).join(', ')}`
            : `Walkback completed for ${targetPath}.`
      }
    } catch (err) {
      return {
        success: false,
        detail: `Walkback failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  /**
   * Executes Domain Compensation via registered adapter.
   */
  async compensateDomain(domain: string, actionId: string, params: Record<string, unknown>): Promise<{ success: boolean; detail: string }> {
    const adapter = this.domainAdapters.get(domain)
    if (!adapter) {
      return {
        success: false,
        detail: `No domain compensation adapter registered for domain "${domain}".`
      }
    }

    try {
      const result = await adapter(actionId, params)
      return {
        success: result.success,
        detail: result.note ?? `Domain compensation for "${domain}" completed.`
      }
    } catch (err) {
      return {
        success: false,
        detail: `Domain compensation failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  /**
   * Dispatches and executes an entire RecoveryPlan sequentially.
   */
  async dispatch(plan: RecoveryPlan, context?: { taskId?: string; actionId?: string }): Promise<Array<{ action: RecoveryAction; success: boolean; detail: string }>> {
    const results: Array<{ action: RecoveryAction; success: boolean; detail: string }> = []

    for (const action of plan.actions) {
      if (action.kind === 'walkback_file' && context?.taskId && action.target) {
        const stepId = action.parameters?.stepId as string | undefined
        const res = await this.walkbackFile(context.taskId, action.target, stepId)
        results.push({ action, success: res.success, detail: res.detail })
      } else if (action.kind === 'compensate_domain' && action.target) {
        const actionId = context?.actionId ?? 'unknown'
        const res = await this.compensateDomain(action.target, actionId, action.parameters ?? {})
        results.push({ action, success: res.success, detail: res.detail })
      } else {
        results.push({
          action,
          success: true,
          detail: `Action kind "${action.kind}" processed under strategy "${plan.strategy}".`
        })
      }
    }

    return results
  }
}

export const recoveryDispatcher = new RecoveryDispatcher()
