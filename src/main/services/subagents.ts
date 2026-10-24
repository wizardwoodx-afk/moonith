import type { SubAgentRun, SubAgentStatus } from '@shared/types'
import { sendTaskEvent } from '../emitter'
import { getPaths } from '../paths'
import { atomicWriteJson, newId, nowIso, readJson } from '../util'

const MAX_RUNS = 60

class SubAgentService {
  private runs: SubAgentRun[] | null = null
  private writeChain: Promise<void> = Promise.resolve()

  private async load(): Promise<SubAgentRun[]> {
    if (this.runs) return this.runs
    const stored = await readJson<SubAgentRun[]>(getPaths().subAgentsFile, [])
    this.runs = (Array.isArray(stored) ? stored : []).map((run) =>
      run.status === 'running'
        ? {
            ...run,
            status: 'stopped' as const,
            error: 'Interrupted when SelfImpulse closed.',
            endedAt: run.endedAt ?? nowIso()
          }
        : run
    )
    return this.runs
  }

  async list(): Promise<SubAgentRun[]> {
    const runs = await this.load()
    return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  async begin(input: {
    id?: string
    taskId: string
    taskTitle: string
    name: string
    instruction: string
    provider: string
    model: string
  }): Promise<SubAgentRun> {
    const runs = await this.load()
    const existing = input.id ? runs.find((item) => item.id === input.id) : undefined
    if (existing) {
      if (existing.status === 'running') {
        throw new Error(`Crew run "${existing.id}" is already active.`)
      }
      existing.status = 'running'
      existing.error = undefined
      existing.endedAt = undefined
      await this.save()
      this.publish(existing)
      return existing
    }
    const run: SubAgentRun = {
      id: input.id ?? newId('crew'),
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      name: input.name,
      instruction: input.instruction,
      status: 'running',
      steps: [],
      provider: input.provider,
      model: input.model,
      startedAt: nowIso()
    }
    runs.unshift(run)
    if (runs.length > MAX_RUNS) runs.splice(MAX_RUNS)
    await this.save()
    this.publish(run)
    return run
  }

  async saveRun(run: SubAgentRun): Promise<void> {
    const runs = await this.load()
    const index = runs.findIndex((item) => item.id === run.id)
    if (index >= 0) runs[index] = run
    else runs.unshift(run)
    await this.save()
    this.publish(run)
  }

  async finish(
    run: SubAgentRun,
    status: SubAgentStatus,
    patch: { summary?: string; error?: string } = {}
  ): Promise<void> {
    run.status = status
    run.endedAt = nowIso()
    if (patch.summary !== undefined) run.summary = patch.summary
    if (patch.error !== undefined) run.error = patch.error
    await this.saveRun(run)
  }

  private publish(run: SubAgentRun): void {
    sendTaskEvent({ type: 'subagent', run: { ...run, steps: [...run.steps] } })
  }

  private save(): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => atomicWriteJson(getPaths().subAgentsFile, this.runs ?? []))
    return this.writeChain
  }
}

export const subAgentService = new SubAgentService()
