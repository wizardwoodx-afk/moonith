import {
  OUTCOME_AUTONOMY_LEVELS,
  OUTCOME_DATA_CLASSES,
  OUTCOME_ENVIRONMENTS,
  type OutcomeAutonomyGrant,
  type OutcomeAutonomyLevel,
  type OutcomeCheckDefinition,
  type OutcomeCheckResult,
  type OutcomeContract,
  type OutcomeContractDefinition,
  type OutcomeContractVersion,
  type OutcomeDataClass,
  type OutcomeEnvironment,
  type OutcomeEvidenceReceipt,
  type OutcomeExecutionEvidence,
  type OutcomeExecutionGrant,
  type OutcomeModelVersion,
  type OutcomePromotionRecommendation,
  type OutcomeRunObservation
} from '../../../shared/verifiedOutcomes'

export function outcomeText(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  const result = value.trim()
  if (!result || result.length > maximum || /[\u0000-\u001f]/.test(result)) {
    throw new Error(`${label} must contain 1–${maximum} printable characters.`)
  }
  return result
}

export function outcomeId(value: unknown, label = 'id'): string {
  const result = outcomeText(value, label, 140)
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@-]*$/.test(result)) {
    throw new Error(`${label} may contain letters, numbers, and : . _ @ - only.`)
  }
  return result
}

export function isOutcomeLevel(value: unknown): value is OutcomeAutonomyLevel {
  return typeof value === 'string' && OUTCOME_AUTONOMY_LEVELS.includes(value as OutcomeAutonomyLevel)
}

export function isOutcomeDataClass(value: unknown): value is OutcomeDataClass {
  return typeof value === 'string' && OUTCOME_DATA_CLASSES.includes(value as OutcomeDataClass)
}

export function isOutcomeEnvironment(value: unknown): value is OutcomeEnvironment {
  return typeof value === 'string' && OUTCOME_ENVIRONMENTS.includes(value as OutcomeEnvironment)
}

export function outcomeLevelRank(level: OutcomeAutonomyLevel): number {
  return OUTCOME_AUTONOMY_LEVELS.indexOf(level)
}

export function activeOutcomeVersion(contract: OutcomeContract): OutcomeContractVersion | null {
  return contract.versions.find((version) => version.status === 'active') ?? null
}

export function outcomeVersion(
  contract: OutcomeContract,
  revision: number
): OutcomeContractVersion | null {
  return contract.versions.find((version) => version.revision === revision) ?? null
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value as number
}

function checkDefinition(value: unknown, index: number): OutcomeCheckDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Check ${index + 1} must be an object.`)
  }
  const input = value as Record<string, unknown>
  const base = {
    id: outcomeId(input.id, `check ${index + 1} id`),
    label: outcomeText(input.label, `check ${index + 1} label`, 140),
    required: input.required !== false
  }
  if (input.required !== undefined && typeof input.required !== 'boolean') {
    throw new Error(`Check ${base.id} required must be boolean.`)
  }
  if (input.kind === 'task-completed' || input.kind === 'no-failed-tools' || input.kind === 'plan-complete') {
    return { ...base, kind: input.kind }
  }
  if (input.kind === 'minimum-artifacts') {
    return {
      ...base,
      kind: input.kind,
      minimum: integer(input.minimum, `check ${base.id} minimum`, 1, 10_000)
    }
  }
  if (input.kind === 'required-tool') {
    return {
      ...base,
      kind: input.kind,
      tool: outcomeId(input.tool, `check ${base.id} tool`),
      minimum: integer(input.minimum, `check ${base.id} minimum`, 1, 10_000)
    }
  }
  throw new Error(`Check ${base.id} has an unsupported kind.`)
}

/** Validates untrusted IPC/storage-shaped definitions before they govern a run. */
export function validateOutcomeDefinition(value: OutcomeContractDefinition): OutcomeContractDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Outcome definition must be an object.')
  }
  if (!Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 20) {
    throw new Error('An outcome contract needs 1–20 deterministic checks.')
  }
  const checks = value.checks.map(checkDefinition)
  if (new Set(checks.map((check) => check.id)).size !== checks.length) {
    throw new Error('Outcome check ids must be unique.')
  }
  if (!checks.some((check) => check.required)) {
    throw new Error('At least one outcome check must be required.')
  }
  if (!value.promotion || typeof value.promotion !== 'object') {
    throw new Error('Promotion policy is required.')
  }
  const minimumRuns = integer(value.promotion.minimumRuns, 'minimumRuns', 1, 100)
  const lookbackDays = integer(value.promotion.lookbackDays, 'lookbackDays', 1, 365)
  const rate = value.promotion.minimumPassRate
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1) {
    throw new Error('minimumPassRate must be greater than 0 and at most 1.')
  }
  if (!isOutcomeLevel(value.autonomyCeiling)) throw new Error('Unsupported autonomy ceiling.')
  if (typeof value.humanReviewRequired !== 'boolean') {
    throw new Error('humanReviewRequired must be boolean.')
  }
  return {
    downstreamOutcome: outcomeText(value.downstreamOutcome, 'downstream outcome', 500),
    checks,
    promotion: { minimumRuns, minimumPassRate: rate, lookbackDays },
    autonomyCeiling: value.autonomyCeiling,
    humanReviewRequired: value.humanReviewRequired
  }
}

export function evaluateOutcomeChecks(
  definition: Pick<OutcomeContractDefinition, 'checks'>,
  observation: OutcomeRunObservation
): OutcomeCheckResult[] {
  return definition.checks.map((check) => {
    let passed = false
    let observed = ''
    if (check.kind === 'task-completed') {
      passed = observation.taskStatus === 'done'
      observed = `task status: ${observation.taskStatus}`
    } else if (check.kind === 'no-failed-tools') {
      const failures = observation.steps.filter((step) => step.status === 'error').length
      passed = failures === 0
      observed = `${failures} failed tool step${failures === 1 ? '' : 's'}`
    } else if (check.kind === 'required-tool') {
      const successes = observation.steps.filter(
        (step) => step.tool === check.tool && step.status === 'ok'
      ).length
      passed = successes >= check.minimum
      observed = `${successes}/${check.minimum} successful ${check.tool} step${check.minimum === 1 ? '' : 's'}`
    } else if (check.kind === 'minimum-artifacts') {
      passed = observation.artifacts >= check.minimum
      observed = `${observation.artifacts}/${check.minimum} artifact${check.minimum === 1 ? '' : 's'}`
    } else {
      passed = observation.planTotal > 0 && observation.planDone === observation.planTotal
      observed = `${observation.planDone}/${observation.planTotal} plan steps complete`
    }
    return {
      id: check.id,
      label: check.label,
      required: check.required,
      passed,
      observed
    }
  })
}

export function checksPassed(results: OutcomeCheckResult[]): boolean {
  return results.filter((result) => result.required).every((result) => result.passed)
}

export interface OutcomeActionProfile {
  sideEffect: 'none' | 'read' | 'write' | 'execute' | 'network'
  risk: 'low' | 'medium' | 'high'
  approval: 'never' | 'policy' | 'always'
}

export function consequentialOutcomeAction(tool: OutcomeActionProfile): boolean {
  return (
    tool.sideEffect === 'write' ||
    tool.sideEffect === 'execute' ||
    tool.approval === 'always' ||
    (tool.sideEffect === 'network' && tool.risk !== 'low')
  )
}

export type OutcomeActionMode = 'allow' | 'require-approval' | 'deny' | 'allow-autonomous'

export interface OutcomeActionDecision {
  mode: OutcomeActionMode
  level: OutcomeAutonomyLevel
  reason: string
  grantId?: string
}

function oneExecution(
  attempts: OutcomeModelVersion[]
): OutcomeModelVersion | null {
  if (attempts.length !== 1) return null
  const attempt = attempts[0]
  return attempt.providerId && attempt.model ? attempt : null
}

export function sameModel(left: OutcomeModelVersion, right: OutcomeModelVersion): boolean {
  return left.providerId === right.providerId && left.model === right.model
}

export function sameExecutionGrant(
  left: OutcomeExecutionGrant,
  right: OutcomeExecutionGrant
): boolean {
  return left.policyDigest === right.policyDigest && sameModel(left.model, right.model)
}

/**
 * The final scoped-autonomy decision. It can only add a human gate or reduce
 * authority unless every bounded-grant field matches exactly. High-risk and
 * always-approval tools never become autonomous.
 */
export function decideOutcomeAction(input: {
  contract: OutcomeContract
  contractRevision: number
  agentId: string
  toolName: string
  tool: OutcomeActionProfile
  dataClass: OutcomeDataClass
  environment: OutcomeEnvironment
  grants: OutcomeAutonomyGrant[]
  execution: OutcomeExecutionEvidence
  currentPolicyDigest: string
}): OutcomeActionDecision {
  if (!consequentialOutcomeAction(input.tool)) {
    return { mode: 'allow', level: 'bounded-autonomy', reason: 'Read-only or non-consequential action.' }
  }

  const candidates = input.grants
    .filter(
      (grant) =>
        grant.status === 'active' &&
        grant.contractId === input.contract.id &&
        grant.agentId === input.agentId &&
        grant.dataClass === input.dataClass &&
        grant.environment === input.environment &&
        grant.tools.includes(input.toolName)
    )
    // Adding another grant must never widen authority unexpectedly.
    .sort((left, right) => outcomeLevelRank(left.level) - outcomeLevelRank(right.level))
  const grant = candidates[0]
  if (!grant) {
    return {
      mode: 'require-approval',
      level: 'approved-action',
      reason: 'No active grant covers this exact agent, workflow, tool, data class, and environment.'
    }
  }
  if (grant.level === 'observe' || grant.level === 'suggest') {
    return {
      mode: 'deny',
      level: grant.level,
      grantId: grant.id,
      reason: `${grant.level} grants do not permit consequential tool actions.`
    }
  }
  const human = (reason: string): OutcomeActionDecision => ({
    mode: 'require-approval',
    level: 'approved-action',
    grantId: grant.id,
    reason
  })
  if (grant.circuitOpen) return human('The autonomy circuit is open after a material outcome failure.')
  if (grant.status !== 'active') return human('The matching grant is not active.')
  if (grant.level !== 'bounded-autonomy') return human('This grant requires an approved action.')
  if (input.tool.risk === 'high' || input.tool.approval === 'always') {
    return human('High-risk and always-approval tools cannot run autonomously.')
  }
  if (input.contract.lifecycle !== 'active') return human('The outcome contract is not active.')
  const active = activeOutcomeVersion(input.contract)
  if (
    !active ||
    active.revision !== input.contractRevision ||
    grant.contractRevision !== active.revision ||
    outcomeLevelRank(active.autonomyCeiling) < outcomeLevelRank('bounded-autonomy') ||
    outcomeLevelRank(grant.ceiling) < outcomeLevelRank('bounded-autonomy')
  ) {
    return human('The contract or grant revision changed; bounded autonomy must be re-authorized.')
  }
  const model = oneExecution(input.execution.attempts)
  if (
    !grant.execution ||
    !model ||
    input.execution.policyDigests.length !== 1 ||
    input.execution.policyDigests[0] !== input.currentPolicyDigest ||
    !sameModel(grant.execution.model, model) ||
    grant.execution.policyDigest !== input.currentPolicyDigest
  ) {
    return human('The model or policy version does not exactly match the authorized evidence.')
  }
  return {
    mode: 'allow-autonomous',
    level: 'bounded-autonomy',
    grantId: grant.id,
    reason: 'Exact scoped grant, active contract, model, and policy evidence match.'
  }
}

function executionForReceipt(receipt: OutcomeEvidenceReceipt): OutcomeExecutionGrant | null {
  const model = oneExecution(receipt.execution.attempts)
  if (!model || receipt.execution.policyDigests.length !== 1) return null
  return { model, policyDigest: receipt.execution.policyDigests[0] }
}

function nextLevel(level: OutcomeAutonomyLevel): OutcomeAutonomyLevel {
  return OUTCOME_AUTONOMY_LEVELS[
    Math.min(OUTCOME_AUTONOMY_LEVELS.length - 1, outcomeLevelRank(level) + 1)
  ]
}

/** Pure eligibility calculation. Only the administrative mutation can apply it. */
export function recommendOutcomePromotion(input: {
  grant: OutcomeAutonomyGrant
  contract: OutcomeContract
  receipts: OutcomeEvidenceReceipt[]
  now: number
}): OutcomePromotionRecommendation {
  const { grant, contract, receipts } = input
  const targetLevel = grant.level === 'bounded-autonomy' ? 'bounded-autonomy' : nextLevel(grant.level)
  const empty: OutcomePromotionRecommendation = {
    grantId: grant.id,
    targetLevel,
    eligible: false,
    reasons: [],
    execution: null,
    sampleSize: 0,
    passRate: 0,
    receiptIds: []
  }
  if (grant.status !== 'active') {
    empty.reasons.push('The grant is not active.')
    return empty
  }
  if (targetLevel === grant.level && !grant.circuitOpen) {
    const active = activeOutcomeVersion(contract)
    if (active?.revision === grant.contractRevision && grant.execution) {
      empty.reasons.push('The grant is already authorized at this level.')
      return empty
    }
  }
  if (outcomeLevelRank(targetLevel) > outcomeLevelRank(grant.ceiling)) {
    empty.reasons.push('The grant ceiling does not permit this promotion.')
    return empty
  }
  const active = activeOutcomeVersion(contract)
  if (!active || contract.lifecycle !== 'active') {
    empty.reasons.push('The contract has no active revision.')
    return empty
  }
  if (outcomeLevelRank(targetLevel) > outcomeLevelRank(active.autonomyCeiling)) {
    empty.reasons.push('The active contract ceiling does not permit this promotion.')
    return empty
  }
  if (outcomeLevelRank(targetLevel) <= outcomeLevelRank('approved-action')) {
    empty.eligible = true
    empty.reasons.push('An administrator may authorize this lower-autonomy transition.')
    return empty
  }

  const cutoff = input.now - active.promotion.lookbackDays * 24 * 60 * 60 * 1000
  const circuitCutoff = grant.circuitOpen && grant.circuitOpenedAt
    ? Date.parse(grant.circuitOpenedAt)
    : 0
  const relevant = receipts.filter((receipt) => {
    const at = Date.parse(receipt.createdAt)
    return (
      receipt.contractId === contract.id &&
      receipt.contractRevision === active.revision &&
      receipt.agentIds.includes(grant.agentId) &&
      receipt.binding.dataClass === grant.dataClass &&
      receipt.binding.environment === grant.environment &&
      at >= cutoff &&
      at > circuitCutoff
    )
  })
  const groups = new Map<string, { execution: OutcomeExecutionGrant; receipts: OutcomeEvidenceReceipt[] }>()
  for (const receipt of relevant) {
    const execution = executionForReceipt(receipt)
    if (!execution) continue
    const key = `${execution.model.providerId}\u0000${execution.model.model}\u0000${execution.policyDigest}`
    const group = groups.get(key) ?? { execution, receipts: [] }
    group.receipts.push(receipt)
    groups.set(key, group)
  }

  let best: OutcomePromotionRecommendation | null = null
  for (const group of groups.values()) {
    const ordered = [...group.receipts].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const sample = ordered.filter(
      (receipt) => receipt.verificationStatus === 'verified' || receipt.verificationStatus === 'failed'
    )
    const passed = sample.filter((receipt) => receipt.verificationStatus === 'verified').length
    const passRate = sample.length ? passed / sample.length : 0
    const reasons: string[] = []
    if (sample.length < active.promotion.minimumRuns) {
      reasons.push(`Needs ${active.promotion.minimumRuns} settled runs on one exact model/policy version; found ${sample.length}.`)
    }
    if (passRate < active.promotion.minimumPassRate) {
      reasons.push(`Verified pass rate ${(passRate * 100).toFixed(1)}% is below ${(active.promotion.minimumPassRate * 100).toFixed(1)}%.`)
    }
    if (ordered.some((receipt) => receipt.verificationStatus === 'pending-review')) {
      reasons.push('A relevant outcome still needs human review.')
    }
    if (!ordered[0] || ordered[0].verificationStatus !== 'verified') {
      reasons.push('The most recent attributable outcome is not verified.')
    }
    if (sample.some((receipt) => receipt.materialFailure && receipt.verificationStatus !== 'verified')) {
      reasons.push('A material failure in the evidence window must be followed by a clean recovery record.')
    }
    const candidate: OutcomePromotionRecommendation = {
      grantId: grant.id,
      targetLevel,
      eligible: reasons.length === 0,
      reasons: reasons.length ? reasons : ['Evidence satisfies the contract for administrator authorization.'],
      execution: group.execution,
      sampleSize: sample.length,
      passRate,
      receiptIds: sample.slice(0, 50).map((receipt) => receipt.id)
    }
    if (
      !best ||
      (candidate.eligible && !best.eligible) ||
      (candidate.eligible === best.eligible && candidate.sampleSize > best.sampleSize)
    ) {
      best = candidate
    }
  }
  if (best) return best
  empty.reasons.push(
    grant.circuitOpen
      ? 'No new attributable recovery evidence has been recorded since the circuit opened.'
      : 'No attributable evidence matches this exact scope and active contract revision.'
  )
  return empty
}
