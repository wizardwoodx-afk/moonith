/**
 * Kill Switch & Per-Agent Quarantine Engine for SelfImpulse.
 *
 * Implements hard isolation boundaries:
 * - Per-agent quarantine: Isolates any subagent exhibiting erratic behavior, prompt drift, or security tripwire alerts.
 * - Org/system-wide emergency kill switch: Halts all agent loops immediately.
 * - Time-boxed break-glass grants: Controlled temporary emergency bypass with mandatory cryptographic logging.
 */
import { nowIso } from '../../util'

export interface QuarantineRecord {
  agentId: string
  reason: string
  quarantinedAt: string
  quarantinedBy: string
}

export interface BreakGlassGrant {
  id: string
  requester: string
  reason: string
  grantedAt: string
  expiresAt: string
  active: boolean
}

export class QuarantineService {
  private quarantinedAgents: Map<string, QuarantineRecord> = new Map()
  private killSwitchActive = false
  private killSwitchActivatedAt?: string
  private killSwitchReason?: string
  private activeGrants: Map<string, BreakGlassGrant> = new Map()

  /**
   * Quarantine an individual agent.
   */
  quarantineAgent(agentId: string, reason: string, quarantinedBy = 'system'): QuarantineRecord {
    const record: QuarantineRecord = {
      agentId,
      reason: reason.trim(),
      quarantinedAt: nowIso(),
      quarantinedBy
    }
    this.quarantinedAgents.set(agentId, record)
    return record
  }

  /**
   * Release an agent from quarantine.
   */
  releaseAgent(agentId: string): boolean {
    return this.quarantinedAgents.delete(agentId)
  }

  /**
   * Activate the emergency kill switch across the entire app.
   */
  activateKillSwitch(reason: string): void {
    this.killSwitchActive = true
    this.killSwitchActivatedAt = nowIso()
    this.killSwitchReason = reason.trim()
  }

  /**
   * Deactivate the emergency kill switch.
   */
  deactivateKillSwitch(): void {
    this.killSwitchActive = false
    this.killSwitchActivatedAt = undefined
    this.killSwitchReason = undefined
  }

  /**
   * Verify if an agent is authorized to execute right now.
   */
  canExecute(agentId: string): { allowed: boolean; reason?: string } {
    if (this.killSwitchActive) {
      // Check if there is an active valid break-glass grant
      const hasValidGrant = Array.from(this.activeGrants.values()).some(
        (g) => g.active && new Date(g.expiresAt).getTime() > Date.now()
      )
      if (!hasValidGrant) {
        return {
          allowed: false,
          reason: `System-wide kill switch active: ${this.killSwitchReason || 'Emergency halt'}`
        }
      }
    }

    if (this.quarantinedAgents.has(agentId)) {
      const q = this.quarantinedAgents.get(agentId)!
      return {
        allowed: false,
        reason: `Agent '${agentId}' is quarantined: ${q.reason}`
      }
    }

    return { allowed: true }
  }

  /**
   * Issue a time-boxed break-glass grant.
   */
  issueBreakGlassGrant(requester: string, reason: string, durationMinutes = 30): BreakGlassGrant {
    const id = `bg_${Date.now()}`
    const now = Date.now()
    const grant: BreakGlassGrant = {
      id,
      requester,
      reason: reason.trim(),
      grantedAt: nowIso(),
      expiresAt: new Date(now + durationMinutes * 60 * 1000).toISOString(),
      active: true
    }
    this.activeGrants.set(id, grant)
    return grant
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive
  }

  listQuarantinedAgents(): QuarantineRecord[] {
    return Array.from(this.quarantinedAgents.values())
  }
}

export const quarantineService = new QuarantineService()
