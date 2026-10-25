/** Verified Outcomes — native outcome contracts, evidence, and scoped autonomy. */

export const VERIFIED_OUTCOMES_IPC = {
  snapshot: 'verified-outcomes:snapshot',
  mutate: 'verified-outcomes:mutate'
} as const

export const OUTCOME_DATA_CLASSES = ['public', 'internal', 'confidential', 'restricted'] as const
export const OUTCOME_ENVIRONMENTS = ['development', 'staging', 'production'] as const
export const OUTCOME_AUTONOMY_LEVELS = [
  'observe',
  'suggest',
  'approved-action',
  'bounded-autonomy'
] as const

export type OutcomeDataClass = (typeof OUTCOME_DATA_CLASSES)[number]
export type OutcomeEnvironment = (typeof OUTCOME_ENVIRONMENTS)[number]
export type OutcomeAutonomyLevel = (typeof OUTCOME_AUTONOMY_LEVELS)[number]
export type OutcomeContractLifecycle = 'active' | 'disabled' | 'archived'
export type OutcomeVersionStatus = 'draft' | 'active' | 'retired'

interface OutcomeCheckBase {
  id: string
  label: string
  required: boolean
}

export type OutcomeCheckDefinition =
  | (OutcomeCheckBase & { kind: 'task-completed' })
  | (OutcomeCheckBase & { kind: 'no-failed-tools' })
  | (OutcomeCheckBase & { kind: 'required-tool'; tool: string; minimum: number })
  | (OutcomeCheckBase & { kind: 'minimum-artifacts'; minimum: number })
  | (OutcomeCheckBase & { kind: 'plan-complete' })

export interface OutcomePromotionPolicy {
  minimumRuns: number
  minimumPassRate: number
  lookbackDays: number
}

export interface OutcomeContractDefinition {
  /** Declared downstream business state; not treated as proof by itself. */
  downstreamOutcome: string
  checks: OutcomeCheckDefinition[]
  promotion: OutcomePromotionPolicy
  autonomyCeiling: OutcomeAutonomyLevel
  humanReviewRequired: boolean
}

export interface OutcomeContractVersion extends OutcomeContractDefinition {
  revision: number
  status: OutcomeVersionStatus
  createdAt: string
  activatedAt?: string
}

export interface OutcomeContract {
  id: string
  workflowId: string
  name: string
  description: string
  lifecycle: OutcomeContractLifecycle
  versions: OutcomeContractVersion[]
  createdAt: string
  updatedAt: string
}

export interface OutcomeTaskBindingInput {
  contractId: string
  dataClass: OutcomeDataClass
  environment: OutcomeEnvironment
}

export interface OutcomeTaskBinding extends OutcomeTaskBindingInput {
  /** Pinned when the task is bound; a later draft cannot rewrite a live run. */
  contractRevision: number
}

export interface OutcomeModelVersion {
  providerId: string
  model: string
}

export interface OutcomeExecutionEvidence {
  /** Every provider/model attempted by Captain or Crew during this run. */
  attempts: OutcomeModelVersion[]
  /** Every enterprise/governance policy version observed during the run. */
  policyDigests: string[]
}

export interface OutcomeRunObservation {
  taskStatus: 'draft' | 'running' | 'waiting' | 'paused' | 'done' | 'error'
  steps: Array<{ tool: string; status: 'running' | 'waiting' | 'ok' | 'error' }>
  artifacts: number
  planTotal: number
  planDone: number
}

export interface OutcomeCheckResult {
  id: string
  label: string
  required: boolean
  passed: boolean
  observed: string
}

export interface OutcomeReceiptReview {
  state: 'not-required' | 'pending' | 'accepted' | 'rejected'
  by?: string
  at?: string
  note?: string
}

export interface OutcomeEvidenceReceipt {
  id: string
  taskId: string
  runId: string
  sourceDigest: string
  contractId: string
  contractRevision: number
  agentIds: string[]
  binding: OutcomeTaskBinding
  execution: OutcomeExecutionEvidence
  observation: OutcomeRunObservation
  /** Approved regressions evaluated (or applied as review gates) for this run. */
  regressionIds: string[]
  checks: OutcomeCheckResult[]
  checksPassed: boolean
  validEvidence: boolean
  invalidReasons: string[]
  verificationStatus: 'verified' | 'pending-review' | 'failed' | 'invalid'
  materialFailure: boolean
  review: OutcomeReceiptReview
  demotedGrantIds: string[]
  createdAt: string
  digest: string
}

export interface OutcomeExecutionGrant {
  model: OutcomeModelVersion
  policyDigest: string
}

export interface OutcomeAutonomyGrant {
  id: string
  contractId: string
  contractRevision: number
  agentId: string
  tools: string[]
  dataClass: OutcomeDataClass
  environment: OutcomeEnvironment
  level: OutcomeAutonomyLevel
  ceiling: OutcomeAutonomyLevel
  status: 'active' | 'suspended' | 'revoked'
  execution: OutcomeExecutionGrant | null
  circuitOpen: boolean
  circuitReason?: string
  circuitOpenedAt?: string
  createdBy: string
  authorizedBy: string
  createdAt: string
  updatedAt: string
  revision: number
}

export interface OutcomePromotionRecommendation {
  grantId: string
  targetLevel: OutcomeAutonomyLevel
  eligible: boolean
  reasons: string[]
  execution: OutcomeExecutionGrant | null
  sampleSize: number
  passRate: number
  receiptIds: string[]
}

export interface OutcomeRegressionCandidate {
  id: string
  contractId: string
  contractRevision: number
  binding: OutcomeTaskBinding
  failureFingerprint: string
  title: string
  status: 'pending' | 'approved' | 'rejected' | 'retired'
  /** A copied deterministic check, or null for a mandatory human-review gate. */
  check: OutcomeCheckDefinition | null
  sourceCheckId: string | null
  sourceReceiptIds: string[]
  occurrences: number
  createdAt: string
  updatedAt: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  retiredBy?: string
  retiredAt?: string
}

export interface OutcomeShadowEvaluation {
  id: string
  contractId: string
  contractRevision: number
  sourceRegressionIds: string[]
  cases: Array<{
    regressionId: string | null
    receiptId: string
    expected: 'pass' | 'fail'
    passed: boolean
    failedCheckIds: string[]
  }>
  passed: boolean
  createdAt: string
  digest: string
}

export interface VerifiedOutcomeSnapshot {
  revision: number
  contracts: OutcomeContract[]
  grants: OutcomeAutonomyGrant[]
  receipts: OutcomeEvidenceReceipt[]
  regressions: OutcomeRegressionCandidate[]
  shadows: OutcomeShadowEvaluation[]
  recommendations: OutcomePromotionRecommendation[]
  metrics: {
    activeContracts: number
    verifiedReceipts: number
    boundedGrants: number
    openCircuits: number
    pendingReviews: number
    pendingRegressions: number
  }
  security: {
    autonomyScope: string
    promotionAuthority: string
    evidence: string
    shadowBoundary: string
  }
}

export type VerifiedOutcomeOperation =
  | {
      type: 'contract.create'
      contract: {
        id?: string
        workflowId: string
        name: string
        description?: string
        definition: OutcomeContractDefinition
      }
    }
  | {
      type: 'contract.stage'
      contractId: string
      definition: OutcomeContractDefinition
    }
  | { type: 'contract.activate'; contractId: string; revision: number }
  | {
      type: 'contract.lifecycle'
      contractId: string
      lifecycle: OutcomeContractLifecycle
    }
  | {
      type: 'grant.create'
      grant: {
        id?: string
        contractId: string
        agentId: string
        tools: string[]
        dataClass: OutcomeDataClass
        environment: OutcomeEnvironment
        level?: Exclude<OutcomeAutonomyLevel, 'bounded-autonomy'>
        ceiling: OutcomeAutonomyLevel
      }
    }
  | { type: 'grant.promote'; grantId: string }
  | { type: 'grant.demote'; grantId: string }
  | {
      type: 'grant.status'
      grantId: string
      status: 'active' | 'suspended' | 'revoked'
    }
  | {
      type: 'receipt.review'
      receiptId: string
      decision: 'accepted' | 'rejected'
      note?: string
    }
  | {
      type: 'regression.review'
      candidateId: string
      decision: 'approved' | 'rejected'
      note?: string
    }
  | { type: 'regression.retire'; candidateId: string }
  | { type: 'shadow.run'; contractId: string; revision: number }

export interface VerifiedOutcomeMutation {
  expectedRevision: number
  reason: string
  operation: VerifiedOutcomeOperation
}

export interface VerifiedOutcomesApi {
  snapshot: () => Promise<VerifiedOutcomeSnapshot>
  mutate: (mutation: VerifiedOutcomeMutation) => Promise<VerifiedOutcomeSnapshot>
}

export const DEFAULT_OUTCOME_DEFINITION: OutcomeContractDefinition = {
  downstreamOutcome: 'A reviewer confirms that the expected downstream business result is present and correct.',
  checks: [
    { id: 'completed', label: 'Task completed', kind: 'task-completed', required: true },
    { id: 'clean-tools', label: 'No failed tool steps', kind: 'no-failed-tools', required: true }
  ],
  promotion: { minimumRuns: 3, minimumPassRate: 1, lookbackDays: 30 },
  autonomyCeiling: 'approved-action',
  humanReviewRequired: true
}
