/**
 * Kardia Heartbeat Evaluator.
 *
 * Scans local workspace context, pending schedules, and approvals.
 * Returns PULSE_OK when system is quiescent; emits actionable notices
 * when proactive intervention is warranted.
 */
import { promises as fs } from 'node:fs'

export interface PulseEvaluation {
  status: 'PULSE_OK' | 'ATTENTION_NEEDED'
  summary?: string
  actionItems?: string[]
}

export class KardiaEvaluator {
  /**
   * Evaluates the current state of workspaces, pending approvals, and tasks.
   */
  async evaluate(context: {
    workspaces?: string[]
    pendingApprovalsCount?: number
    enabledSchedulesCount?: number
    lastActiveTimestamp?: number
  }): Promise<PulseEvaluation> {
    const actionItems: string[] = []

    // 1. Check for stalled pending approvals
    if (context.pendingApprovalsCount && context.pendingApprovalsCount > 0) {
      actionItems.push(
        `There ${context.pendingApprovalsCount === 1 ? 'is' : 'are'} ${context.pendingApprovalsCount} pending tool approval${context.pendingApprovalsCount === 1 ? '' : 's'} waiting for your confirmation.`
      )
    }

    // 2. Check workspace directories for unexpected unhandled files
    if (context.workspaces) {
      for (const ws of context.workspaces) {
        try {
          const files = await fs.readdir(ws)
          const newFiles = files.filter((f) => !f.startsWith('.') && f !== 'node_modules')
          if (newFiles.length > 50) {
            actionItems.push(`Workspace "${ws}" has ${newFiles.length} files. Consider running an organization step.`)
          }
        } catch {
          // Ignored if directory is transiently unreadable
        }
      }
    }

    if (actionItems.length === 0) {
      return { status: 'PULSE_OK' }
    }

    return {
      status: 'ATTENTION_NEEDED',
      summary: `Kardia detected ${actionItems.length} item(s) needing awareness.`,
      actionItems
    }
  }
}

export const kardiaEvaluator = new KardiaEvaluator()
