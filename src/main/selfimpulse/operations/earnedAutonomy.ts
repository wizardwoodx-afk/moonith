/**
 * Earned Autonomy Engine for SelfImpulse.
 *
 * Implements measurable progressive autonomy:
 * Agents do not start with carte-blanche authority. They earn autonomy levels based on
 * verified reliability, task success history, and low human override rates.
 *
 * Tiers:
 * - Level 1: Supervised (Manual approval required for all state modifications)
 * - Level 2: Semi-Autonomous (Routine tools auto-approved; only danger/sensitive tools pause)
 * - Level 3: Autonomous (Full execution with post-hoc flight recorder verification)
 */
import { nowIso } from '../../util'

export type AutonomyLevel = 'supervised' | 'semi_autonomous' | 'autonomous'

export interface AgentAutonomyProfile {
  agentId: string
  level: AutonomyLevel
  verifiedProofCount: number
  totalTasksCompleted: number
  overrideCount: number
  reliabilityScore: number // 0 - 100
  lastEvaluatedAt: string
}

export class EarnedAutonomyService {
  private profiles: Map<string, AgentAutonomyProfile> = new Map()

  getProfile(agentId: string): AgentAutonomyProfile {
    let profile = this.profiles.get(agentId)
    if (!profile) {
      profile = {
        agentId,
        level: 'supervised',
        verifiedProofCount: 0,
        totalTasksCompleted: 0,
        overrideCount: 0,
        reliabilityScore: 80,
        lastEvaluatedAt: nowIso()
      }
      this.profiles.set(agentId, profile)
    }
    return profile
  }

  /**
   * Record a completed task and recalculate autonomy level.
   */
  recordTaskOutcome(
    agentId: string,
    success: boolean,
    hadHumanOverride: boolean,
    earnedProofOfWork = false
  ): AgentAutonomyProfile {
    const p = this.getProfile(agentId)
    p.totalTasksCompleted += 1
    if (hadHumanOverride) p.overrideCount += 1
    if (earnedProofOfWork && success) p.verifiedProofCount += 1

    // Update reliability score: rewards success + proof, penalizes overrides
    const successRatio = success ? 1 : 0
    const overridePenalty = hadHumanOverride ? 15 : 0
    const proofBonus = earnedProofOfWork ? 5 : 0

    p.reliabilityScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          p.reliabilityScore * 0.85 + (successRatio * 100 - overridePenalty + proofBonus) * 0.15
        )
      )
    )

    // Evaluate Promotion / Demotion
    const overrideRate = (p.overrideCount / p.totalTasksCompleted) * 100

    if (p.verifiedProofCount >= 15 && p.reliabilityScore >= 92 && overrideRate < 5) {
      p.level = 'autonomous'
    } else if (p.verifiedProofCount >= 3 && p.reliabilityScore >= 85 && overrideRate < 15) {
      p.level = 'semi_autonomous'
    } else {
      p.level = 'supervised'
    }

    p.lastEvaluatedAt = nowIso()
    return p
  }

  /**
   * Check if an agent is authorized for auto-execution at its current level.
   */
  canAutoExecute(agentId: string, riskTier: 'safe' | 'warn' | 'danger'): boolean {
    if (riskTier === 'danger') return false
    if (riskTier === 'safe') return true

    const profile = this.getProfile(agentId)
    // Warn actions are auto-executable ONLY if the agent earned 'autonomous' level
    return profile.level === 'autonomous'
  }
}

export const earnedAutonomy = new EarnedAutonomyService()
