/**
 * Tiered Approvals & Sandboxing Safety Engine for SelfImpulse.
 *
 * Implements strict trust & safety controls:
 * - 3-Tier risk classification:
 *   - 'danger': Blocked outright (destructive shell, root credential dump, format drive)
 *   - 'warn': Requires explicit human approval, showing exact tool call and parameters in the prompt
 *   - 'safe': Pre-approved read-only operations
 * - Named approver tracking, recording approval & override rates to mitigate automation bias
 * - Time-boxed approvals: auto-abandons if not approved within timeout window
 * - Rich approval records feeding the cryptographic Proof Trail
 */
import { createHash } from 'node:crypto'
import { newId, nowIso } from '../../util'

export type ActionRiskTier = 'safe' | 'warn' | 'danger'

export interface ApprovalRecord {
  id: string
  taskId: string
  agentId: string
  tool: string
  argsDigest: string
  argsPreview: Record<string, unknown>
  tier: ActionRiskTier
  approver?: string
  status: 'pending' | 'approved' | 'denied' | 'timeout'
  createdAt: string
  decidedAt?: string
  expiresAt: string
}

export class TieredApprovalService {
  private approvals: Map<string, ApprovalRecord> = new Map()
  private defaultTimeoutMs = 5 * 60 * 1000 // 5 minutes

  /**
   * Classify risk tier of an incoming tool execution.
   */
  classifyRisk(tool: string, args: Record<string, unknown>): ActionRiskTier {
    const dangerPatterns = [
      /rm\s+-rf\s+[\/\\]/i,
      /format\s+[a-z]:/i,
      /drop\s+database/i,
      /cat\s+.*id_rsa/i,
      /type\s+.*id_rsa/i
    ]

    const strArgs = JSON.stringify(args)
    for (const pat of dangerPatterns) {
      if (pat.test(strArgs)) return 'danger'
    }

    // High impact tools require approval
    if (
      tool.includes('shell') ||
      tool.includes('run_command') ||
      tool.includes('delete') ||
      tool.includes('patch') ||
      tool.includes('apply_code_patch')
    ) {
      return 'warn'
    }

    return 'safe'
  }

  /**
   * Request approval for a tool execution.
   */
  requestApproval(input: {
    taskId: string
    agentId: string
    tool: string
    args: Record<string, unknown>
    timeoutMs?: number
  }): { approved: boolean; record: ApprovalRecord } {
    const tier = this.classifyRisk(input.tool, input.args)
    const id = newId('appr')
    const now = Date.now()
    const expiresAt = new Date(now + (input.timeoutMs ?? this.defaultTimeoutMs)).toISOString()

    const argsJson = JSON.stringify(input.args)
    const argsDigest = createHash('sha256').update(argsJson).digest('hex')

    // Danger actions are blocked outright by policy
    if (tier === 'danger') {
      const record: ApprovalRecord = {
        id,
        taskId: input.taskId,
        agentId: input.agentId,
        tool: input.tool,
        argsDigest,
        argsPreview: input.args,
        tier: 'danger',
        status: 'denied',
        createdAt: nowIso(),
        decidedAt: nowIso(),
        expiresAt
      }
      this.approvals.set(id, record)
      return { approved: false, record }
    }

    // Safe actions are automatically approved
    if (tier === 'safe') {
      const record: ApprovalRecord = {
        id,
        taskId: input.taskId,
        agentId: input.agentId,
        tool: input.tool,
        argsDigest,
        argsPreview: input.args,
        tier: 'safe',
        status: 'approved',
        createdAt: nowIso(),
        decidedAt: nowIso(),
        expiresAt
      }
      this.approvals.set(id, record)
      return { approved: true, record }
    }

    // Warn actions require explicit human sign-off
    const record: ApprovalRecord = {
      id,
      taskId: input.taskId,
      agentId: input.agentId,
      tool: input.tool,
      argsDigest,
      argsPreview: input.args,
      tier: 'warn',
      status: 'pending',
      createdAt: nowIso(),
      expiresAt
    }
    this.approvals.set(id, record)
    return { approved: false, record }
  }

  /**
   * Executive human decision on a pending approval.
   */
  decide(approvalId: string, decision: 'approved' | 'denied', approver: string): ApprovalRecord {
    const record = this.approvals.get(approvalId)
    if (!record) {
      throw new Error(`Approval record not found: ${approvalId}`)
    }

    // Check expiration
    if (Date.now() > new Date(record.expiresAt).getTime()) {
      record.status = 'timeout'
      record.decidedAt = nowIso()
      return record
    }

    record.status = decision
    record.approver = approver
    record.decidedAt = nowIso()
    return record
  }

  /**
   * Calculate approval statistics to detect automation bias.
   */
  getMetrics(): { total: number; approved: number; denied: number; overrideRate: number } {
    const list = Array.from(this.approvals.values()).filter((a) => a.tier === 'warn')
    const total = list.length
    if (total === 0) return { total: 0, approved: 0, denied: 0, overrideRate: 0 }

    const approved = list.filter((a) => a.status === 'approved').length
    const denied = list.filter((a) => a.status === 'denied').length
    const overrideRate = parseFloat(((denied / total) * 100).toFixed(1))

    return { total, approved, denied, overrideRate }
  }
}

export const tieredApproval = new TieredApprovalService()
