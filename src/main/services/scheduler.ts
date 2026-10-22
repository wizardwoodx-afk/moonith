import cron, { type ScheduledTask } from 'node-cron'
import type { ScheduleRecord } from '@shared/types'
import { store } from '../store'
import { agentRuntime } from '../agent/runtime'
import { nowIso } from '../util'
import { toast } from '../emitter'

class Scheduler {
  private jobs = new Map<string, ScheduledTask>()
  private running = new Set<string>()
  private initialized = false

  init(): void {
    if (this.initialized) return
    this.initialized = true
    for (const record of store.listSchedules()) {
      this.sync(record.id)
    }
  }

  sync(id: string): void {
    this.stop(id)
    const record = store.getSchedule(id)
    if (!record || !record.enabled) return
    if (!cron.validate(record.cron)) {
      toast('error', `Schedule “${record.title}” has an invalid cron expression.`)
      return
    }
    try {
      const job = cron.schedule(record.cron, () => {
        void this.trigger(id)
      })
      this.jobs.set(id, job)
    } catch (error) {
      toast('error', `Could not start schedule: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  stop(id: string): void {
    const job = this.jobs.get(id)
    if (job) {
      void job.stop()
      this.jobs.delete(id)
    }
  }

  remove(id: string): void {
    this.stop(id)
    this.running.delete(id)
  }

  async runNow(id: string): Promise<ScheduleRecord> {
    const record = await this.trigger(id)
    if (!record) throw new Error('Schedule not found.')
    return record
  }

  private async trigger(id: string): Promise<ScheduleRecord | null> {
    const record = store.getSchedule(id)
    if (!record) return null
    if (this.running.has(id)) {
      toast('info', `Schedule “${record.title}” is already running; skipping this run.`)
      return record
    }
    this.running.add(id)
    try {
      const task = await store.createTask({
        title: record.title,
        objective: record.prompt,
        mode: 'cowork',
        providerId: record.providerId,
        model: record.model,
        permissionMode: record.permissionMode,
        folders: record.folders
      })
      const updated = await store.updateSchedule(id, {
        lastRunAt: nowIso(),
        lastTaskId: task.id
      })
      await agentRuntime.sendMessage({ taskId: task.id, text: record.prompt })
      toast('success', `Started scheduled task “${record.title}”.`)
      return updated
    } catch (error) {
      toast('error', `Scheduled task failed: ${error instanceof Error ? error.message : String(error)}`)
      return record
    } finally {
      this.running.delete(id)
    }
  }

  shutdown(): void {
    for (const id of [...this.jobs.keys()]) this.stop(id)
  }
}

export const scheduler = new Scheduler()
