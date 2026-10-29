/**
 * PROPRIETARY - SelfImpulse RSIRALS
 * Shared contracts, IPC signatures, and telemetry snapshots.
 */

export const RSIRALS_IPC = {
  snapshot: 'rsirals:snapshot',
  octaStatus: 'rsirals:octa-status',
  executeFastLoop: 'rsirals:execute-fast-loop',
  diagnoseFailure: 'rsirals:diagnose-failure',
  induceSkill: 'rsirals:induce-skill',
  publishClaim: 'rsirals:publish-claim',
  acquireCharter: 'rsirals:acquire-charter',
  metaEvolve: 'rsirals:meta-evolve'
} as const;

export interface RsiralsOctaStatus {
  sentrix: {
    activeBeliefsCount: number;
    activeUncertaintiesCount: number;
    interceptedActions: number;
    blockedActions: number;
    averageRiskScore: number;
  };
  aurix: {
    routedEnvelopesCount: number;
    tierDistribution: {
      T0: number;
      T1: number;
      T2: number;
      T3: number;
    };
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

export interface RsiralsSnapshot {
  name: 'RSIRALS';
  fullName: 'Recursive Self-Improving Reinforcement Agentic Learning System';
  mode: 'non-parametric-runtime-learning';
  proprietary?: {
    version: string;
    license: string;
    classification: string;
    securityFingerprint: string;
  };
  octa?: RsiralsOctaStatus;
  adopted: {
    id: string;
    gen: number;
    score: number | null;
    evaluatedOn: number;
    note: string;
    params: {
      reviewDepth: number;
      checkBias: number;
      serialExec: boolean;
      lessonBudget: number;
      mosaic: boolean;
    };
  } | null;
  candidate: {
    id: string;
    gen: number;
    score: number | null;
    evaluatedOn: number;
    note: string;
  } | null;
  runs: Array<{
    strategyId: string | null;
    verified: boolean;
    simulated: boolean;
    heldOut: boolean;
    evidenceLeak: boolean;
    costUsd: number | null;
    policyTokens: number | null;
  }>;
  lessons: Array<{
    id: string;
    kind: string;
    text: string;
    strength: number;
    utility: number;
    utilityCount: number;
    retrievalCount: number;
    evidence: string[];
  }>;
  skills: { proposed: number; approved: number; discarded: number };
  receipts: Array<{
    id: string;
    at: string;
    missionId: string;
    strategyChange: string | null;
    evidenceDigest: string;
    signed: boolean;
    memoryCredit: { lessonIds: string[]; verified: boolean; model: string } | null;
    evaluation: {
      heldOut: boolean;
      evidenceLeak: boolean;
      costUsd: number | null;
      policyTokens: number | null;
    } | null;
  }>;
  acceptanceRule: string;
  boundaries: string[];
}
