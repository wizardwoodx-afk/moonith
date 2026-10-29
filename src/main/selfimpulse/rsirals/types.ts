/**
 * PROPRIETARY - SelfImpulse RSIRALS Octa-Module Type Contracts
 * Minimum viable schemas and formal contracts for the 8 RSIRALS modules.
 */

/* -------------------------------------------------------------------------
 * FAST LOOP: SENTRIX (Belief State + Risk-Aware Action Control)
 * ------------------------------------------------------------------------- */
export type ActionSideEffectClass = 
  | 'read-only' 
  | 'local-state' 
  | 'workspace-mutation' 
  | 'external-network' 
  | 'irreversible';

export interface ActionRequest {
  id: string;
  name: string;
  target?: string;
  parameters: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface BeliefFact {
  key: string;
  value: unknown;
  source: string;
  timestamp: string;
  confidence: number;
}

export interface BeliefUncertainty {
  dimension: string;
  description: string;
  entropy: number; // 0.0 (certain) to 1.0 (completely unknown)
}

export interface BeliefStatePacket {
  observedStateRef: string;
  knownFacts: BeliefFact[];
  uncertainties: BeliefUncertainty[];
  actionClass: ActionSideEffectClass;
  idempotencyKey: string;
  riskScore: number; // 0.0 (benign) to 1.0 (critical danger)
  policyDecision: 'allow' | 'sandbox' | 'probe' | 'stage' | 'require_approval' | 'deny';
  decisionReason: string;
}

/* -------------------------------------------------------------------------
 * FAST LOOP: AURIX / AURALIS (Adaptive Routing and Compute Allocation)
 * ------------------------------------------------------------------------- */
export type ExecutionTier = 
  | 'T0' // Verified skill or cached execution (0 token cost, instant)
  | 'T1' // Fast local or lightweight model
  | 'T2' // Reasoning + tools + structured tests
  | 'T3'; // Parallel search + independent counter-verifier

export interface ComputeEnvelope {
  envelopeId: string;
  selectedTier: ExecutionTier;
  modelId: string;
  topology: 'linear' | 'mcts-tree' | 'actor-critic' | 'consensus-swarm';
  tokenBudget: number;
  toolAllowlist: string[];
  verifierLevel: 'none' | 'schema' | 'unit-test' | 'dual-independent';
  sandboxFidelity: 'none' | 'virtual-fs' | 'process-jail' | 'microvm';
  privacyTier: 'local-only' | 'redacted-cloud' | 'unrestricted';
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
}

/* -------------------------------------------------------------------------
 * FAST LOOP: VORCIS (Predictive Planning and Simulation)
 * ------------------------------------------------------------------------- */
export interface PredictedOutcome {
  actionName: string;
  predictedStateDigest: string;
  expectedUtility: number;
  failureRisk: number;
  sideEffectsIdentified: string[];
}

export interface CounterfactualReport {
  reportId: string;
  candidateAction: ActionRequest;
  predictedOutcomes: PredictedOutcome[];
  uncertainty: number;
  riskEstimate: number;
  probeRecommendation: 'proceed' | 'run-zero-side-effect-probe' | 'execute-in-cow-sandbox' | 'halt';
  actualVsPredicted?: {
    divergenceScore: number;
    surprises: string[];
    calibrationDelta: number;
  };
}

/* -------------------------------------------------------------------------
 * MESO LOOP: Trace Collector & CORVEX (Causal Diagnosis)
 * ------------------------------------------------------------------------- */
export interface TrajectoryTrace {
  traceId: string;
  environmentFingerprint: string;
  checkpointRefs: string[];
  events: Array<{
    timestamp: string;
    stateHash: string;
    actionName: string;
    resultDigest: string;
    durationMs: number;
  }>;
  toolOutputs: Array<{
    toolName: string;
    success: boolean;
    error?: string;
  }>;
  totalCostUsd: number;
  totalLatencyMs: number;
}

export interface CausalHypothesis {
  id: string;
  description: string;
  suspectedFactor: string;
  proposedIntervention: string;
  priorProbability: number;
}

export interface VerifiedCausalGraph {
  graphId: string;
  failedTraceId: string;
  hypotheses: CausalHypothesis[];
  minimalIntervention: string;
  reproductionStatus: 'confirmed' | 'disproven' | 'confounded';
  confidence: number;
  limitations: string[];
  subsystemBlame: Record<string, number>; // Subsystem name -> weight (0.0 to 1.0)
  remediationAdvice: string;
}

/* -------------------------------------------------------------------------
 * MESO LOOP: KAVYRA (Verified Skill Induction & Lifecycle)
 * ------------------------------------------------------------------------- */
export type SkillLifecycleStatus = 'candidate' | 'verified' | 'stale' | 'regressing' | 'deprecated';

export interface SkillContract {
  name: string;
  description: string;
  inputsSchema: Record<string, string>;
  preconditions: string[];
  postconditions: string[];
}

export interface SkillCandidate {
  id: string;
  version: string;
  signature: string;
  contract: SkillContract;
  bodyRef: string;
  executableSource: string;
  unitTests: Array<{
    name: string;
    input: Record<string, unknown>;
    expectedOutput: Record<string, unknown>;
    testSource: string;
  }>;
  environmentConstraints: string[];
  transferMetrics: {
    heldOutPassRate: number;
    latencyReductionRatio: number;
    tokenSavingRatio: number;
  };
  status: SkillLifecycleStatus;
  createdAt: string;
}

/* -------------------------------------------------------------------------
 * MESO LOOP: NEXALIS (Evidence-Backed Knowledge Exchange)
 * ------------------------------------------------------------------------- */
export interface SignedEpistemicClaim {
  claimId: string;
  payloadHash: string; // SHA-256
  environmentFingerprint: string;
  evidenceRefs: string[];
  verifierIdentity: string;
  signature: string;
  validityRange: {
    from: string;
    until: string;
  };
  revocationRef?: string;
  isRevoked: boolean;
  claimData: {
    topic: string;
    assertion: string;
    confidence: number;
    reproducibilityProof: string;
  };
}

/* -------------------------------------------------------------------------
 * SLOW LOOP: VANTAGE / VANTEX (Goal-Directed Task Acquisition)
 * ------------------------------------------------------------------------- */
export type TaskAuthTier = 'T0_Autonomous' | 'T1_StagedShadow' | 'T2_ScopedHumanApproval';

export interface TaskCharter {
  taskId: string;
  goalSpec: string;
  successCriteria: string[];
  authTier: TaskAuthTier;
  blastRadiusCap: {
    maxFileEdits: number;
    maxNetworkCalls: number;
    maxTokenSpend: number;
    forbiddenPaths: string[];
  };
  deadlineSla: string;
  rollbackPlan: string;
  informationGainRank: number;
}

/* -------------------------------------------------------------------------
 * SLOW LOOP: MIRALYX (Meta-Improvement and Recursive Evolution)
 * ------------------------------------------------------------------------- */
export interface MetaCandidate {
  candidateId: string;
  generation: number;
  targetSubsystem: string;
  proposedMutation: string;
  rationale: string;
  diffPayload: Record<string, unknown>;
}

export interface MetaTelemetry {
  generationId: number;
  baselineRef: string;
  taskYield: number;
  qualityDelta: number;
  computeCost: number;
  regressionDelta: number;
  evaluatorDrift: number;
  subsystemBlame: Record<string, number>;
  promotedCandidateId?: string;
  rollbackOccurred: boolean;
}

/* -------------------------------------------------------------------------
 * COMPREHENSIVE RSIRALS OCTA-MODULE SNAPSHOT
 * ------------------------------------------------------------------------- */
export interface RsiralsOctaModuleStatus {
  sentrix: {
    activeBeliefsCount: number;
    activeUncertaintiesCount: number;
    interceptedActions: number;
    blockedActions: number;
    averageRiskScore: number;
  };
  aurix: {
    routedEnvelopesCount: number;
    tierDistribution: Record<ExecutionTier, number>;
    cumulativeCostSavingsUsd: number;
  };
  vorcis: {
    simulationsRun: number;
    cowSandboxesSpawned: number;
    averagePredictionAccuracy: number;
  };
  corvex: {
    diagnosedFailures: number;
    reproducedFaults: number;
    activeCausalGraphs: number;
  };
  kavyra: {
    inducedSkillsCount: number;
    activeVerifiedSkills: number;
    staleDeprecatedSkills: number;
  };
  nexalis: {
    signedClaimsCount: number;
    activeSubscribers: number;
    revokedClaimsCount: number;
  };
  vantage: {
    acquiredChartersCount: number;
    roadmapGapsIdentified: number;
    pendingAutonomousTasks: number;
  };
  miralyx: {
    currentGeneration: number;
    totalProposedMutations: number;
    promotedMutations: number;
    rejectedMutations: number;
    anchorEvaluatorHealth: 'immutably-locked' | 'compromised';
  };
}
