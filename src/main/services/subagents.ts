import type { CrewRunEventType, SubAgentRun, SubAgentStatus } from '@shared/types'
import { sendTaskEvent } from '../emitter'
import { getPaths } from '../paths'
import { atomicWriteJson, newId, nowIso, readJson } from '../util'
import { appendCrewRunEvent, crewRunForTransport } from '../selfimpulse/crewMesh/index'

const MAX_RUNS = 60

class SubAgentService {
  private runs: SubAgentRun[] | null = null
  private writeChain: Promise<void> = Promise.resolve()

  private async load(): Promise<SubAgentRun[]> {
    if (this.runs) return this.runs
    const stored = await readJson<SubAgentRun[]>(getPaths().subAgentsFile, [])
    this.runs = (Array.isArray(stored) ? stored : []).map((run) => {
      if (run.status !== 'running') return run
      const stopped: SubAgentRun = {
        ...run,
        status: 'stopped' as const,
        error: 'Interrupted when SelfImpulse closed.',
        endedAt: run.endedAt ?? nowIso()
      }
      appendCrewRunEvent(stopped, {
        id: newId('crew-event'),
        type: 'stopped',
        label: 'Interrupted when SelfImpulse closed',
        at: stopped.endedAt as string
      })
      return stopped
    })
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
    purpose?: string
    isolation?: SubAgentRun['isolation']
    agentPath?: string[]
    depth?: number
    batchId?: string
    batchSize?: number
    jobIndex?: number
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
      existing.runtime = 'crew-mesh'
      existing.isolation = input.isolation ?? existing.isolation
      existing.purpose = input.purpose
      existing.agentPath = input.agentPath ?? ['Captain', input.name]
      existing.depth = input.depth ?? 1
      existing.batchId = input.batchId
      existing.batchSize = input.batchSize
      existing.jobIndex = input.jobIndex
      appendCrewRunEvent(existing, {
        id: newId('crew-event'),
        type: 'spawned',
        label: `${input.name} restarted`,
        at: nowIso()
      })
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
      startedAt: nowIso(),
      runtime: 'crew-mesh',
      isolation: input.isolation,
      purpose: input.purpose,
      agentPath: input.agentPath ?? ['Captain', input.name],
      depth: input.depth ?? 1,
      batchId: input.batchId,
      batchSize: input.batchSize,
      jobIndex: input.jobIndex,
      events: []
    }
    appendCrewRunEvent(run, {
      id: newId('crew-event'),
      type: 'spawned',
      label: `${input.name} joined the Crew`,
      at: run.startedAt
    })
    runs.unshift(run)
    if (runs.length > MAX_RUNS) runs.splice(MAX_RUNS)
    await this.save()
    this.publish(run)
    return run
  }

  async saveRun(
    run: SubAgentRun,
    event?: { type: CrewRunEventType; label: string }
  ): Promise<void> {
    if (event) {
      appendCrewRunEvent(run, {
        id: newId('crew-event'),
        type: event.type,
        label: event.label,
        at: nowIso()
      })
    }
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
    const eventType: CrewRunEventType =
      status === 'done' ? 'completed' : status === 'stopped' ? 'stopped' : 'error'
    const label =
      status === 'done'
        ? 'Crew report ready'
        : status === 'stopped'
          ? 'Stopped with the parent task'
          : (patch.error ?? 'Crew run failed')
    await this.saveRun(run, { type: eventType, label })
  }

  private publish(run: SubAgentRun): void {
    sendTaskEvent({ type: 'subagent', run: crewRunForTransport(run) })
  }

  private save(): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => atomicWriteJson(getPaths().subAgentsFile, this.runs ?? []))
    return this.writeChain
  }
}

export const subAgentService = new SubAgentService()
