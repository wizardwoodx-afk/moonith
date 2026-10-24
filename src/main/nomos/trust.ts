/**
 * Nomos trust — a signal, never an authority.
 *
 * The score moves with measured behaviour: verified successes raise it,
 * failures and refused attempts lower it. It is clamped, per agent, and it
 * starts at a neutral floor. Two rules keep it honest:
 *
 *   1. Trust can only ever ESCALATE scrutiny. A low-trust agent asking for a
 *      medium-risk action is steered to a human; a high-trust agent asking
 *      for a high-risk action is STILL steered. No score auto-authorizes a
 *      dangerous action.
 *   2. Trust is never the reason a hard rule denies. Hard rules (identity,
 *      capability, kill switch, malformed policy) do not consult it.
 */

export type TrustBand = 'low' | 'guarded' | 'established'

export interface TrustView {
  agentId: string
  score: number
  band: TrustBand
}

/** Neutral start: a new agent is neither trusted nor distrusted. */
export const TRUST_FLOOR = 0.5
export const TRUST_MAX = 1
export const TRUST_MIN = 0

const SUCCESS_DELTA = 0.02
const FAILURE_DELTA = -0.15
const DENIAL_DELTA = -0.05

const ESTABLISHED_AT = 0.66
const GUARDED_AT = 0.33

function clamp(value: number): number {
  return Math.min(TRUST_MAX, Math.max(TRUST_MIN, value))
}

export function bandFor(score: number): TrustBand {
  if (score >= ESTABLISHED_AT) return 'established'
  if (score >= GUARDED_AT) return 'guarded'
  return 'low'
}

export class TrustEngine {
  private scores = new Map<string, number>()

  score(agentId: string): number {
    return this.scores.get(agentId) ?? TRUST_FLOOR
  }

  view(agentId: string): TrustView {
    const score = this.score(agentId)
    return { agentId, score, band: bandFor(score) }
  }

  /** A verified success (the tool ran and its result checked out). */
  recordSuccess(agentId: string): void {
    this.scores.set(agentId, clamp(this.score(agentId) + SUCCESS_DELTA))
  }

  /** A failed or erroring action. */
  recordFailure(agentId: string): void {
    this.scores.set(agentId, clamp(this.score(agentId) + FAILURE_DELTA))
  }

  /** An action the gate refused — the agent asked for something it should not. */
  recordDenial(agentId: string): void {
    this.scores.set(agentId, clamp(this.score(agentId) + DENIAL_DELTA))
  }

  /** Forget an agent (its seat ended). */
  forget(agentId: string): void {
    this.scores.delete(agentId)
  }
}
