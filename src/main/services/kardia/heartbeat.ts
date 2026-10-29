/**
 * Kardia Heartbeat Engine (The Pulse of SelfImpulse).
 *
 * Autonomous awareness loop providing proactive background monitoring.
 * Runs on a periodic interval or system idle, checking context and alerting
 * the user only when necessary, returning PULSE_OK when quiet.
 */
import { kardiaEvaluator, type PulseEvaluation } from './evaluator'

export interface KardiaConfig {
  enabled: boolean
  intervalMinutes: number
  quietHoursStart?: number // 0-23
  quietHoursEnd?: number
}

export type PulseNotificationHandler = (evaluation: PulseEvaluation) => void

export class KardiaHeartbeat {
  private timer: NodeJS.Timeout | null = null
  private config: KardiaConfig = {
    enabled: true,
    intervalMinutes: 30
  }
  private onNotify: PulseNotificationHandler | null = null
  private isBusy = false
  private contextProvider: (() => Promise<{
    workspaces?: string[]
    pendingApprovalsCount?: number
    enabledSchedulesCount?: number
    lastActiveTimestamp?: number
  }>) | null = null

  configure(config: Partial<KardiaConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled) {
      this.stop()
    } else if (this.timer) {
      this.start() // restart with new interval
    }
  }

  setContextProvider(provider: () => Promise<{
    workspaces?: string[]
    pendingApprovalsCount?: number
    enabledSchedulesCount?: number
    lastActiveTimestamp?: number
  }>): void {
    this.contextProvider = provider
  }

  setNotificationHandler(handler: PulseNotificationHandler): void {
    this.onNotify = handler
  }

  start(): void {
    this.stop()
    if (!this.config.enabled) return

    const ms = Math.max(1, this.config.intervalMinutes) * 60 * 1000
    this.timer = setInterval(() => {
      void this.beat()
    }, ms)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * One heartbeat evaluation cycle.
   */
  async beat(): Promise<PulseEvaluation> {
    if (this.isBusy) return { status: 'PULSE_OK' }

    // Check quiet hours
    const currentHour = new Date().getHours()
    if (
      this.config.quietHoursStart !== undefined &&
      this.config.quietHoursEnd !== undefined
    ) {
      if (currentHour >= this.config.quietHoursStart || currentHour < this.config.quietHoursEnd) {
        return { status: 'PULSE_OK' }
      }
    }

    this.isBusy = true
    try {
      const context = this.contextProvider ? await this.contextProvider() : {}
      const evaluation = await kardiaEvaluator.evaluate(context)

      if (evaluation.status === 'ATTENTION_NEEDED' && this.onNotify) {
        this.onNotify(evaluation)
      }

      return evaluation
    } finally {
      this.isBusy = false
    }
  }

  isRunning(): boolean {
    return this.timer !== null
  }
}

export const kardiaHeartbeat = new KardiaHeartbeat()
