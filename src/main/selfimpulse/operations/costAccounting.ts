/**
 * Cost Accounting & Infinite Loop Detection Engine for SelfImpulse.
 *
 * Implements operational telemetry:
 * - Tracks input/output token usage and estimated USD cost per task.
 * - Detects infinite loops (repeating consecutive identical tool calls or cyclical ping-pongs).
 * - Automatically pauses or aborts runaway tasks to prevent credit exhaustion.
 */
import { createHash } from 'node:crypto'
import { nowIso } from '../../util'

export interface TaskCostTelemetry {
  taskId: string
  totalInputTokens: number
  totalOutputTokens: number
  estimatedCostUsd: number
  toolCallsCount: number
  updatedAt: string
}

export class CostAccountingService {
  private taskTelemetry: Map<string, TaskCostTelemetry> = new Map()
  private actionHistories: Map<string, string[]> = new Map() // taskId -> list of action digests

  /**
   * Track token usage and estimate cost (using standard baseline: ~$0.15/1M input, ~$0.60/1M output).
   */
  recordUsage(taskId: string, inputTokens: number, outputTokens: number): TaskCostTelemetry {
    const existing = this.taskTelemetry.get(taskId) ?? {
      taskId,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      toolCallsCount: 0,
      updatedAt: nowIso()
    }

    existing.totalInputTokens += inputTokens
    existing.totalOutputTokens += outputTokens
    existing.estimatedCostUsd = parseFloat(
      (
        (existing.totalInputTokens / 1_000_000) * 0.15 +
        (existing.totalOutputTokens / 1_000_000) * 0.6
      ).toFixed(6)
    )
    existing.updatedAt = nowIso()

    this.taskTelemetry.set(taskId, existing)
    return existing
  }

  /**
   * Check for repeating tool call loops. Returns true if a runaway loop is detected.
   */
  checkAndRecordAction(taskId: string, tool: string, args: Record<string, unknown>): { loopDetected: boolean; count: number } {
    if (!this.actionHistories.has(taskId)) {
      this.actionHistories.set(taskId, [])
    }
    const history = this.actionHistories.get(taskId)!

    const actionStr = `${tool}:${JSON.stringify(args)}`
    const digest = createHash('md5').update(actionStr).digest('hex')
    history.push(digest)

    const telemetry = this.taskTelemetry.get(taskId)
    if (telemetry) telemetry.toolCallsCount += 1

    // Check if the last 4 actions are identical (direct loop)
    if (history.length >= 4) {
      const last4 = history.slice(-4)
      if (last4.every((d) => d === digest)) {
        return { loopDetected: true, count: 4 }
      }
    }

    // Check if a 2-step cycle repeats 3 times (A-B-A-B-A-B cycle)
    if (history.length >= 6) {
      const last6 = history.slice(-6)
      if (
        last6[0] === last6[2] &&
        last6[2] === last6[4] &&
        last6[1] === last6[3] &&
        last6[3] === last6[5]
      ) {
        return { loopDetected: true, count: 6 }
      }
    }

    return { loopDetected: false, count: 0 }
  }

  getTelemetry(taskId: string): TaskCostTelemetry | null {
    return this.taskTelemetry.get(taskId) ?? null
  }
}

export const costAccounting = new CostAccountingService()
