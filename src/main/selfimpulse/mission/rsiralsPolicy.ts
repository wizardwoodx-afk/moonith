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
/** Unreadable numbers never poison the arithmetic; they contribute nothing. */
const finiteNumber = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * Persisted run records are JSON that this module never wrote itself, so a
 * truncated or hand-edited entry can carry non-boolean flags. A flag that is
 * not a boolean is unreadable evidence, not evidence of success — matching the
 * strict `=== true` comparisons the rest of this module already uses.
 */
const isReadableRun = (run: MeasuredPolicyRun | null | undefined): boolean =>
  !!run &&
  typeof run === 'object' &&
  typeof run.verified === 'boolean' &&
  typeof run.simulated === 'boolean' &&
  (run.heldOut === undefined || typeof run.heldOut === 'boolean') &&
  (run.evidenceLeak === undefined || typeof run.evidenceLeak === 'boolean')

/**
 * Small, explicit regularizers — quality remains the dominant term. A missing
 * dimension costs nothing; refusing to judge an arm on unreadable parameters is
 * `comparePolicyArms`' job, not the penalty's.
 */
export function policyComplexityPenalty(params: PolicyComplexity): number {
  const p = params ?? ({} as PolicyComplexity)
  return (
    Math.max(0, finiteNumber(p.reviewDepth) - 1) * 0.002 +
    clamp01(finiteNumber(p.checkBias)) * 0.004 +
    (p.serialExec === true ? 0.003 : 0) +
    Math.max(0, finiteNumber(p.lessonBudget)) * 0.001 +
    (p.mosaic === true ? 0.002 : 0)
  )
}

/** An arm whose parameters cannot be read cannot be certified as an improvement. */
const isEvaluableComplexity = (params: PolicyComplexity | null | undefined): boolean =>
  !!params &&
  typeof params === 'object' &&
  Number.isFinite(params.reviewDepth) &&
  Number.isFinite(params.checkBias) &&
  Number.isFinite(params.lessonBudget) &&
  typeof params.serialExec === 'boolean' &&
  typeof params.mosaic === 'boolean'

/**
 * Score only uncontaminated real runs. Simulations and leaked evaluations are
 * not failures and are not successes: they are absent evidence.
 */
export function regularizedPolicyScore(
  runs: MeasuredPolicyRun[],
  params: PolicyComplexity
): RegularizedScore {
  const real = runs.filter(
    (run) => isReadableRun(run) && run.simulated === false && run.evidenceLeak !== true
  )
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

  const quality = real.filter((run) => run.verified === true).length / real.length
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
 *
 * The gate is fail-closed: malformed arm parameters or non-finite thresholds
 * hold the current baseline ('wait') instead of producing an 'adopt'.
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
    reason: string,
    awaitingHeldOut =
      decision === 'wait' &&
      baseline.measured >= args.minTrials &&
      candidate.measured >= args.minTrials &&
      developmentMargin !== null &&
      developmentMargin > args.adoptMargin
  ): ArmComparison => ({
    decision,
    reason,
    baseline,
    candidate,
    heldOutBaseline,
    heldOutCandidate,
    developmentMargin,
    awaitingHeldOut
  })

  // Fail closed before any comparison: unreadable inputs must never be able to
  // produce an 'adopt'. A NaN margin or threshold compares `<=`/`<` as false,
  // which previously slipped past the retire guard and reached the verdict.
  if (!isEvaluableComplexity(args.baselineParams) || !isEvaluableComplexity(args.candidateParams)) {
    return result(
      'wait',
      'refusing to decide: an experiment arm has missing or malformed policy parameters',
      false
    )
  }
  if (
    !Number.isFinite(args.minTrials) ||
    args.minTrials < 1 ||
    !Number.isFinite(args.adoptMargin)
  ) {
    return result(
      'wait',
      'refusing to decide: the acceptance gate needs a finite minTrials of at least 1 and a finite adoptMargin',
      false
    )
  }

  if (baseline.measured < args.minTrials || candidate.measured < args.minTrials) {
    return result(
      'wait',
      `waiting for ${args.minTrials} uncontaminated real development runs per arm ` +
        `(baseline ${baseline.measured}, candidate ${candidate.measured})`
    )
  }
  if (
    developmentMargin === null ||
    !Number.isFinite(developmentMargin) ||
    developmentMargin <= args.adoptMargin
  ) {
    return result(
      'retire',
      `regularized development margin ${
        developmentMargin === null || !Number.isFinite(developmentMargin)
          ? 'unknown'
          : developmentMargin.toFixed(4)
      } did not exceed ${args.adoptMargin}; ` +
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
