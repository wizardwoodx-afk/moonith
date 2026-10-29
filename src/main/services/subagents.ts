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

export interface CrewSpecialistPreset {
  name: string
  title: string
  purpose: string
  rolePrompt: string
}

export const CREW_SPECIALISTS: Record<string, CrewSpecialistPreset> = {
  techne: {
    name: 'Techne',
    title: 'Coding Specialist',
    purpose:
      'High-throughput code synthesis, surgical multi-hunk patching, AST refactoring, and pre-flight syntax gates.',
    rolePrompt:
      'You are Techne, the native SelfImpulse Coding Specialist. You specialize in reading code with chunked precision, generating clean multi-hunk diffs, and verifying syntax before concluding.'
  },
  archon: {
    name: 'Archon',
    title: 'File Navigator',
    purpose:
      'Deep codebase exploration, streaming file chunking, directory tree indexing, and symbol outliner.',
    rolePrompt:
      'You are Archon, the native SelfImpulse File Navigator. You explore directories, read large files in streaming windows, and outline symbols.'
  },
  researcher: {
    name: 'Researcher',
    title: 'Research Specialist',
    purpose:
      'Broad architectural research, web intelligence, library comparison, documentation synthesis, and fact verification.',
    rolePrompt:
      'You are Researcher, the native SelfImpulse Research Specialist. You investigate technical questions, analyze libraries, synthesize documentation, and produce clear factual reports.'
  },
  reviewer: {
    name: 'Reviewer',
    title: 'Code Reviewer',
    purpose:
      'Pre-merge code review, security audits, regression risk identification, OWASP compliance, and verification proof.',
    rolePrompt:
      'You are Reviewer, the native SelfImpulse Code Review Specialist. You audit diffs for security, logic defects, regression hazards, and performance bottlenecks.'
  },
  designer: {
    name: 'Designer',
    title: 'UI/UX Specialist',
    purpose:
      'UI/UX design review, Apple fluid animations, typography hierarchy, design tokens compilation, and component aesthetics.',
    rolePrompt:
      'You are Designer, the native SelfImpulse UI/UX Specialist. You review interfaces, visual hierarchy, motion curves, and design tokens.'
  }
}

/**
 * The house rules a specialist works under. A child session started by the
 * execution engine does not inherit the captain's session instructions, so the
 * rules that must hold for every reply travel with the agent definition.
 */
const CREW_RULES = [
  'You work for the agent that called you, not for the user, and you never address the user directly.',
  'Write in plain words: no emoji, no pictograms, no decorative symbols.',
  'Use only the tools you are given. Never invent a file, a path, a tool result, or a check you did not run.',
  'If a directory is empty or a tool fails, say exactly that in your report instead of filling the gap.',
  'Report as compact plain text: what you inspected, what you found, the paths involved, and anything the caller must act on.'
].join('\n')

export interface EngineCrewAgent {
  /** The id the engine's subagent tool names in its available list. */
  id: string
  /** How the crew is presented to a person. */
  name: string
  description: string
  system: string
}

/**
 * The crew expressed the way the execution engine defines it: named sub-agents.
 * A specialist runs in its own session and inherits nothing from the caller's
 * instructions, so the installed skills are written into each one explicitly.
 */
export function engineCrewAgents(skillsIndex = ''): EngineCrewAgent[] {
  const skills = skillsIndex.trim()
  const skillBlock = skills
    ? `\n\nInstalled skill bundles on this device:\n${skills}\nRead a bundle with the read_skill tool before following it. Never claim to have used one you did not read.`
    : '\n\nNo skill bundles are installed. Do not claim to use one.'
  return Object.values(CREW_SPECIALISTS).map((specialist) => ({
    id: specialist.name.toLowerCase(),
    name: specialist.name,
    description: specialist.purpose,
    system: `${specialist.rolePrompt}\n${CREW_RULES}${skillBlock}`
  }))
}

/** The panel shows the specialist's name, not the id the engine keys it by. */
export function crewDisplayName(id: string): string {
  const preset = CREW_SPECIALISTS[id.toLowerCase()]
  if (preset) return preset.name
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Specialist'
}

export const subAgentService = new SubAgentService()
