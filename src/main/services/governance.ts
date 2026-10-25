import { createHash } from 'node:crypto'
import type { ChatMessage, Task } from '@shared/types'
import type { AgentRole, DlpFindingSummary, GovernanceSettings } from '@shared/governance'
import type { RuntimeAuditOutcome } from '@shared/audit'
import type { ModelMessage } from '../backend/core/types'
import type { AgentTool } from '../agent/tools/types'
import { store } from '../store'
import { runtimeAudit } from '../audit/runtime'
import { canonicalAuditJson } from '../audit/chain'
import {
  authorizeTool,
  permittedTools,
  resolveTaskRole,
  type PolicyDecision
} from '../selfimpulse/governance/policy'
import {
  DataPolicyError,
  protectData,
  scrubAuditValue
} from '../selfimpulse/governance/dlp'

export interface GovernanceActor {
  actor: 'captain' | 'crew' | 'system'
  actorId: string
  runId?: string
}

export interface ToolDataProtection {
  args: Record<string, unknown>
  findings: DlpFindingSummary[]
  total: number
}

/** Existing settings + one policy/DLP/audit façade for Captain and Crew. */
export class GovernanceService {
  settings(): GovernanceSettings {
    return store.getPublicSettings().governance
  }

  role(task: Task): AgentRole {
    return resolveTaskRole(task.agentRole)
  }

  permittedTools(task: Task, tools: AgentTool[]): AgentTool[] {
    return permittedTools(task.agentRole, this.settings(), tools)
  }

  authorize(task: Task, actor: GovernanceActor, tool: AgentTool): PolicyDecision {
    const decision = authorizeTool(task.agentRole, this.settings(), tool)
    this.audit(
      task,
      actor,
      'policy.check',
      decision.allowed ? 'allowed' : 'denied',
      tool.name,
      decision.reason,
      {
        capability: decision.capability,
        sideEffect: tool.sideEffect,
        risk: tool.risk
      }
    )
    return decision
  }

  protectModelMessages(
    task: Task,
    actor: GovernanceActor,
    messages: ModelMessage[]
  ): ModelMessage[] {
    return this.protectModelValue(task, actor, messages)
  }

  /** Stagehand uses the same DLP decision and audit path as the Captain. */
  protectBrowserMessages(
    task: Task,
    actor: GovernanceActor,
    messages: ChatMessage[]
  ): ChatMessage[] {
    return this.protectModelValue(task, actor, messages)
  }

  private protectModelValue<T>(task: Task, actor: GovernanceActor, value: T): T {
    const dlp = this.settings().dlp
    if (dlp.mode === 'off') return value
    const protectedInput = protectData(value, dlp)
    if (!protectedInput.total) return value
    const outcome = dlp.mode === 'block' ? 'blocked' : 'redacted'
    this.audit(
      task,
      actor,
      'dlp.model',
      outcome,
      'provider',
      undefined,
      { findings: protectedInput.findings, total: protectedInput.total }
    )
    if (dlp.mode === 'block') {
      throw new DataPolicyError('a model request', protectedInput.findings)
    }
    return protectedInput.value
  }

  protectToolArguments(
    task: Task,
    actor: GovernanceActor,
    tool: AgentTool,
    args: Record<string, unknown>
  ): ToolDataProtection {
    const dlp = this.settings().dlp
    const empty = { args, findings: [], total: 0 }
    if (dlp.mode === 'off' || (tool.sideEffect !== 'network' && tool.sideEffect !== 'execute')) {
      return empty
    }
    const protectedInput = protectData(args, dlp)
    if (!protectedInput.total) return empty
    const outcome = dlp.mode === 'block' ? 'blocked' : 'redacted'
    this.audit(
      task,
      actor,
      'dlp.tool',
      outcome,
      tool.name,
      undefined,
      { findings: protectedInput.findings, total: protectedInput.total }
    )
    if (dlp.mode === 'block') {
      throw new DataPolicyError(`the ${tool.name} tool call`, protectedInput.findings)
    }
    return {
      args: protectedInput.value,
      findings: protectedInput.findings,
      total: protectedInput.total
    }
  }

  payloadHash(value: unknown): string {
    return createHash('sha256')
      .update(canonicalAuditJson(scrubAuditValue(value)), 'utf8')
      .digest('hex')
  }

  audit(
    task: Task,
    actor: GovernanceActor,
    action: string,
    outcome: RuntimeAuditOutcome,
    target?: string,
    detail?: string,
    metadata?: Record<string, unknown>
  ): void {
    void runtimeAudit.record({
      ...actor,
      taskId: task.id,
      role: this.role(task),
      action,
      outcome,
      target,
      detail,
      metadata
    })
  }
}

export const governanceService = new GovernanceService()
