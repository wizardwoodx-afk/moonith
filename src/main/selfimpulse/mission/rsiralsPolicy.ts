/**
 * RSIRALS policy evaluation — measured, non-parametric improvement.
 *
 * This module deliberately contains no model or code-rewrite machinery. It
 * scores the runtime/harness policies SelfImpulse actually executes and keeps
 * the acceptance decision pure and testable. The design follows the useful
 * parts of recent RSI/agent-memory research: conservative selection under
 * noisy evidence, explicit cost/complexity penalties, and a final transfer
 * check on runs reserved from development scoring.
 */

export interface MeasuredPolicyRun {
  verified: boolean
  simulated: boolean
  heldOut?: boolean
  /** Evidence contamination excludes a run from every learning statistic. */
  evidenceLeak?: boolean
  costUsd?: number
  policyTokens?: number
}

export interface PolicyComplexity {
  reviewDepth: number
  checkBias: number
  serialExec: boolean
  lessonBudget: number
  mosaic: boolean
}

export interface RegularizedScore {
  /** Utility after uncertainty, measured-cost, token, and complexity penalties. */
  score: number | null
  /** Unregularized verified rate; never hidden behind the utility score. */
  quality: number | null
  measured: number
  uncertaintyPenalty: number
  costPenalty: number
  tokenPenalty: number
  complexityPenalty: number
  meanCostUsd: number
  meanPolicyTokens: number
}

export interface ArmComparison {
  decision: 'adopt' | 'retire' | 'wait'
  reason: string
  baseline: RegularizedScore
  candidate: RegularizedScore
  heldOutBaseline: RegularizedScore
  heldOutCandidate: RegularizedScore
  developmentMargin: number | null
  awaitingHeldOut: boolean
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
const finiteNonNegative = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

/** Small, explicit regularizers — quality remains the dominant term. */
export function policyComplexityPenalty(params: PolicyComplexity): number {
  return (
    Math.max(0, params.reviewDepth - 1) * 0.002 +
    clamp01(params.checkBias) * 0.004 +
    (params.serialExec ? 0.003 : 0) +
    Math.max(0, params.lessonBudget) * 0.001 +
    (params.mosaic ? 0.002 : 0)
  )
}

/**
 * Score only uncontaminated real runs. Simulations and leaked evaluations are
 * not failures and are not successes: they are absent evidence.
 */
export function regularizedPolicyScore(
  runs: MeasuredPolicyRun[],
  params: PolicyComplexity
): RegularizedScore {
  const real = runs.filter((run) => !run.simulated && run.evidenceLeak !== true)
  const complexityPenalty = policyComplexityPenalty(params)
  if (real.length === 0) {
    return {
      score: null,
      quality: null,
      measured: 0,
      uncertaintyPenalty: 0,
      costPenalty: 0,
      tokenPenalty: 0,
      complexityPenalty,
      meanCostUsd: 0,
      meanPolicyTokens: 0
    }
  }

  const quality = real.filter((run) => run.verified).length / real.length
  const measuredCosts = real.map((run) => run.costUsd).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const measuredTokens = real.map((run) => run.policyTokens).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  // Unknown usage contributes no invented zero to the measured averages.
  const meanCostUsd = measuredCosts.length > 0
    ? measuredCosts.reduce((sum, value) => sum + finiteNonNegative(value), 0) / measuredCosts.length
    : 0
  const meanPolicyTokens = measuredTokens.length > 0
    ? measuredTokens.reduce((sum, value) => sum + finiteNonNegative(value), 0) / measuredTokens.length
    : 0
  // Bernoulli standard error: conservative when evidence is mixed and sparse,
  // without pretending that three or eight runs establish a precise probability.
  const uncertaintyPenalty = 0.05 * Math.sqrt((quality * (1 - quality)) / real.length)
  const costPenalty = 0.01 * Math.log1p(meanCostUsd)
  const tokenPenalty = 0.002 * Math.log1p(meanPolicyTokens / 1000)
  const score = quality - uncertaintyPenalty - costPenalty - tokenPenalty - complexityPenalty
  return {
    score,
    quality,
    measured: real.length,
    uncertaintyPenalty,
    costPenalty,
    tokenPenalty,
    complexityPenalty,
    meanCostUsd,
    meanPolicyTokens
  }
}

/**
 * Two-stage experiment gate. Development runs decide whether a candidate is
 * promising; only then do reserved held-out runs decide whether the measured
 * gain transfers. A candidate with no development advantage retires early and
 * never gets to cherry-pick a favourable held-out result.
 */
export function comparePolicyArms(args: {
  baselineRuns: MeasuredPolicyRun[]
  candidateRuns: MeasuredPolicyRun[]
  baselineParams: PolicyComplexity
  candidateParams: PolicyComplexity
  minTrials: number
  adoptMargin: number
}): ArmComparison {
  const baselineDevelopment = args.baselineRuns.filter((run) => run.heldOut !== true)
  const candidateDevelopment = args.candidateRuns.filter((run) => run.heldOut !== true)
  const baseline = regularizedPolicyScore(baselineDevelopment, args.baselineParams)
  const candidate = regularizedPolicyScore(candidateDevelopment, args.candidateParams)
  const heldOutBaseline = regularizedPolicyScore(
    args.baselineRuns.filter((run) => run.heldOut === true),
    args.baselineParams
  )
  const heldOutCandidate = regularizedPolicyScore(
    args.candidateRuns.filter((run) => run.heldOut === true),
    args.candidateParams
  )
  const developmentMargin =
    baseline.score === null || candidate.score === null ? null : candidate.score - baseline.score
  const result = (
    decision: ArmComparison['decision'],
    reason: string
  ): ArmComparison => ({
    decision,
    reason,
    baseline,
    candidate,
    heldOutBaseline,
    heldOutCandidate,
    developmentMargin,
    awaitingHeldOut:
      decision === 'wait' &&
      baseline.measured >= args.minTrials &&
      candidate.measured >= args.minTrials &&
      developmentMargin !== null &&
      developmentMargin > args.adoptMargin
  })

  if (baseline.measured < args.minTrials || candidate.measured < args.minTrials) {
    return result(
      'wait',
      `waiting for ${args.minTrials} uncontaminated real development runs per arm ` +
        `(baseline ${baseline.measured}, candidate ${candidate.measured})`
    )
  }
  if (developmentMargin === null || developmentMargin <= args.adoptMargin) {
    return result(
      'retire',
      `regularized development margin ${developmentMargin?.toFixed(4) ?? 'unknown'} did not exceed ${args.adoptMargin}; ` +
        'quality, uncertainty, measured cost, tokens, and policy complexity are all included'
    )
  }
  if (heldOutBaseline.measured < 1 || heldOutCandidate.measured < 1) {
    return result(
      'wait',
      `development margin ${developmentMargin.toFixed(4)} is promising; waiting for one uncontaminated real held-out run per arm ` +
        `(baseline ${heldOutBaseline.measured}, candidate ${heldOutCandidate.measured})`
    )
  }
  const baseTransfer = heldOutBaseline.quality as number
  const candidateTransfer = heldOutCandidate.quality as number
  // With one reserved run per arm, allow only numerical slack around equality.
  // Any observed transfer regression is a rejection, not an average hidden by
  // the development gain.
  if (candidateTransfer + 0.02 < baseTransfer) {
    return result(
      'retire',
      `held-out transfer regressed: candidate verified rate ${candidateTransfer.toFixed(2)} versus baseline ${baseTransfer.toFixed(2)}`
    )
  }
  return result(
    'adopt',
    `adopted: regularized development margin ${developmentMargin.toFixed(4)} exceeded ${args.adoptMargin}, ` +
      `and held-out transfer did not regress (candidate ${candidateTransfer.toFixed(2)}, baseline ${baseTransfer.toFixed(2)})`
  )
}
