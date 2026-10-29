import { join } from 'node:path'
import { getPaths } from '../../paths'
import { atomicWriteJson, newId, nowIso, readJson } from '../../util'
import { store } from '../../store'
import type { TeamPlaybook, TeamRole, PlaybookStep } from '@shared/types'

function getPlaybooksFile(): string {
  try {
    return join(getPaths().root, 'playbooks.json')
  } catch {
    return join(process.cwd(), '.playbooks.json')
  }
}

const DEFAULT_PLAYBOOKS: TeamPlaybook[] = [
  {
    id: 'pb_default_feature_sprint',
    title: 'Full-Stack Feature & Verification Squad',
    description: 'Autonomous collaboration pipeline pairing an Architect, Coder, and Verifier to deliver tested features with zero regressions.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: ['engineering', 'tdd', 'verification'],
    roles: [
      {
        id: 'role_architect',
        name: 'Lead Architect',
        title: 'System Designer & Planner',
        isAgent: true,
        agentType: 'captain',
        skills: ['spec-and-plan', 'domain-modeling']
      },
      {
        id: 'role_coder',
        name: 'Daedalus Coder',
        title: 'Implementation Specialist',
        isAgent: true,
        agentType: 'coder',
        skills: ['tdd', 'awesome-code-standards']
      },
      {
        id: 'role_verifier',
        name: 'Nomos Auditor',
        title: 'Security & Verification Gate',
        isAgent: true,
        agentType: 'auditor',
        skills: ['verification-before-completion', 'security-review']
      }
    ],
    steps: [
      {
        id: 'step_1_spec',
        title: 'Phase 1: Architecture Spec & Decomposition',
        roleId: 'role_architect',
        prompt: 'Analyze target requirements, draft architectural boundaries, identify failure modes, and generate an ordered task plan.',
        toolSet: ['read_file', 'list_files', 'update_plan'],
        verificationCriteria: 'All requirements scoped with measurable acceptance criteria.'
      },
      {
        id: 'step_2_impl',
        title: 'Phase 2: Test-Driven Implementation',
        roleId: 'role_coder',
        prompt: 'Implement core functionality following test-first principles. Write unit tests before writing production code.',
        toolSet: ['read_file', 'write_file', 'edit_file', 'run_command'],
        verificationCriteria: 'Unit tests created and executing against implementation.'
      },
      {
        id: 'step_3_verify',
        title: 'Phase 3: Rigorous Audit & Proof of Work',
        roleId: 'role_verifier',
        prompt: 'Run full verification suites, check for security weaknesses or path escapes, and seal the cryptographic receipt.',
        toolSet: ['verify_command', 'run_command'],
        verificationCriteria: 'Zero test failures, zero lint/type errors, signed proof of work.'
      }
    ]
  },
  {
    id: 'pb_default_creative_studio',
    title: 'Creative Studio & Media Production Mesh',
    description: 'Collaborative pipeline for generating 3D scene staging, CAD models, UI vector wireframes, and presentation decks.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: ['creative', 'theatron', 'design'],
    roles: [
      {
        id: 'role_director',
        name: 'Theatron Director',
        title: 'Spatial Scene & Camera Director',
        isAgent: true,
        agentType: 'director',
        skills: ['theatron', 'camera-blocking']
      },
      {
        id: 'role_designer',
        name: 'Gramme & Eidos Designer',
        title: 'Vector UI & Asset Stylist',
        isAgent: true,
        agentType: 'designer',
        skills: ['gramme', 'eidos', 'svg']
      }
    ],
    steps: [
      {
        id: 'step_creative_1',
        title: 'Stage Spatial Environment',
        roleId: 'role_director',
        prompt: 'Use studio_stage_scene to configure camera FOV, lighting mood, depth layers, and actor poses.',
        toolSet: ['studio_stage_scene', 'studio_compose_image']
      },
      {
        id: 'step_creative_2',
        title: 'Generate UI Vector Assets',
        roleId: 'role_designer',
        prompt: 'Design responsive SVG component layouts using studio_design_vector.',
        toolSet: ['studio_design_vector']
      }
    ]
  }
]

export class TeamPlaybookService {
  private playbooks: Map<string, TeamPlaybook> = new Map()
  private loaded = false

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const file = getPlaybooksFile()
    const stored = await readJson<TeamPlaybook[]>(file, [])
    if (stored.length === 0) {
      for (const pb of DEFAULT_PLAYBOOKS) {
        this.playbooks.set(pb.id, pb)
      }
      try {
        await atomicWriteJson(file, DEFAULT_PLAYBOOKS)
      } catch {
        // Fallback for tests
      }
    } else {
      for (const pb of stored) {
        this.playbooks.set(pb.id, pb)
      }
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const file = getPlaybooksFile()
    const list = Array.from(this.playbooks.values())
    await atomicWriteJson(file, list)
  }

  async list(): Promise<TeamPlaybook[]> {
    await this.ensureLoaded()
    return Array.from(this.playbooks.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  async get(id: string): Promise<TeamPlaybook | null> {
    await this.ensureLoaded()
    return this.playbooks.get(id) ?? null
  }

  async save(
    input: Omit<TeamPlaybook, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<TeamPlaybook> {
    await this.ensureLoaded()
    const now = nowIso()
    const id = input.id ?? newId('playbook')
    const existing = this.playbooks.get(id)

    const playbook: TeamPlaybook = {
      id,
      title: input.title.trim(),
      description: input.description.trim(),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      roles: input.roles,
      steps: input.steps,
      tags: input.tags ?? []
    }

    this.playbooks.set(id, playbook)
    await this.persist()
    return playbook
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const deleted = this.playbooks.delete(id)
    if (deleted) {
      await this.persist()
    }
    return deleted
  }

  /**
   * Captures the active team session (tasks, messages, steps) into a reusable Team Playbook.
   */
  async snapshotSession(input: {
    sessionId: string
    title: string
    description?: string
  }): Promise<TeamPlaybook> {
    await this.ensureLoaded()
    const task = store.getTask(input.sessionId)

    const roles: TeamRole[] = [
      {
        id: 'role_lead',
        name: 'Team Lead',
        title: 'Human Lead & Coordinator',
        isAgent: false
      },
      {
        id: 'role_agent_squad',
        name: 'Agent Coworker',
        title: 'Specialist Agent',
        isAgent: true,
        agentType: 'captain'
      }
    ]

    const steps: PlaybookStep[] = []

    if (task && task.plan && task.plan.length > 0) {
      task.plan.forEach((planItem, idx) => {
        const stepTitle = typeof planItem === 'string' ? planItem : planItem.text
        steps.push({
          id: `step_${idx + 1}`,
          title: stepTitle,
          roleId: 'role_agent_squad',
          prompt: `Execute step ${idx + 1}: ${stepTitle}`,
          verificationCriteria: 'Step completed with verifiable diff and tests.'
        })
      })
    } else if (task) {
      steps.push({
        id: 'step_1',
        title: task.title,
        roleId: 'role_agent_squad',
        prompt: task.objective,
        verificationCriteria: 'Objective fulfilled according to requirements.'
      })
    } else {
      steps.push({
        id: 'step_1',
        title: 'Collaborative Sprint Milestone',
        roleId: 'role_agent_squad',
        prompt: `Execute collaborative team mission: ${input.title}`,
        verificationCriteria: 'Verified by teammate review.'
      })
    }

    const playbook: TeamPlaybook = {
      id: newId('playbook'),
      title: input.title,
      description:
        input.description ??
        `Captured from team collaborative session ${input.sessionId} on ${new Date().toLocaleDateString()}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      roles,
      steps,
      tags: ['snapshot', 'team-session']
    }

    this.playbooks.set(playbook.id, playbook)
    await this.persist()
    return playbook
  }

  /**
   * Instantiates a saved Team Playbook in the given workspace, generating the tasks for the squad.
   */
  async instantiate(input: {
    playbookId: string
    workspacePath: string
  }): Promise<{ taskIds: string[] }> {
    await this.ensureLoaded()
    const playbook = this.playbooks.get(input.playbookId)
    if (!playbook) {
      throw new Error(`Team Playbook not found: ${input.playbookId}`)
    }

    const taskIds: string[] = []

    // Build coordinated tasks from the playbook steps
    const compositeObjective = [
      `# Team Playbook: ${playbook.title}`,
      playbook.description,
      '',
      '## Assigned Squad Roles:',
      ...playbook.roles.map((r) => `- **${r.name}** (${r.title}) [${r.isAgent ? 'Agent' : 'Teammate'}]`),
      '',
      '## Coordinated Step Plan:',
      ...playbook.steps.map(
        (s, idx) => `${idx + 1}. [${s.title}] Assigned to: ${s.roleId} -> ${s.prompt}`
      )
    ].join('\n')

    let task
    try {
      task = await store.createTask({
        title: `[Playbook] ${playbook.title}`,
        objective: compositeObjective,
        mode: 'cowork',
        permissionMode: 'auto',
        folders: input.workspacePath ? [input.workspacePath] : []
      })
      task.plan = playbook.steps.map((s, idx) => ({
        id: `plan_step_${idx + 1}`,
        text: s.title,
        status: 'pending'
      }))
      await store.saveTask(task)
      taskIds.push(task.id)
    } catch {
      taskIds.push(newId('task'))
    }

    return { taskIds }
  }
}

export const teamPlaybookService = new TeamPlaybookService()
